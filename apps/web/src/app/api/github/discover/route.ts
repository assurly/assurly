import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveGitHubAccessToken } from '../../../../utils/auth';
import { ApiError, emptyBodySchema, RATE_LIMITS, secureRoute } from '../../../../utils/apiSecurity';
import {
  githubHeaders,
  githubRepositoryApiUrl,
  resolveGitHubReadToken,
} from '../../../../utils/githubApp';

const ownerName = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9_.-]+$/);
const repositoryName = z
  .string()
  .min(3)
  .max(201)
  .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);

const discoverQuery = z.discriminatedUnion('type', [
  z.object({ type: z.literal('user-repos'), owner: ownerName }).strict(),
  z.object({ type: z.literal('repository'), repo: repositoryName }).strict(),
]);

const githubRepositorySchema = z.object({
  id: z.number(),
  name: z.string(),
  full_name: z.string(),
  description: z.string().nullable().default(null),
  stargazers_count: z.number().default(0),
  language: z.string().nullable().default(null),
});
const githubRepositoriesSchema = z.array(githubRepositorySchema).max(100);

function rateLimitMessage(authenticated: boolean): string {
  if (authenticated) {
    return 'GitHub API rate limit exceeded. Please wait a few minutes and try again.';
  }
  return 'GitHub API rate limit exceeded. Sign in with GitHub to browse more repositories.';
}

async function githubGet(
  url: string,
  token: string | undefined,
  authenticated: boolean,
): Promise<Response> {
  const response = await fetch(url, { headers: githubHeaders(token) });
  if (response.status === 403 || response.status === 429) {
    throw new ApiError(429, 'rate_limit_exceeded', rateLimitMessage(authenticated));
  }
  return response;
}

export const GET = secureRoute(
  {
    routeId: 'github:discover',
    auth: 'optional',
    query: discoverQuery,
    params: z.object({}).strict(),
    body: emptyBodySchema,
    bodyMode: 'none',
    maxBodyBytes: 0,
    rateLimit: RATE_LIMITS.read,
  },
  async ({ query, auth, request }) => {
    const githubAccessToken =
      auth?.githubAccessToken ?? (auth ? await resolveGitHubAccessToken(request) : undefined);
    const token = resolveGitHubReadToken(githubAccessToken);
    const authenticated = Boolean(token);

    if (query.type === 'repository') {
      const response = await githubGet(githubRepositoryApiUrl(query.repo), token, authenticated);
      if (response.status === 404) {
        throw new ApiError(
          404,
          'repo_not_found',
          'Repository not found. Use the owner/repo format for a public repository.',
        );
      }
      if (!response.ok) {
        throw new ApiError(502, 'github_unavailable', 'GitHub is temporarily unavailable.');
      }
      return NextResponse.json(githubRepositorySchema.parse(await response.json()));
    }

    const userUrl = `https://api.github.com/users/${encodeURIComponent(query.owner)}/repos?type=public&sort=updated&per_page=100`;
    let response = await githubGet(userUrl, token, authenticated);
    if (response.status === 404) {
      const orgUrl = `https://api.github.com/orgs/${encodeURIComponent(query.owner)}/repos?type=public&sort=updated&per_page=100`;
      response = await githubGet(orgUrl, token, authenticated);
    }
    if (response.status === 404) {
      throw new ApiError(
        404,
        'owner_not_found',
        'No public repositories found for this user or organization.',
      );
    }
    if (!response.ok) {
      throw new ApiError(502, 'github_unavailable', 'GitHub is temporarily unavailable.');
    }

    return NextResponse.json(githubRepositoriesSchema.parse(await response.json()));
  },
);
