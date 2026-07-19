import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ApiError, RATE_LIMITS, requireRouteUser, secureRoute } from '../../../utils/apiSecurity';
import { requireRepositoryAccess, requireScanAccess } from '../../../utils/authorization';
import { resolveVerdictFromScanFindings } from '../../../utils/shipGate';
import { GENERATOR_FINGERPRINTS } from '../../../utils/generatorFingerprint';
import type { DbAdapter, ScanFinding } from '../../../utils/dbAdapter';

const scanQuery = z
  .object({
    repoId: z.string().uuid().optional(),
    scanId: z.string().uuid().optional(),
  })
  .strict()
  .refine((value) => Number(Boolean(value.repoId)) + Number(Boolean(value.scanId)) === 1);

const findingSchema = z
  .object({
    rule_id: z.string().trim().min(1).max(120),
    severity: z.enum(['error', 'warning']),
    confidence: z.enum(['high', 'medium', 'low']).optional(),
    file_path: z.string().trim().min(1).max(1024),
    line_number: z.number().int().positive().max(10_000_000).optional(),
    message: z.string().trim().min(1).max(4000),
    suggestion: z.string().max(4000).optional(),
  })
  .strict();

const saveScanBody = z
  .object({
    repoId: z.string().uuid(),
    commitSha: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z0-9._-]+$/),
    branch: z.string().min(1).max(255),
    status: z.enum(['success', 'failed']),
    errors: z.number().int().nonnegative().max(100).optional(),
    warnings: z.number().int().nonnegative().max(100).optional(),
    findings: z.array(findingSchema).max(100),
    // The AI builder that produced this app (Phase 0 detector, computed client-side
    // from the repo tree). Persisted on the target to seed the corpus moat.
    generatorFingerprint: z.enum(GENERATOR_FINGERPRINTS).optional(),
    // The true number of files the scan analyzed, for accurate verdict evidence.
    scannedFileCount: z.number().int().nonnegative().max(100_000).optional(),
  })
  .strict();

export const GET = secureRoute(
  {
    routeId: 'scans:read',
    auth: 'required',
    query: scanQuery,
    params: z.object({}).strict(),
    body: z.undefined(),
    bodyMode: 'none',
    maxBodyBytes: 0,
    rateLimit: RATE_LIMITS.read,
  },
  async ({ auth, query }) => {
    const context = requireRouteUser(auth);
    if (query.scanId) {
      await requireScanAccess(context, query.scanId);
      return NextResponse.json({ findings: await context.db.getScanFindings(query.scanId) });
    }
    if (!query.repoId) throw new ApiError(400, 'invalid_request', 'Repository is required.');
    await requireRepositoryAccess(context, query.repoId);
    return NextResponse.json({ scans: await context.db.getRecentScans(query.repoId) });
  },
);

interface RepoTargetVerdictInput {
  findings: ScanFinding[];
  /** True file count the scan analyzed, when known (POST only). */
  scannedFileCount?: number;
  /** Detected AI builder, when known. Undefined preserves any prior value. */
  generatorFingerprint?: string;
  /** When the source scan ran; null falls back to now. */
  lastCheckedAt: string | null;
}

/**
 * Recomputes and writes the repo's `target` (the current-verdict projection)
 * from a set of scan findings. Shared by the scan SAVE (POST) and DELETE paths
 * so the "Ship Score / READY-vs-NOT" card is derived by the exact same math in
 * both — deleting the newest scan must recompute from the new newest remaining
 * one, not leave a stale verdict. Best-effort: a target-sync failure must never
 * turn a successful scan mutation into a 5xx.
 */
async function syncRepoTargetVerdict(
  db: DbAdapter,
  repoId: string,
  input: RepoTargetVerdictInput,
): Promise<void> {
  try {
    const repo = await db.getRepository(repoId);
    if (!repo) return;
    const verdict = resolveVerdictFromScanFindings(input.findings, {
      scannedFileCount: input.scannedFileCount,
    });
    await db.upsertTarget({
      organizationId: repo.organization_id,
      kind: 'repo',
      identifier: repo.name,
      displayName: repo.name,
      repositoryId: repo.id,
      // Preserve a prior fingerprint when the caller didn't detect one.
      generatorFingerprint: input.generatorFingerprint ?? undefined,
      currentVerdict: verdict.status,
      currentShipScore: verdict.shipScore,
      verdictEvidence: {
        topIssue: verdict.topIssue,
        blockerCount: verdict.blockerCount,
        reviewCount: verdict.reviewCount,
        warningCount: verdict.warningCount,
        headline: verdict.headline,
      },
      lastCheckedAt: input.lastCheckedAt ?? new Date().toISOString(),
    });
  } catch (error) {
    // Swallowed so the (already persisted) scan mutation still succeeds.
    console.error('Failed to sync target from scan:', error);
  }
}

/**
 * Resets the repo's `target` back to the neutral "not yet scanned" verdict used
 * for a repo with no scans (see `deriveCardFromLatestScan` in api/targets): an
 * `unknown` verdict, no score, and no evidence. Called when the last scan of a
 * repo is deleted. Best-effort, like `syncRepoTargetVerdict`.
 */
async function resetRepoTargetToNeutral(db: DbAdapter, repoId: string): Promise<void> {
  try {
    const repo = await db.getRepository(repoId);
    if (!repo) return;
    await db.upsertTarget({
      organizationId: repo.organization_id,
      kind: 'repo',
      identifier: repo.name,
      displayName: repo.name,
      repositoryId: repo.id,
      currentVerdict: 'unknown',
      currentShipScore: null,
      verdictEvidence: {},
      lastCheckedAt: null,
    });
  } catch (error) {
    console.error('Failed to reset target after deleting the last scan:', error);
  }
}

export const POST = secureRoute(
  {
    routeId: 'scans:create',
    auth: 'required',
    query: z.object({}).strict(),
    params: z.object({}).strict(),
    body: saveScanBody,
    bodyMode: 'json',
    maxBodyBytes: 256 * 1024,
    rateLimit: { limit: 20, windowSeconds: 60 },
    csrf: true,
  },
  async ({ auth, body }) => {
    const context = requireRouteUser(auth);
    await requireRepositoryAccess(context, body.repoId);
    const errors = body.findings.filter((finding) => finding.severity === 'error').length;
    const warnings = body.findings.length - errors;
    if (
      (body.errors !== undefined && body.errors !== errors) ||
      (body.warnings !== undefined && body.warnings !== warnings)
    ) {
      throw new ApiError(400, 'invalid_counts', 'Finding counts do not match the findings.');
    }
    const scan = await context.db.saveScan(
      body.repoId,
      body.commitSha,
      body.branch,
      body.status,
      errors,
      warnings,
      body.findings,
    );
    await syncRepoTargetVerdict(context.db, body.repoId, {
      findings: body.findings as unknown as ScanFinding[],
      scannedFileCount: body.scannedFileCount,
      generatorFingerprint: body.generatorFingerprint,
      lastCheckedAt: scan.created_at ?? null,
    });
    return NextResponse.json(scan, { status: 201 });
  },
);

const deleteScanQuery = z.object({ scanId: z.string().uuid() }).strict();

export const DELETE = secureRoute(
  {
    routeId: 'scans:delete',
    auth: 'required',
    csrf: true,
    query: deleteScanQuery,
    params: z.object({}).strict(),
    body: z.undefined(),
    bodyMode: 'none',
    maxBodyBytes: 0,
    rateLimit: RATE_LIMITS.write,
  },
  async ({ auth, query }) => {
    const context = requireRouteUser(auth);
    // Authorize + load the scan (repository_id / created_at) in one step.
    const { scan } = await requireScanAccess(context, query.scanId);

    await context.db.deleteScan(scan.id);

    // Re-sync the repo target so the current-verdict card never goes stale:
    // deleting the NEWEST scan must recompute the verdict from the new newest
    // remaining scan (or reset to neutral when none remain). Deleting an older
    // scan leaves the verdict untouched. Best-effort — a resync failure must
    // never turn a successful delete into a 5xx.
    try {
      const remaining = await context.db.getRecentScans(scan.repository_id);
      if (remaining.length === 0) {
        await resetRepoTargetToNeutral(context.db, scan.repository_id);
      } else {
        // `remaining` is ordered created_at desc and no longer contains the
        // deleted scan, so the deleted scan was the newest iff it is at least as
        // recent as the newest survivor.
        const newest = remaining[0];
        const deletedWasNewest =
          new Date(scan.created_at).getTime() >= new Date(newest.created_at).getTime();
        if (deletedWasNewest) {
          const findings = await context.db.getScanFindings(newest.id);
          await syncRepoTargetVerdict(context.db, scan.repository_id, {
            findings,
            lastCheckedAt: newest.created_at,
          });
        }
      }
    } catch (error) {
      console.error('Failed to re-sync target after scan delete:', error);
    }

    return NextResponse.json({ ok: true });
  },
);
