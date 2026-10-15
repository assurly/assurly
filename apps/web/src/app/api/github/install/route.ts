import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  ApiError,
  emptyBodySchema,
  emptyObjectSchema,
  RATE_LIMITS,
  requireRouteUser,
  secureRoute,
} from '../../../../utils/apiSecurity';
import { requireOrganizationMember } from '../../../../utils/authorization';
import { getAdminDbAdapter } from '../../../../utils/dbAdapter';
import { getApplicationUrl } from '../../../../utils/env';
import { verifyGitHubInstallationState } from '../../../../utils/githubApp';
import { connectInstallationRepositories } from '../../../../utils/githubInstallationSync';

const installQuery = z
  .object({
    installation_id: z.string().regex(/^[0-9]{1,20}$/),
    state: z.string().min(20).max(4096).optional(),
    setup_action: z.enum(['install', 'update']).optional(),
  })
  .strict();

export const GET = secureRoute(
  {
    routeId: 'github:install:callback',
    auth: 'required',
    query: installQuery,
    params: emptyObjectSchema,
    body: emptyBodySchema,
    bodyMode: 'none',
    maxBodyBytes: 0,
    rateLimit: RATE_LIMITS.sensitive,
  },
  async ({ auth, query }) => {
    const context = requireRouteUser(auth);
    const workspace = await context.db.getOrganizationByUserId(context.user.id);
    if (!workspace) throw new ApiError(404, 'not_found', 'Workspace not found.');

    let organizationId = workspace.id;

    if (query.state) {
      let signedState;
      try {
        signedState = verifyGitHubInstallationState(query.state);
      } catch {
        throw new ApiError(400, 'invalid_install_state', 'GitHub installation state is invalid.');
      }
      if (context.user.id !== signedState.userId) {
        throw new ApiError(403, 'invalid_install_state', 'GitHub installation state is invalid.');
      }
      await requireOrganizationMember(context, signedState.organizationId);
      organizationId = signedState.organizationId;
    } else {
      await requireOrganizationMember(context, workspace.id);
      if (
        workspace.github_installation_id &&
        workspace.github_installation_id !== query.installation_id
      ) {
        throw new ApiError(
          403,
          'invalid_install_state',
          'GitHub installation does not match this workspace.',
        );
      }
    }

    await connectInstallationRepositories(
      getAdminDbAdapter(),
      organizationId,
      query.installation_id,
    );
    return NextResponse.redirect(`${getApplicationUrl()}/dashboard?success=github_app_installed`);
  },
);
