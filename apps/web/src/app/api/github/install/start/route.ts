import { NextResponse } from 'next/server';
import {
  ApiError,
  emptyBodySchema,
  emptyObjectSchema,
  RATE_LIMITS,
  requireRouteUser,
  secureRoute,
} from '../../../../../utils/apiSecurity';
import { requireOrganizationMember } from '../../../../../utils/authorization';
import { createGitHubInstallationState, getGitHubAppSlug } from '../../../../../utils/githubApp';

export const GET = secureRoute(
  {
    routeId: 'github:install:start',
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
    const state = createGitHubInstallationState(context.user.id, organization.id);
    const url = new URL(
      `https://github.com/apps/${encodeURIComponent(getGitHubAppSlug())}/installations/new`,
    );
    url.searchParams.set('state', state);
    return NextResponse.redirect(url);
  },
);
