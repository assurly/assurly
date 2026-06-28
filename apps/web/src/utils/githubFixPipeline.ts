import crypto from 'node:crypto';
import { z } from 'zod';
import type { GitHubAutoFix } from './githubAutoFix';
import {
  encodeGitHubPath,
  githubContentsApiUrl,
  githubHeaders,
  githubRepositoryApiUrl,
  GitHubWriteAccessError,
  isGitHubRepositoryName,
  requireGitHubRef,
  resolveGitHubWriteTarget,
  type GitHubWriteTarget,
} from './githubApp';

const referenceSchema = z.object({
  object: z.object({ sha: z.string().regex(/^[a-f0-9]{40,64}$/i) }),
});
const fileSchema = z
  .object({
    sha: z.string().min(1).max(100),
    content: z.string().max(700_000),
    encoding: z.literal('base64'),
  })
  .passthrough();
const pullRequestSchema = z.object({ html_url: z.string().url() }).passthrough();
const pullRequestListSchema = z
  .array(z.object({ html_url: z.string().url() }).passthrough())
  .max(20);

export interface ExecuteGitHubFixInput {
  repositoryName: string;
  baseBranch: string;
  filePath: string;
  fix: GitHubAutoFix;
  branchSeed: string;
  userGitHubToken?: string;
  installationId?: string;
  repositoryId?: number;
}

async function githubRequest(
  url: string,
  token: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: {
      ...githubHeaders(token),
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
}

async function requireOk(response: Response, operation: string): Promise<Response> {
  if (response.ok) return response;
  if (response.status === 403) {
    throw new GitHubWriteAccessError(
      'Your GitHub account cannot create branches in this repository. Sign out, sign in again, and approve repository access when GitHub prompts you.',
    );
  }
  throw new Error(`${operation} is unavailable.`);
}

async function ensureFixBranch(
  repositoryName: string,
  baseBranch: string,
  fixBranch: string,
  baseSha: string,
  token: string,
): Promise<void> {
  const createResponse = await githubRequest(
    githubRepositoryApiUrl(repositoryName, 'git', 'refs'),
    token,
    {
      method: 'POST',
      body: JSON.stringify({ ref: `refs/heads/${fixBranch}`, sha: baseSha }),
    },
  );
  if (createResponse.ok) return;

  if (createResponse.status !== 422) {
    await requireOk(createResponse, 'Fix branch creation');
    return;
  }

  await requireOk(
    await githubRequest(
      githubRepositoryApiUrl(repositoryName, 'git', 'ref', 'heads', fixBranch),
      token,
    ),
    'Fix branch lookup',
  );
}

async function findExistingPullRequest(
  repositoryName: string,
  headOwner: string,
  fixBranch: string,
  token: string,
): Promise<string | null> {
  const listUrl = new URL(githubRepositoryApiUrl(repositoryName, 'pulls'));
  listUrl.searchParams.set('head', `${headOwner}:${fixBranch}`);
  listUrl.searchParams.set('state', 'all');
  listUrl.searchParams.set('per_page', '5');

  const response = await githubRequest(listUrl.toString(), token);
  if (!response.ok) return null;

  const pullRequests = pullRequestListSchema.safeParse(await response.json());
  return pullRequests.success && pullRequests.data[0]?.html_url
    ? pullRequests.data[0].html_url
    : null;
}

function buildFixBranch(seed: string): string {
  return `shipready-fix-${crypto.createHash('sha256').update(seed).digest('hex').slice(0, 12)}`;
}

/** Creates or reuses a GitHub pull request for an allowlisted auto-fix. */
export async function executeGitHubFixPullRequest(input: ExecuteGitHubFixInput): Promise<string> {
  const repositoryName = input.repositoryName;
  if (!isGitHubRepositoryName(repositoryName)) {
    throw new Error('The connected repository name is invalid.');
  }

  const baseBranch = requireGitHubRef(input.baseBranch);
  const filePath = input.filePath;
  encodeGitHubPath(filePath);

  const writeTarget = await resolveGitHubWriteTarget({
    userGitHubToken: input.userGitHubToken,
    repositoryName,
    installationId: input.installationId,
    repositoryId: input.repositoryId,
  });

  const fixBranch = buildFixBranch(input.branchSeed);
  const prUrl = await commitFixAndOpenPullRequest({
    writeTarget,
    repositoryName,
    baseBranch,
    filePath,
    fix: input.fix,
    fixBranch,
  });
  return prUrl;
}

async function commitFixAndOpenPullRequest(options: {
  writeTarget: GitHubWriteTarget;
  repositoryName: string;
  baseBranch: string;
  filePath: string;
  fix: GitHubAutoFix;
  fixBranch: string;
}): Promise<string> {
  const {
    writeTarget: { token, commitRepositoryName, pullRequestRepositoryName, pullRequestHeadOwner },
    repositoryName,
    baseBranch,
    filePath,
    fix,
    fixBranch,
  } = options;

  const refResponse = await requireOk(
    await githubRequest(
      githubRepositoryApiUrl(repositoryName, 'git', 'ref', 'heads', baseBranch),
      token,
    ),
    'Base branch lookup',
  );
  const ref = referenceSchema.parse(await refResponse.json());

  await ensureFixBranch(commitRepositoryName, baseBranch, fixBranch, ref.object.sha, token);

  const fileResponse = await requireOk(
    await githubRequest(githubContentsApiUrl(repositoryName, filePath, baseBranch), token),
    'File lookup',
  );
  const file = fileSchema.parse(await fileResponse.json());
  const original = Buffer.from(file.content.replace(/\n/g, ''), 'base64').toString('utf8');
  const content = `${original}${original && !original.endsWith('\n') ? '\n' : ''}${fix.statement}\n`;

  let commitFileSha = file.sha;
  if (commitRepositoryName !== repositoryName) {
    const forkFileResponse = await requireOk(
      await githubRequest(githubContentsApiUrl(commitRepositoryName, filePath, baseBranch), token),
      'Fork file lookup',
    );
    commitFileSha = fileSchema.parse(await forkFileResponse.json()).sha;
  }

  await requireOk(
    await githubRequest(githubContentsApiUrl(commitRepositoryName, filePath), token, {
      method: 'PUT',
      body: JSON.stringify({
        message: fix.title,
        content: Buffer.from(content).toString('base64'),
        sha: commitFileSha,
        branch: fixBranch,
      }),
    }),
    'Fix commit',
  );

  const pullRequestResponse = await githubRequest(
    githubRepositoryApiUrl(pullRequestRepositoryName, 'pulls'),
    token,
    {
      method: 'POST',
      body: JSON.stringify({
        title: fix.title,
        head: `${pullRequestHeadOwner}:${fixBranch}`,
        base: baseBranch,
        body: `${fix.description}\n\nApplied automatically by ShipReady.`,
      }),
    },
  );

  if (pullRequestResponse.ok) {
    return pullRequestSchema.parse(await pullRequestResponse.json()).html_url;
  }

  if (pullRequestResponse.status === 422) {
    const existingUrl = await findExistingPullRequest(
      pullRequestRepositoryName,
      pullRequestHeadOwner,
      fixBranch,
      token,
    );
    if (existingUrl) return existingUrl;
  }

  await requireOk(pullRequestResponse, 'Pull request creation');
  return '';
}
