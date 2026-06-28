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
import { getAdminDbAdapter, type GitHubRepositoryMapping } from '../../../../utils/dbAdapter';
import { getApplicationUrl } from '../../../../utils/env';
import {
  getGitHubInstallation,
  getInstallationAccessToken,
  githubHeaders,
  verifyGitHubInstallationState,
} from '../../../../utils/githubApp';

const installQuery = z
  .object({
    installation_id: z.string().regex(/^[0-9]{1,20}$/),
    state: z.string().min(20).max(4096),
  })
  .strict();
const installationSchema = z
  .object({ account: z.object({ id: z.number().int().positive().safe() }) })
  .passthrough();
const repositoryPageSchema = z
  .object({
    repositories: z
      .array(
        z
          .object({
            id: z.number().int().positive().safe(),
            full_name: z
              .string()
              .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/)
              .max(201),
          })
          .passthrough(),
      )
      .max(100),
  })
  .passthrough();

async function listInstallationRepositories(token: string): Promise<GitHubRepositoryMapping[]> {
  const repositories: GitHubRepositoryMapping[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const url = new URL('https://api.github.com/installation/repositories');
    url.searchParams.set('per_page', '100');
    url.searchParams.set('page', String(page));
    const response = await fetch(url, { headers: githubHeaders(token) });
    if (!response.ok) throw new ApiError(502, 'github_unavailable', 'GitHub is unavailable.');
    const data = repositoryPageSchema.parse(await response.json());
    repositories.push(
      ...data.repositories.map((repository) => ({
        id: repository.id,
        fullName: repository.full_name,
      })),
    );
    if (data.repositories.length < 100) return repositories;
  }
  throw new ApiError(422, 'repository_limit_exceeded', 'Installation has too many repositories.');
}

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
    let state;
    try {
      state = verifyGitHubInstallationState(query.state);
    } catch {
      throw new ApiError(400, 'invalid_install_state', 'GitHub installation state is invalid.');
    }
    if (context.user.id !== state.userId) {
      throw new ApiError(403, 'invalid_install_state', 'GitHub installation state is invalid.');
    }
    await requireOrganizationMember(context, state.organizationId);

    const installation = installationSchema.parse(
      await getGitHubInstallation(query.installation_id),
    );
    const token = await getInstallationAccessToken(query.installation_id);
    const repositories = await listInstallationRepositories(token);
    await getAdminDbAdapter().connectGitHubInstallation(
      state.organizationId,
      installation.account.id,
      query.installation_id,
      repositories,
    );
    return NextResponse.redirect(`${getApplicationUrl()}/dashboard?success=github_app_installed`);
  },
);
