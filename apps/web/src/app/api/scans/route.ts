import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ApiError, RATE_LIMITS, requireRouteUser, secureRoute } from '../../../utils/apiSecurity';
import { requireRepositoryAccess, requireScanAccess } from '../../../utils/authorization';

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
    const scan = await context.db.saveScan(
      body.repoId,
      body.commitSha,
      body.branch,
      body.status,
      errors,
      warnings,
      body.findings,
    );
    return NextResponse.json(scan, { status: 201 });
  },
);
