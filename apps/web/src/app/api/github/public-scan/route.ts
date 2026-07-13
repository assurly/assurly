import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveGitHubAccessToken } from '../../../../utils/auth';
import { emptyBodySchema, RATE_LIMITS, secureRoute, ApiError } from '../../../../utils/apiSecurity';
import {
  fetchGitHubFile,
  githubHeaders,
  githubRepositoryApiUrl,
  readLimitedResponseText,
  resolveGitHubReadToken,
} from '../../../../utils/githubApp';

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
]);
const metadataSchema = z
  .object({
    default_branch: z.string().min(1).max(255),
    private: z.boolean(),
  })
  .passthrough();
const treeSchema = z
  .object({
    tree: z
      .array(
        z
          .object({
            path: z.string().min(1).max(1024),
            type: z.enum(['blob', 'tree', 'commit']),
          })
          .passthrough(),
      )
      .max(5000),
    truncated: z.boolean().optional(),
  })
  .passthrough();
const commitSchema = z.object({ sha: z.string().min(1).max(64) }).passthrough();

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
    const metadataResponse = await fetch(githubRepositoryApiUrl(query.repo), { headers });
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

    if (query.type === 'tree') {
      const treeUrl = new URL(githubRepositoryApiUrl(query.repo, 'git', 'trees', branch));
      treeUrl.searchParams.set('recursive', '1');
      const commitUrl = githubRepositoryApiUrl(query.repo, 'commits', branch);

      const [treeResponse, commitResponse] = await Promise.all([
        fetch(treeUrl, { headers }),
        fetch(commitUrl, { headers }),
      ]);

      if (!treeResponse.ok) {
        if (treeResponse.status === 403 || treeResponse.status === 429) {
          throw new ApiError(429, 'rate_limit_exceeded', rateLimitMessage(authenticated));
        }
        throw new ApiError(502, 'github_unavailable', 'GitHub is temporarily unavailable.');
      }

      const tree = treeSchema.parse(
        JSON.parse(await readLimitedResponseText(treeResponse, 2 * 1024 * 1024)),
      );

      // Best-effort: if the commit lookup fails (e.g. edge-case permissions), omit the SHA
      // rather than failing the entire scan.
      let commitSha: string | undefined;
      if (commitResponse.ok) {
        try {
          const commitData = commitSchema.parse(await commitResponse.json());
          commitSha = commitData.sha;
        } catch {
          // Non-critical – scan proceeds without a commit SHA
        }
      }

      return NextResponse.json({ ...tree, default_branch: branch, commit_sha: commitSha });
    }

    const content = await fetchGitHubFile(token || '', query.repo, query.path, branch, 1024 * 1024);
    return new Response(content, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  },
);

const batchBody = z
  .object({
    repo: repositoryName,
    branch: branchName.optional(),
    paths: z.array(filePath).min(1).max(300),
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

    const metadataResponse = await fetch(githubRepositoryApiUrl(body.repo), { headers });
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

    const uniquePaths = [...new Set(body.paths)];
    const results = new Map<string, string | null>();
    const CONCURRENCY = 15;
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < uniquePaths.length) {
        const path = uniquePaths[cursor++];
        try {
          results.set(
            path,
            await fetchGitHubFile(token || '', body.repo, path, branch, 512 * 1024),
          );
        } catch {
          // A single unreadable file (missing, too large, transient) must not
          // fail the whole batch — the scan proceeds without it.
          results.set(path, null);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, uniquePaths.length) }, worker));

    return NextResponse.json({
      default_branch: branch,
      files: uniquePaths.map((path) => ({ path, content: results.get(path) ?? null })),
    });
  },
);
