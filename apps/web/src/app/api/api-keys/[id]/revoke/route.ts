import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  ApiError,
  emptyObjectSchema,
  RATE_LIMITS,
  requireRouteUser,
  secureRoute,
} from '../../../../../utils/apiSecurity';

const idParams = z.object({ id: z.string().uuid() }).strict();

/**
 * Revoke a programmatic API key (soft flag). RLS scopes the update to the
 * caller's org, so a user can only revoke their own org's keys. A revoked key
 * fails `auth: 'apiKey'` exactly like a missing one. Idempotent.
 */
export const POST = secureRoute(
  {
    routeId: 'api-keys:revoke',
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

    await context.db.revokeApiKey(params.id);
    return NextResponse.json({ revoked: true });
  },
);
