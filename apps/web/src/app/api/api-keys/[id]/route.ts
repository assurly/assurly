import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  ApiError,
  emptyObjectSchema,
  RATE_LIMITS,
  requireRouteUser,
  secureRoute,
} from '../../../../utils/apiSecurity';

const idParams = z.object({ id: z.string().uuid() }).strict();

/**
 * Permanently delete a revoked programmatic API key. Live keys must be revoked
 * first — deleting an active key would silently break whatever authenticates
 * with it. RLS scopes the delete to the caller's org; this handler adds the
 * revoked-only invariant.
 */
export const DELETE = secureRoute(
  {
    routeId: 'api-keys:delete',
    auth: 'required',
    csrf: true,
    query: emptyObjectSchema,
    params: idParams,
    body: z.undefined(),
    bodyMode: 'none',
    maxBodyBytes: 0,
    rateLimit: RATE_LIMITS.write,
  },
  async ({ auth, params }) => {
    const context = requireRouteUser(auth);
    const org = await context.db.getOrganizationByUserId(context.user.id);
    if (!org) throw new ApiError(404, 'not_found', 'API key not found.');

    // Org-scoped list is the ownership check — a key from another tenant never
    // appears here (and RLS would still block the DELETE).
    const keys = await context.db.listApiKeys(org.id);
    const key = keys.find((row) => row.id === params.id);
    if (!key) throw new ApiError(404, 'not_found', 'API key not found.');

    if (!key.revoked_at) {
      throw new ApiError(
        409,
        'key_active',
        'Revoke this key before deleting it. Deleting a live key would break anything still using it.',
      );
    }

    await context.db.deleteApiKey(params.id);
    return NextResponse.json({ deleted: true });
  },
);
