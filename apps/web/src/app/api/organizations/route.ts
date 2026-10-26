import { NextResponse } from 'next/server';
import {
  emptyBodySchema,
  emptyObjectSchema,
  RATE_LIMITS,
  requireRouteUser,
  secureRoute,
} from '../../../utils/apiSecurity';

/**
 * The workspaces the signed-in person belongs to, the active one first. Most
 * people have one; a Vercel team member who also signed in with GitHub has two.
 */
export const GET = secureRoute(
  {
    routeId: 'organizations:list',
    auth: 'required',
    query: emptyObjectSchema,
    params: emptyObjectSchema,
    body: emptyBodySchema,
    bodyMode: 'none',
    maxBodyBytes: 0,
    rateLimit: RATE_LIMITS.read,
  },
  async ({ auth }) => {
    const context = requireRouteUser(auth);
    const organizations = await context.db.listOrganizationsForUser(context.user.id);
    return NextResponse.json({ organizations, activeId: organizations[0]?.id ?? null });
  },
);
