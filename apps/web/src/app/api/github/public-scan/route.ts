import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveGitHubAccessToken } from '../../../../utils/auth';
import { emptyBodySchema, RATE_LIMITS, secureRoute, ApiError } from '../../../../utils/apiSecurity';
import {
  fetchGitHubFile,
  fetchGitHubFilesBatch,
  GITHUB_FETCH_TIMEOUT_MS,
  githubHeaders,
  githubRepositoryApiUrl,
  GitHubApiError,
  listGitHubBranchNames,
  resolveGitHubReadToken,
} from '../../../../utils/githubApp';
import {
  InstantGateTreeError,
  loadInstantGateTree,
  REPOSITORY_TOO_LARGE_MESSAGE,
} from '../../../../utils/instantGateTree';
import { INSTANT_GATE_MAX_FILES } from '@assurly/scanner-core';

const repositoryName = z
  .string()
  .min(3)
  .max(201)
  .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
const branchName = z
  .string()
  .min(1)
  .max(255)
  .refine((value) => !value.includes('..') && !value.includes('\0'));
const filePath = z
  .string()
  .min(1)
  .max(1024)
  .refine(
    (value) =>
      !value.split('/').some((part) => !part || part === '.' || part === '..') &&
      !value.includes('\\') &&
      !value.startsWith('/'),
  );
const publicQuery = z.discriminatedUnion('type', [
  z
    .object({ repo: repositoryName, type: z.literal('tree'), branch: branchName.optional() })
    .strict(),
  z
    .object({
      repo: repositoryName,
      type: z.literal('file'),
      branch: branchName.optional(),
      path: filePath,
    })
    .strict(),
  z
    .object({ repo: repositoryName, type: z.literal('branches'), branch: branchName.optional() })
    .strict(),
]);
const metadataSchema = z
  .object({
    default_branch: z.string().min(1).max(255),
    private: z.boolean(),
  })
  .passthrough();

function rateLimitMessage(authenticated: boolean): string {
  if (authenticated) {
    return 'GitHub API rate limit exceeded. Please wait a few minutes and try again.';
  }
  return 'GitHub API rate limit exceeded. Sign in with GitHub to scan more repositories.';
}

export const GET = secureRoute(
  {
    routeId: 'github:public-scan',
    auth: 'optional',
    query: publicQuery,
    params: z.object({}).strict(),
    body: emptyBodySchema,
    bodyMode: 'none',
    maxBodyBytes: 0,
    rateLimit: RATE_LIMITS.public,
  },
  async ({ query, auth, request }) => {
    const githubAccessToken =
      auth?.githubAccessToken ?? (auth ? await resolveGitHubAccessToken(request) : undefined);
    const token = resolveGitHubReadToken(githubAccessToken);
    const authenticated = Boolean(token);
    const headers = githubHeaders(token);
    const metadataResponse = await fetch(githubRepositoryApiUrl(query.repo), {
      headers,
      signal: AbortSignal.timeout(GITHUB_FETCH_TIMEOUT_MS),
    });
    if (!metadataResponse.ok) {
      if (metadataResponse.status === 404) {
        throw new ApiError(
          404,
          'repo_not_found',
          'Repository not found. Please verify it is a PUBLIC repository and formatted as "owner/repo".',
        );
      }
      if (metadataResponse.status === 403 || metadataResponse.status === 429) {
        throw new ApiError(429, 'rate_limit_exceeded', rateLimitMessage(authenticated));
      }
      throw new ApiError(502, 'github_unavailable', 'GitHub is temporarily unavailable.');
    }
    const metadata = metadataSchema.parse(await metadataResponse.json());
    if (metadata.private)
      throw new ApiError(403, 'private_repository', 'Private repository is not available.');
    const branch = query.branch || metadata.default_branch;

    if (query.type === 'branches') {
      try {
        const branches = await listGitHubBranchNames(query.repo, headers);
        return NextResponse.json({ default_branch: metadata.default_branch, branches });
      } catch (error) {
        if (error instanceof GitHubApiError) {
          if (error.status === 403 || error.status === 429) {
            throw new ApiError(429, 'rate_limit_exceeded', rateLimitMessage(authenticated));
          }
          throw new ApiError(502, 'github_unavailable', 'GitHub is temporarily unavailable.');
        }
        throw error;
      }
    }

    if (query.type === 'tree') {
      try {
        const tree = await loadInstantGateTree({
          repo: query.repo,
          branch,
          headers,
          cacheKey: `public:${query.repo}`,
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
            throw new ApiError(429, 'rate_limit_exceeded', rateLimitMessage(authenticated));
          }
          throw new ApiError(502, 'github_unavailable', 'GitHub is temporarily unavailable.');
        }
        throw error;
      }
    }

    const content = await fetchGitHubFile(token || '', query.repo, query.path, branch, 1024 * 1024);
    return new Response(content, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  },
);

const batchBody = z
  .object({
    repo: repositoryName,
    branch: branchName.optional(),
    paths: z.array(filePath).min(1).max(INSTANT_GATE_MAX_FILES),
  })
  .strict();

// Batch file read: the client sends every path a scan needs in one request and
// the server fans out to GitHub with bounded concurrency using its own token.
// This replaces hundreds of per-file round trips that both tripped the request
// rate limit and turned a large repository into minutes of latency.
export const POST = secureRoute(
  {
    routeId: 'github:public-scan-batch',
    auth: 'optional',
    query: z.object({}).strict(),
    params: z.object({}).strict(),
    body: batchBody,
    bodyMode: 'json',
    maxBodyBytes: 128 * 1024,
    rateLimit: RATE_LIMITS.public,
    csrf: true,
  },
  async ({ body, auth, request }) => {
    const githubAccessToken =
      auth?.githubAccessToken ?? (auth ? await resolveGitHubAccessToken(request) : undefined);
    const token = resolveGitHubReadToken(githubAccessToken);
    const authenticated = Boolean(token);
    const headers = githubHeaders(token);

    const metadataResponse = await fetch(githubRepositoryApiUrl(body.repo), {
      headers,
      signal: AbortSignal.timeout(GITHUB_FETCH_TIMEOUT_MS),
    });
    if (!metadataResponse.ok) {
      if (metadataResponse.status === 404) {
        throw new ApiError(
          404,
          'repo_not_found',
          'Repository not found. Please verify it is a PUBLIC repository and formatted as "owner/repo".',
        );
      }
      if (metadataResponse.status === 403 || metadataResponse.status === 429) {
        throw new ApiError(429, 'rate_limit_exceeded', rateLimitMessage(authenticated));
      }
      throw new ApiError(502, 'github_unavailable', 'GitHub is temporarily unavailable.');
    }
    const metadata = metadataSchema.parse(await metadataResponse.json());
    if (metadata.private)
      throw new ApiError(403, 'private_repository', 'Private repository is not available.');
    const branch = body.branch || metadata.default_branch;

    const files = await fetchGitHubFilesBatch(token || '', body.repo, body.paths, branch);
    return NextResponse.json({ default_branch: branch, files });
  },
);
