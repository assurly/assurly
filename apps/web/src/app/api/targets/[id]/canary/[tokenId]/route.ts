import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  ApiError,
  emptyObjectSchema,
  RATE_LIMITS,
  requireRouteUser,
  secureRoute,
} from '../../../../../../utils/apiSecurity';
import { isActiveProbeAllowed } from '../../../../../../utils/ownership';
import type { DbAdapter, Target } from '../../../../../../utils/dbAdapter';

const deleteParams = z
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
 * Permanently delete a revoked canary token. Live tokens must be revoked first
 * — deleting an active canary would silently drop a planted decoy. RLS scopes
 * the delete to the caller's org; this handler adds the revoked-only invariant.
 * Associated hit rows cascade-delete with the parent.
 */
export const DELETE = secureRoute(
  {
    routeId: 'targets:canary-delete',
    auth: 'required',
    csrf: true,
    query: emptyObjectSchema,
    params: deleteParams,
    body: z.undefined(),
    bodyMode: 'none',
    maxBodyBytes: 0,
    rateLimit: RATE_LIMITS.write,
  },
  async ({ auth, params }) => {
    const context = requireRouteUser(auth);
    const target = await loadOwnedTarget(context.db, params.id);

    // Org-scoped list is the ownership check — a token from another tenant
    // never appears here (and RLS would still block the DELETE).
    const tokens = await context.db.listCanaryTokens(target.id);
    const token = tokens.find((row) => row.id === params.tokenId);
    if (!token) throw new ApiError(404, 'not_found', 'Canary token not found.');

    if (!token.revoked_at) {
      throw new ApiError(
        409,
        'canary_active',
        'Revoke this canary before deleting it. Deleting a live canary would drop a planted decoy still in use.',
      );
    }

    await context.db.deleteCanaryToken(params.tokenId);
    return NextResponse.json({ deleted: true });
  },
);
