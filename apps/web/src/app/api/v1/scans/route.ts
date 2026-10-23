import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ApiError, RATE_LIMITS, requireApiKey, secureRoute } from '../../../../utils/apiSecurity';
import { getAdminDbAdapter } from '../../../../utils/dbAdapter';
import { isGitHubRepositoryName } from '../../../../utils/githubApp';
import { persistFullGateScan } from '../../../../utils/fullGatePersist';
import { PERSISTED_FINDINGS_LIMIT } from '../../../../utils/scanGateAuthority';

const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

const findingSchema = z
  .object({
    ruleId: z.string().trim().min(1).max(120),
    severity: z.enum(['error', 'warning']),
    confidence: z.enum(['high', 'medium', 'low']).optional(),
    file: z.string().trim().min(1).max(1024).optional(),
    line: z.number().int().positive().max(10_000_000).optional(),
    message: z.string().trim().min(1).max(4000),
    suggestion: z.string().max(4000).optional(),
  })
  .strict();

const submitBody = z
  .object({
    repo: z.string().trim().max(201).regex(REPO_PATTERN),
    commitSha: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z0-9._-]+$/)
      .optional(),
    branch: z.string().trim().min(1).max(255).optional(),
    status: z.enum(['success', 'failed']).optional(),
    shipScore: z.number().int().min(0).max(100),
    verdict: z.enum(['ready', 'review', 'blocked', 'failed']),
    scannedFileCount: z.number().int().nonnegative().max(100_000),
    cleanFileCount: z.number().int().nonnegative().max(100_000).optional(),
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
    findings: z.array(findingSchema).max(PERSISTED_FINDINGS_LIMIT),
  })
  .strict();

/**
 * Programmatic Full Gate submit — findings + Ship Gate SoT only.
 * Source code never leaves the caller's machine (CLI / MCP local scan).
 */
export const POST = secureRoute(
  {
    routeId: 'v1:scans',
    auth: 'apiKey',
    query: z.object({}).strict(),
    params: z.object({}).strict(),
    body: submitBody,
    bodyMode: 'json',
    maxBodyBytes: 256 * 1024,
    rateLimit: { limit: 30, windowSeconds: 60 },
  },
  async ({ apiKey, body }) => {
    const key = requireApiKey(apiKey);
    if (!isGitHubRepositoryName(body.repo)) {
      throw new ApiError(400, 'invalid_request', 'Repository name must be owner/repo.');
    }

    const db = getAdminDbAdapter();
    const repos = await db.getRepositories(key.organizationId);
    const repo = repos.find((row) => row.name.toLowerCase() === body.repo.toLowerCase());
    if (!repo) {
      throw new ApiError(
        404,
        'not_found',
        `Repository ${body.repo} is not connected to this Assurly workspace.`,
      );
    }

    const { scan, shipScore, verdict } = await persistFullGateScan(db, {
      repoId: repo.id,
      commitSha: body.commitSha ?? 'cli',
      branch: body.branch ?? 'local',
      status: body.status,
      claim: { shipScore: body.shipScore, verdict: body.verdict },
      scannedFileCount: body.scannedFileCount,
      cleanFileCount: body.cleanFileCount,
      scanScope: body.scanScope ?? null,
      findings: body.findings,
      route: 'v1:scans:create',
    });

    return NextResponse.json(
      {
        id: scan.id,
        repositoryId: repo.id,
        // What was stored — never the claim.
        shipScore: scan.ship_score ?? shipScore,
        verdict: scan.verdict ?? verdict,
        scannedFileCount: body.scannedFileCount,
      },
      { status: 201 },
    );
  },
);
