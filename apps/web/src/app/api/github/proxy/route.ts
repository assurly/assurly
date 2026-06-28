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
  getInstallationAccessToken,
  githubHeaders,
  githubRepositoryApiUrl,
  isGitHubRepositoryName,
  readLimitedResponseText,
} from '../../../../utils/githubApp';

const baseQuery = {
  repoId: z.string().uuid(),
  branch: z
    .string()
    .min(1)
    .max(255)
    .refine((value) => !value.includes('..') && !value.includes('\0'))
    .optional(),
};
const proxyQuery = z.discriminatedUnion('type', [
  z.object({ ...baseQuery, type: z.literal('tree') }).strict(),
  z
    .object({
      ...baseQuery,
      type: z.literal('file'),
      path: z
        .string()
        .min(1)
        .max(1024)
        .refine(
          (value) =>
            !value.split('/').some((part) => !part || part === '.' || part === '..') &&
            !value.includes('\\') &&
            !value.startsWith('/'),
        ),
    })
    .strict(),
]);
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
    const { repository, organization } = await requireRepositoryAccess(context, query.repoId);
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

    let branch = query.branch;
    if (!branch) {
      const response = await fetch(githubRepositoryApiUrl(repository.name), {
        headers: githubHeaders(token),
      });
      if (!response.ok) throw new ApiError(502, 'github_unavailable', 'GitHub is unavailable.');
      branch = metadataSchema.parse(await response.json()).default_branch;
    }

    if (query.type === 'tree') {
      const treeUrl = new URL(githubRepositoryApiUrl(repository.name, 'git', 'trees', branch));
      treeUrl.searchParams.set('recursive', '1');
      const commitUrl = githubRepositoryApiUrl(repository.name, 'commits', branch);
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

    const content = await fetchGitHubFile(token, repository.name, query.path, branch, 1024 * 1024);
    return new Response(content, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  },
);
