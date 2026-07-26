import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  ApiError,
  emptyObjectSchema,
  RATE_LIMITS,
  requireRouteUser,
  secureRoute,
} from '../../../../../../../utils/apiSecurity';
import { isActiveProbeAllowed } from '../../../../../../../utils/ownership';
import type { DbAdapter, Target } from '../../../../../../../utils/dbAdapter';

const revokeParams = z
  .object({
    id: z.string().uuid(),
    tokenId: z.string().uuid(),
  })
  .strict();

async function loadOwnedTarget(db: DbAdapter, id: string): Promise<Target> {
  const target = await db.getTargetById(id);
  if (!target) throw new ApiError(404, 'not_found', 'Target not found.');
  if (
    !isActiveProbeAllowed({
      kind: target.kind,
      ownershipVerified: target.ownership_verified,
    })
  ) {
    throw new ApiError(
      403,
      'ownership_required',
      'Verify ownership of this target before managing canary tokens.',
    );
  }
  return target;
}

/**
 * Soft-revoke a canary token for an ownership-gated target. Idempotent: a
 * second revoke is a no-op success. RLS + an explicit membership check via the
 * target's token list keep other orgs from revoking a stranger's canary.
 */
export const POST = secureRoute(
  {
    routeId: 'targets:canary-revoke',
    auth: 'required',
    csrf: true,
    query: emptyObjectSchema,
    params: revokeParams,
    body: z.undefined(),
    bodyMode: 'none',
    maxBodyBytes: 0,
    rateLimit: RATE_LIMITS.write,
  },
  async ({ auth, params }) => {
    const context = requireRouteUser(auth);
    const target = await loadOwnedTarget(context.db, params.id);

    // Org-scoped list is the ownership check — a token from another tenant
    // never appears here (and RLS would still block the PATCH).
    const tokens = await context.db.listCanaryTokens(target.id);
    const token = tokens.find((row) => row.id === params.tokenId);
    if (!token) throw new ApiError(404, 'not_found', 'Canary token not found.');

    await context.db.revokeCanaryToken(params.tokenId);
    return NextResponse.json({ revoked: true });
  },
);
