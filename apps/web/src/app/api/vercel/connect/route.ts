import { NextResponse } from 'next/server';
import {
  ApiError,
  emptyBodySchema,
  emptyObjectSchema,
  RATE_LIMITS,
  requireRouteUser,
  secureRoute,
} from '../../../../utils/apiSecurity';
import { requireOrganizationMember } from '../../../../utils/authorization';
import { signVercelState, vercelAuthorizeUrl } from '../../../../utils/vercelOauth';
import { vercelConnectConfigured } from '../../../../utils/vercelToken';

/** Starts the one-time Vercel connection for the caller's workspace. */
export const GET = secureRoute(
  {
    routeId: 'vercel:connect',
    auth: 'required',
    query: emptyObjectSchema,
    params: emptyObjectSchema,
    body: emptyBodySchema,
    bodyMode: 'none',
    maxBodyBytes: 0,
    rateLimit: RATE_LIMITS.sensitive,
  },
  async ({ auth }) => {
    const context = requireRouteUser(auth);
    const organization = await context.db.getOrganizationByUserId(context.user.id);
    if (!organization) throw new ApiError(404, 'not_found', 'Workspace not found.');
    await requireOrganizationMember(context, organization.id);
    if (!vercelConnectConfigured()) {
      throw new ApiError(
        503,
        'vercel_not_configured',
        'Vercel is not connected on this workspace yet.',
      );
    }
    return NextResponse.redirect(vercelAuthorizeUrl(signVercelState(organization.id)));
  },
);
