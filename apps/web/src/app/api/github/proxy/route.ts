import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  ApiError,
  emptyBodySchema,
  RATE_LIMITS,
  requireRouteUser,
  secureRoute,
} from '../../../../utils/apiSecurity';
import { requireRepositoryAccess } from '../../../../utils/authorization';
import {
  fetchGitHubFile,
  fetchGitHubFilesBatch,
  getInstallationAccessToken,
  githubHeaders,
  githubRepositoryApiUrl,
  GitHubApiError,
  isGitHubRepositoryName,
  listGitHubBranchNames,
} from '../../../../utils/githubApp';
import {
  InstantGateTreeError,
  loadInstantGateTree,
  REPOSITORY_TOO_LARGE_MESSAGE,
} from '../../../../utils/instantGateTree';
import { INSTANT_GATE_MAX_FILES } from '@assurly/scanner-core';

const branchSchema = z
  .string()
  .min(1)
  .max(255)
  .refine((value) => !value.includes('..') && !value.includes('\0'));
const filePathSchema = z
  .string()
  .min(1)
  .max(1024)
  .refine(
    (value) =>
      !value.split('/').some((part) => !part || part === '.' || part === '..') &&
      !value.includes('\\') &&
      !value.startsWith('/'),
  );
const baseQuery = {
  repoId: z.string().uuid(),
  branch: branchSchema.optional(),
};
const proxyQuery = z.discriminatedUnion('type', [
  z.object({ ...baseQuery, type: z.literal('tree') }).strict(),
  z.object({ ...baseQuery, type: z.literal('file'), path: filePathSchema }).strict(),
  z.object({ ...baseQuery, type: z.literal('branches') }).strict(),
]);
const batchBody = z
  .object({
    repoId: z.string().uuid(),
    branch: branchSchema.optional(),
    paths: z.array(filePathSchema).min(1).max(INSTANT_GATE_MAX_FILES),
  })
  .strict();
const metadataSchema = z.object({ default_branch: z.string().min(1).max(255) }).passthrough();

interface PrivateRepoContext {
  repositoryName: string;
  token: string;
  branch: string;
}

/**
 * Resolves installation access to a connected repository and a concrete branch,
 * shared by the single-file GET and the batch POST so both enforce the same
 * tenant checks and branch resolution.
 */
async function resolvePrivateRepoContext(
  context: Parameters<typeof requireRepositoryAccess>[0],
  repoId: string,
  branchInput: string | undefined,
): Promise<PrivateRepoContext> {
  const { repository, organization } = await requireRepositoryAccess(context, repoId);
  if (!organization.github_installation_id) {
    throw new ApiError(503, 'github_not_configured', 'GitHub integration is unavailable.');
  }
  // A malformed stored name (e.g. a record missing its "owner/" prefix) can
  // never resolve on GitHub; report it as a clear 422 rather than crashing.
  if (!isGitHubRepositoryName(repository.name)) {
    throw new ApiError(
      422,
      'invalid_repository',
      'The connected repository name is invalid. Reconnect the repository and try again.',
    );
  }

  const token = await getInstallationAccessToken(
    organization.github_installation_id,
    repository.github_repo_id,
  );

  let branch = branchInput;
  if (!branch) {
    const response = await fetch(githubRepositoryApiUrl(repository.name), {
      headers: githubHeaders(token),
    });
    if (!response.ok) throw new ApiError(502, 'github_unavailable', 'GitHub is unavailable.');
    branch = metadataSchema.parse(await response.json()).default_branch;
  }

  return { repositoryName: repository.name, token, branch };
}

export const GET = secureRoute(
  {
    routeId: 'github:private-proxy',
    auth: 'required',
    query: proxyQuery,
    params: z.object({}).strict(),
    body: emptyBodySchema,
    bodyMode: 'none',
    maxBodyBytes: 0,
    rateLimit: RATE_LIMITS.read,
  },
  async ({ auth, query }) => {
    const context = requireRouteUser(auth);
    const { repositoryName, token, branch } = await resolvePrivateRepoContext(
      context,
      query.repoId,
      query.branch,
    );

    if (query.type === 'tree') {
      try {
        const tree = await loadInstantGateTree({
          repo: repositoryName,
          branch,
          headers: githubHeaders(token),
          cacheKey: `proxy:${query.repoId}`,
        });
        return NextResponse.json(tree, {
          headers: { 'Cache-Control': 'private, max-age=60' },
        });
      } catch (error) {
        if (error instanceof InstantGateTreeError) {
          if (error.kind === 'too_large') {
            throw new ApiError(413, 'repository_too_large', REPOSITORY_TOO_LARGE_MESSAGE);
          }
          if (error.kind === 'rate_limit') {
            throw new ApiError(429, 'rate_limit_exceeded', 'GitHub API rate limit exceeded.');
          }
          throw new ApiError(502, 'github_unavailable', 'GitHub is unavailable.');
        }
        throw error;
      }
    }

    if (query.type === 'branches') {
      try {
        const branches = await listGitHubBranchNames(repositoryName, githubHeaders(token));
        return NextResponse.json({ default_branch: branch, branches });
      } catch (error) {
        if (error instanceof GitHubApiError) {
          if (error.status === 403 || error.status === 429) {
            throw new ApiError(429, 'rate_limit_exceeded', 'GitHub API rate limit exceeded.');
          }
          throw new ApiError(502, 'github_unavailable', 'GitHub is unavailable.');
        }
        throw error;
      }
    }

    const content = await fetchGitHubFile(token, repositoryName, query.path, branch, 1024 * 1024);
    return new Response(content, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  },
);

// Batch file read for private (installation) repositories — mirrors the
// public-scan batch. One request fans out to GitHub with the installation token
// and bounded concurrency, so a large repo scan is one round trip instead of
// hundreds of serial per-file requests.
export const POST = secureRoute(
  {
    routeId: 'github:private-proxy-batch',
    auth: 'required',
    query: z.object({}).strict(),
    params: z.object({}).strict(),
    body: batchBody,
    bodyMode: 'json',
    maxBodyBytes: 128 * 1024,
    rateLimit: RATE_LIMITS.read,
    csrf: true,
  },
  async ({ auth, body }) => {
    const context = requireRouteUser(auth);
    const { repositoryName, token, branch } = await resolvePrivateRepoContext(
      context,
      body.repoId,
      body.branch,
    );
    const files = await fetchGitHubFilesBatch(token, repositoryName, body.paths, branch);
    return NextResponse.json({ default_branch: branch, files });
  },
);
