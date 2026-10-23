import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ApiError, RATE_LIMITS, requireApiKey, secureRoute } from '../../../../utils/apiSecurity';
import { getAdminDbAdapter } from '../../../../utils/dbAdapter';
import { runLiveLock } from '../../../../utils/liveLock';
import { normalizeUrlIdentifier } from '../../../../utils/ownership/gate';

const liveLockBody = z
  .object({
    url: z.string().url().max(2048),
    gitSha: z
      .string()
      .regex(/^[0-9a-f]{7,64}$/i)
      .transform((value) => value.toLowerCase()),
    attemptId: z.string().regex(/^[A-Za-z0-9_.:-]{1,120}$/),
  })
  .strict();

/**
 * Deploy-path ship gate. Runs a fresh read-only re-probe of an ownership-verified
 * URL and returns READY or BLOCKED. It does not read the stored score.
 *
 * A missing target is 404 and is not probed. An unverified target is BLOCKED
 * and is not probed. The same attempt id returns the recorded row.
 */
export const POST = secureRoute(
  {
    routeId: 'v1:live-lock',
    auth: 'apiKey',
    query: z.object({}).strict(),
    params: z.object({}).strict(),
    body: liveLockBody,
    bodyMode: 'json',
    maxBodyBytes: 4096,
    rateLimit: RATE_LIMITS.write,
  },
  async ({ apiKey, body }) => {
    const key = requireApiKey(apiKey);
    let identifier: string;
    try {
      identifier = normalizeUrlIdentifier(body.url);
    } catch {
      throw new ApiError(400, 'invalid_request', 'Request validation failed.');
    }

    const db = getAdminDbAdapter();
    const target = await db.getTargetByIdentifier(key.organizationId, 'url', identifier);
    if (!target) {
      throw new ApiError(404, 'target_not_found', 'No guarded URL matches that address.');
    }

    const result = await runLiveLock({
      target,
      gitSha: body.gitSha,
      attemptId: body.attemptId,
      db,
    });

    return NextResponse.json({
      status: result.status,
      shipScore: result.shipScore,
      reason: result.reason,
      gitSha: result.gitSha,
      attemptId: result.attemptId,
      checkedAt: result.checkedAt,
    });
  },
);
