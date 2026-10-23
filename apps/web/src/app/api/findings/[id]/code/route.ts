import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  emptyObjectSchema,
  RATE_LIMITS,
  requireRouteUser,
  secureRoute,
} from '../../../../../utils/apiSecurity';
import { requireFindingAccess } from '../../../../../utils/authorization';
import { loadFindingCode } from '../../../../../utils/findingCode';
import { getInstallationAccessToken, isGitHubRepositoryName } from '../../../../../utils/githubApp';

const idParams = z.object({ id: z.string().uuid() }).strict();

/**
 * Installation first (private repos), then the signed-in user's own token, then
 * anonymous. Never the server PAT: a repository can be added by name, and the
 * PAT may see private code this organization does not own.
 */
async function readTokens(
  installationId: string | undefined,
  githubRepositoryId: number,
  userGitHubToken: string | undefined,
): Promise<Array<string | undefined>> {
  const tokens: Array<string | undefined> = [];
  if (installationId) {
    try {
      tokens.push(await getInstallationAccessToken(installationId, githubRepositoryId));
    } catch {
      // The installation lost this repository; a public one is still readable.
    }
  }
  if (userGitHubToken) tokens.push(userGitHubToken);
  tokens.push(undefined);
  return tokens;
}

/**
 * The code behind one finding: a few lines read from GitHub at the commit the
 * scan read, credentials masked, plus the change Assurly's auto-fix would make.
 * Source is fetched per request and never stored, cached or logged.
 */
export const GET = secureRoute(
  {
    routeId: 'findings:code',
    auth: 'required',
    query: emptyObjectSchema,
    params: idParams,
    body: z.undefined(),
    bodyMode: 'none',
    maxBodyBytes: 0,
    rateLimit: RATE_LIMITS.read,
  },
  async ({ auth, params }) => {
    const context = requireRouteUser(auth);
    const { finding, scan, repository, organization } = await requireFindingAccess(
      context,
      params.id,
    );
    const noStore = { headers: { 'Cache-Control': 'private, no-store' } };
    if (!isGitHubRepositoryName(repository.name)) {
      return NextResponse.json(
        {
          available: false,
          reason: 'repository_unreachable',
          message: 'The connected repository name is invalid. Reconnect the repository.',
          githubUrl: null,
        },
        noStore,
      );
    }

    const code = await loadFindingCode({
      repositoryName: repository.name,
      commitSha: scan.commit_sha,
      finding,
      tokens: await readTokens(
        organization.github_installation_id,
        repository.github_repo_id,
        context.githubAccessToken,
      ),
    });
    return NextResponse.json(code, noStore);
  },
);
