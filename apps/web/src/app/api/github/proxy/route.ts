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
  isGitHubRepositoryName,
  readLimitedResponseText,
} from '../../../../utils/githubApp';

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
]);
const batchBody = z
  .object({
    repoId: z.string().uuid(),
    branch: branchSchema.optional(),
    paths: z.array(filePathSchema).min(1).max(300),
  })
  .strict();
const metadataSchema = z.object({ default_branch: z.string().min(1).max(255) }).passthrough();
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
      const treeUrl = new URL(githubRepositoryApiUrl(repositoryName, 'git', 'trees', branch));
      treeUrl.searchParams.set('recursive', '1');
      const commitUrl = githubRepositoryApiUrl(repositoryName, 'commits', branch);
      const authHeaders = githubHeaders(token);

      const [treeResponse, commitResponse] = await Promise.all([
        fetch(treeUrl, { headers: authHeaders }),
        fetch(commitUrl, { headers: authHeaders }),
      ]);

      if (!treeResponse.ok) throw new ApiError(502, 'github_unavailable', 'GitHub is unavailable.');

      const tree = treeSchema.parse(
        JSON.parse(await readLimitedResponseText(treeResponse, 2 * 1024 * 1024)),
      );

      // Best-effort: if the commit lookup fails, omit SHA rather than failing the scan.
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
