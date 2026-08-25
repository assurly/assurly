import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ApiError, RATE_LIMITS, requireRouteUser, secureRoute } from '../../../utils/apiSecurity';
import { requireRepositoryAccess, requireScanAccess } from '../../../utils/authorization';
import { resolveVerdictFromScanFindings } from '../../../utils/shipGate';
import { GENERATOR_FINGERPRINTS } from '../../../utils/generatorFingerprint';
import type { ScanFinding, ScanShipGateMeta } from '../../../utils/dbAdapter';
import {
  persistRepoScan,
  resetRepoTargetToNeutral,
  syncRepoTargetVerdict,
} from '../../../utils/persistRepoScan';

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
    cleanFileCount: z.number().int().nonnegative().max(100_000).optional(),
    shipScore: z.number().int().min(0).max(100).optional(),
    verdict: z.enum(['ready', 'review', 'blocked', 'failed']).optional(),
    scanScope: z
      .object({
        scanned: z.number().int().nonnegative(),
        skipped: z.number().int().nonnegative().optional(),
        roots: z.array(z.string().max(255)).max(50).optional(),
        unanalyzed: z
          .array(
            z.object({
              language: z.string().min(1).max(40),
              fileCount: z.number().int().nonnegative().max(100_000),
            }),
          )
          .max(20)
          .optional(),
        sourceTotal: z.number().int().nonnegative().optional(),
        limit: z.number().int().positive().optional(),
        gaps: z
          .object({
            notAnalysed: z.number().int().nonnegative(),
            overLimit: z.number().int().nonnegative(),
            outsideAppRoots: z.number().int().nonnegative(),
          })
          .optional(),
      })
      .passthrough()
      .optional(),
    failureReason: z.string().trim().min(1).max(120).optional(),
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
    const computed = resolveVerdictFromScanFindings(body.findings as unknown as ScanFinding[], {
      scannedFileCount: body.scannedFileCount,
    });
    const scanFailed = body.verdict === 'failed' || Boolean(body.failureReason);

    const meta: ScanShipGateMeta = {
      shipScore: scanFailed ? null : (body.shipScore ?? computed.shipScore),
      verdict: scanFailed ? 'failed' : (body.verdict ?? computed.status),
      scannedFileCount: body.scannedFileCount ?? computed.scannedFileCount,
      cleanFileCount: body.cleanFileCount ?? computed.cleanFileCount,
      scanScope: body.scanScope ?? null,
      failureReason: body.failureReason ?? null,
    };

    const scan = await persistRepoScan(context.db, {
      repoId: body.repoId,
      commitSha: body.commitSha,
      branch: body.branch,
      status: body.status,
      findings: body.findings,
      meta,
      generatorFingerprint: body.generatorFingerprint,
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
      console.error(
        JSON.stringify({
          service: 'assurly-api',
          event: 'target-sync-failed',
          repoId: scan.repository_id,
          scanId: scan.id,
          errorType: error instanceof Error ? error.name : 'UnknownError',
          errorMessage: error instanceof Error ? error.message : String(error),
        }),
      );
    }

    return NextResponse.json({ ok: true });
  },
);
