import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  ApiError,
  RATE_LIMITS,
  requireRouteUser,
  secureRoute,
} from '../../../../../utils/apiSecurity';
import { reprobeTargetAndRecord } from '../../../../../utils/reprobe';
import type { DbAdapter, Target } from '../../../../../utils/dbAdapter';

const targetParams = z.object({ id: z.string().uuid() }).strict();

/**
 * Loads a target the caller's organization owns. RLS scopes the read to the
 * caller's org (via the user token), so a missing row is reported as 404.
 */
async function loadTarget(db: DbAdapter, id: string): Promise<Target> {
  const target = await db.getTargetById(id);
  if (!target) throw new ApiError(404, 'not_found', 'Target not found.');
  return target;
}

/**
 * On-demand verified-fix re-probe. A re-probe IS an active probe, so this MUST
 * consult the single ownership authority and FAIL CLOSED — exactly as
 * scan-url/route.ts does. The gate is enforced inside `reprobeTargetAndRecord`
 * (via `isActiveProbeAllowed`); here we surface a clear 403 when the caller has
 * not proven ownership of a `url` target, so no active probe re-opens what
 * Phase 3 closed.
 */
export const POST = secureRoute(
  {
    routeId: 'targets:reprobe',
    auth: 'required',
    query: z.object({}).strict(),
    params: targetParams,
    body: z.undefined(),
    bodyMode: 'none',
    maxBodyBytes: 0,
    rateLimit: RATE_LIMITS.sensitive,
    csrf: true,
  },
  async ({ auth, params }) => {
    const context = requireRouteUser(auth);
    const target = await loadTarget(context.db, params.id);

    const result = await reprobeTargetAndRecord({ target, db: context.db });

    if (target.kind === 'url' && !result.activeProbe) {
      throw new ApiError(
        403,
        'ownership_required',
        'Verify ownership of this URL before re-probing it.',
      );
    }
    if (!result.probed) {
      throw new ApiError(422, 'not_reprobeable', 'This target has no live URL to re-probe.');
    }

    return NextResponse.json({
      probed: true,
      outcomes: result.outcomes,
      findings: result.findings,
      evidence: result.evidence,
    });
  },
);
