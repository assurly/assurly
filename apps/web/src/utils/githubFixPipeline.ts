import crypto from 'node:crypto';
import { z } from 'zod';
import type { GitHubAutoFix, GitHubAutoFixFileGroup } from './githubAutoFix';
import {
  applyAutoFixToFileContent,
  autoFixGroupCommitMessage,
  fileHasEnvStatementKey,
  isRlsAutoFix,
  resolveAutoFixTargetPath,
  rlsFixRefusalReason,
  summarizeAutoFixPlan,
} from './githubAutoFix';
import {
  AutoFixAlreadyAppliedError,
  AutoFixNotApplicableError,
  encodeGitHubPath,
  GitHubApiError,
  githubContentsApiUrl,
  getInstallationAccessToken,
  githubHeaders,
  githubRepositoryApiUrl,
  GitHubWriteAccessError,
  isGitHubRepositoryName,
  requireGitHubRef,
  resolveGitHubWriteTarget,
  type GitHubWriteTarget,
} from './githubApp';

const WORKFLOW_DIRECTORY_PREFIX = '.github/workflows/';

function isWorkflowFilePath(filePath: string): boolean {
  return filePath.startsWith(WORKFLOW_DIRECTORY_PREFIX);
}

// GitHub blocks user-to-server (OAuth) tokens from writing files under
// .github/workflows/ even when the App installation holds the Workflows
// permission. Those files must be committed with an installation token — which
// is only possible on the upstream repo (an installation token cannot push to a
// user's fork). Returns undefined when no installation token applies; the caller
// then falls back to the default token, which 404s and is surfaced as a clear
// "grant the Workflows permission / run npx assurly init" message.
async function resolveWorkflowCommitToken(options: {
  needed: boolean;
  isUpstreamCommit: boolean;
  installationId?: string;
  repositoryId?: number;
}): Promise<string | undefined> {
  if (!options.needed || !options.isUpstreamCommit || !options.installationId) return undefined;
  try {
    return await getInstallationAccessToken(options.installationId, options.repositoryId);
  } catch {
    return undefined;
  }
}

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
  // Preserve the real GitHub status (and a short body excerpt) so the API layer
  // can return an actionable message — e.g. 404/422 → "repository not accessible,
  // re-install the app" — instead of a generic "temporarily unavailable", and so
  // the failure is diagnosable in the server logs.
  const detail = await response.text().catch(() => '');
  throw new GitHubApiError(
    response.status,
    `${operation} failed (GitHub ${response.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`,
  );
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
  return `assurly-fix-${crypto.createHash('sha256').update(seed).digest('hex').slice(0, 12)}`;
}

function decodeGitHubFileContent(encoded: string): string | null {
  try {
    return Buffer.from(encoded.replace(/\n/g, ''), 'base64').toString('utf8');
  } catch {
    return null;
  }
}

async function readRepositoryFileContent(
  repositoryName: string,
  filePath: string,
  ref: string,
  token: string,
): Promise<string | null> {
  encodeGitHubPath(filePath);
  const response = await githubRequest(githubContentsApiUrl(repositoryName, filePath, ref), token);
  if (!response.ok) return null;
  const parsed = fileSchema.safeParse(await response.json());
  if (!parsed.success) return null;
  return decodeGitHubFileContent(parsed.data.content);
}

async function assertRlsSourceAllowsFix(options: {
  repositoryName: string;
  sourceFilePath: string;
  ref: string;
  token: string;
}): Promise<void> {
  const content = await readRepositoryFileContent(
    options.repositoryName,
    options.sourceFilePath,
    options.ref,
    options.token,
  );
  if (content === null) {
    throw new AutoFixNotApplicableError(
      `Assurly could not read '${options.sourceFilePath}' from GitHub, so this PostgreSQL-only Row-Level Security fix was not applied. Re-scan the repository and try again.`,
    );
  }
  const reason = rlsFixRefusalReason(options.sourceFilePath, content);
  if (reason) throw new AutoFixNotApplicableError(reason);
}

async function assertRlsFixesAllowed(options: {
  repositoryName: string;
  ref: string;
  token: string;
  fixes: readonly GitHubAutoFix[];
  fallbackSourcePath?: string;
}): Promise<void> {
  const sourcePaths = new Set<string>();
  for (const fix of options.fixes) {
    if (!isRlsAutoFix(fix)) continue;
    const source = fix.sourceFilePath ?? options.fallbackSourcePath;
    if (!source) {
      throw new AutoFixNotApplicableError(
        'Assurly could not read the SQL source file from GitHub, so this PostgreSQL-only Row-Level Security fix was not applied. Re-scan the repository and try again.',
      );
    }
    sourcePaths.add(source);
  }
  for (const sourceFilePath of sourcePaths) {
    await assertRlsSourceAllowsFix({
      repositoryName: options.repositoryName,
      sourceFilePath,
      ref: options.ref,
      token: options.token,
    });
  }
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
  const targetFilePath = resolveAutoFixTargetPath(input.filePath, input.fix);
  await assertRlsFixesAllowed({
    repositoryName,
    ref: baseBranch,
    token: writeTarget.token,
    fixes: [input.fix],
    fallbackSourcePath: input.filePath,
  });
  const workflowToken = await resolveWorkflowCommitToken({
    needed: isWorkflowFilePath(targetFilePath),
    isUpstreamCommit: writeTarget.commitRepositoryName === repositoryName,
    installationId: input.installationId,
    repositoryId: input.repositoryId,
  });
  const prUrl = await commitFixAndOpenPullRequest({
    writeTarget,
    repositoryName,
    baseBranch,
    filePath: targetFilePath,
    fix: input.fix,
    fixBranch,
    commitToken: workflowToken,
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
  // Optional installation token used only for the file write, when the user
  // token may not write the target (e.g. .github/workflows/ files).
  commitToken?: string;
}): Promise<string> {
  const {
    writeTarget: { token, commitRepositoryName, pullRequestRepositoryName, pullRequestHeadOwner },
    repositoryName,
    baseBranch,
    filePath,
    fix,
    fixBranch,
  } = options;
  const commitToken = options.commitToken ?? token;

  const refResponse = await requireOk(
    await githubRequest(
      githubRepositoryApiUrl(repositoryName, 'git', 'ref', 'heads', baseBranch),
      token,
    ),
    'Base branch lookup',
  );
  const ref = referenceSchema.parse(await refResponse.json());

  await ensureFixBranch(commitRepositoryName, baseBranch, fixBranch, ref.object.sha, token);

  // Read the current blob on the fix branch (not main). A stable seed such as
  // canary-plant:<targetId> reuses the branch; GitHub 409s if we PUT main's SHA.
  const fileLookupResponse = await githubRequest(
    githubContentsApiUrl(commitRepositoryName, filePath, fixBranch),
    token,
  );

  let original = '';
  let commitFileSha: string | undefined;

  if (fileLookupResponse.ok) {
    const file = fileSchema.parse(await fileLookupResponse.json());
    original = Buffer.from(file.content.replace(/\n/g, ''), 'base64').toString('utf8');
    commitFileSha = file.sha;
  } else if (fileLookupResponse.status === 404) {
    // Missing target is expected for new RLS migrations and absent .env.example —
    // append and create both start from empty content (same as the batch path).
    original = '';
    commitFileSha = undefined;
  } else {
    await requireOk(fileLookupResponse, 'File lookup');
  }

  if (fix.applyMode === 'upsert-env') {
    const baseLookupResponse = await githubRequest(
      githubContentsApiUrl(repositoryName, filePath, baseBranch),
      token,
    );
    if (baseLookupResponse.ok) {
      const baseFile = fileSchema.parse(await baseLookupResponse.json());
      const baseOriginal = Buffer.from(baseFile.content.replace(/\n/g, ''), 'base64').toString(
        'utf8',
      );
      if (fileHasEnvStatementKey(baseOriginal, fix.statement)) {
        throw new AutoFixAlreadyAppliedError();
      }
    } else if (baseLookupResponse.status !== 404) {
      await requireOk(baseLookupResponse, 'Base file lookup');
    }
  }

  const content = applyAutoFixToFileContent(original, fix);
  if (content === original) {
    throw new AutoFixAlreadyAppliedError();
  }

  const putBody: Record<string, unknown> = {
    message: fix.title,
    content: Buffer.from(content).toString('base64'),
    branch: fixBranch,
  };
  if (commitFileSha) putBody.sha = commitFileSha;

  await requireOk(
    await githubRequest(githubContentsApiUrl(commitRepositoryName, filePath), commitToken, {
      method: 'PUT',
      body: JSON.stringify(putBody),
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
        body: `${fix.description}\n\nApplied automatically by Assurly.`,
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

export interface ExecuteGitHubBatchFixInput {
  repositoryName: string;
  baseBranch: string;
  files: readonly GitHubAutoFixFileGroup[];
  branchSeed: string;
  userGitHubToken?: string;
  installationId?: string;
  repositoryId?: number;
}

export interface GitHubBatchFixRefusal {
  filePath: string;
  reason: string;
}

export interface GitHubBatchFixResult {
  prUrl: string;
  /** Target file paths that are present on the fix branch (committed or already applied). */
  committedFilePaths: string[];
  /** Target file paths that could not be committed (e.g. missing workflow scope). */
  skippedFilePaths: string[];
  /** Target file paths refused because the finding source is not PostgreSQL. */
  refusedFixes: GitHubBatchFixRefusal[];
}

/**
 * Commits fixes across multiple files onto a single branch and opens one
 * combined pull request. Individual files that cannot be committed (for example
 * `.github/workflows/*` files when the token lacks the `workflow` scope) are
 * skipped so the remaining fixes still ship in one PR. Throws only when no file
 * could be committed and no existing pull request is found.
 */
export async function executeGitHubBatchFixPullRequest(
  input: ExecuteGitHubBatchFixInput,
): Promise<GitHubBatchFixResult> {
  const repositoryName = input.repositoryName;
  if (!isGitHubRepositoryName(repositoryName)) {
    throw new Error('The connected repository name is invalid.');
  }
  if (input.files.length === 0) {
    throw new Error('No files were provided for the combined fix.');
  }

  const baseBranch = requireGitHubRef(input.baseBranch);
  for (const group of input.files) {
    encodeGitHubPath(group.filePath);
  }

  const writeTarget = await resolveGitHubWriteTarget({
    userGitHubToken: input.userGitHubToken,
    repositoryName,
    installationId: input.installationId,
    repositoryId: input.repositoryId,
  });

  const fixBranch = buildFixBranch(input.branchSeed);
  const { token, commitRepositoryName, pullRequestRepositoryName, pullRequestHeadOwner } =
    writeTarget;

  const workflowToken = await resolveWorkflowCommitToken({
    needed: input.files.some((group) => isWorkflowFilePath(group.filePath)),
    isUpstreamCommit: commitRepositoryName === repositoryName,
    installationId: input.installationId,
    repositoryId: input.repositoryId,
  });

  const refResponse = await requireOk(
    await githubRequest(
      githubRepositoryApiUrl(repositoryName, 'git', 'ref', 'heads', baseBranch),
      token,
    ),
    'Base branch lookup',
  );
  const ref = referenceSchema.parse(await refResponse.json());

  await ensureFixBranch(commitRepositoryName, baseBranch, fixBranch, ref.object.sha, token);

  const committedFilePaths: string[] = [];
  const skippedFilePaths: string[] = [];
  const refusedFixes: GitHubBatchFixRefusal[] = [];
  let lastCommitError: unknown = null;

  for (const group of input.files) {
    const commitToken = isWorkflowFilePath(group.filePath) && workflowToken ? workflowToken : token;
    try {
      await assertRlsFixesAllowed({
        repositoryName,
        ref: baseBranch,
        token,
        fixes: group.fixes,
      });
      await commitFileGroupToBranch({ token: commitToken, commitRepositoryName, fixBranch, group });
      committedFilePaths.push(group.filePath);
    } catch (error) {
      // A revoked or unauthorized token is fatal for the whole batch.
      if (error instanceof GitHubWriteAccessError) throw error;
      if (error instanceof AutoFixNotApplicableError) {
        refusedFixes.push({ filePath: group.filePath, reason: error.message });
        skippedFilePaths.push(group.filePath);
        lastCommitError = error;
        continue;
      }
      console.error(`[github/fix] skipped ${group.filePath}:`, error);
      lastCommitError = error;
      skippedFilePaths.push(group.filePath);
    }
  }

  if (committedFilePaths.length === 0) {
    if (lastCommitError instanceof AutoFixNotApplicableError) throw lastCommitError;
    const existingUrl = await findExistingPullRequest(
      pullRequestRepositoryName,
      pullRequestHeadOwner,
      fixBranch,
      token,
    );
    if (existingUrl) {
      return { prUrl: existingUrl, committedFilePaths, skippedFilePaths, refusedFixes };
    }
    if (lastCommitError) throw lastCommitError;
    throw new AutoFixAlreadyAppliedError();
  }

  // Describe the pull request from what actually committed, not the full plan,
  // so the body never lists a file that was skipped (e.g. a workflow file GitHub
  // blocks in a fork pull request).
  const committedSet = new Set(committedFilePaths);
  const committedGroups = input.files.filter((group) => committedSet.has(group.filePath));
  const skippedGroups = input.files.filter((group) => !committedSet.has(group.filePath));
  const { prTitle, prDescription } = summarizeAutoFixPlan(committedGroups, skippedGroups);

  const prUrl = await openPullRequest({
    repositoryName: pullRequestRepositoryName,
    headOwner: pullRequestHeadOwner,
    baseBranch,
    fixBranch,
    title: prTitle,
    body: prDescription,
    token,
  });

  return { prUrl, committedFilePaths, skippedFilePaths, refusedFixes };
}

/** Applies every fix in a group to one file and commits it if the content changed. */
async function commitFileGroupToBranch(options: {
  token: string;
  commitRepositoryName: string;
  fixBranch: string;
  group: GitHubAutoFixFileGroup;
}): Promise<boolean> {
  const { token, commitRepositoryName, fixBranch, group } = options;
  const filePath = group.filePath;

  // Read the current state on the fix branch itself so the flow is correct for
  // forks and idempotent when the batch branch already exists.
  const fileLookupResponse = await githubRequest(
    githubContentsApiUrl(commitRepositoryName, filePath, fixBranch),
    token,
  );

  let original = '';
  let commitFileSha: string | undefined;

  if (fileLookupResponse.ok) {
    const file = fileSchema.parse(await fileLookupResponse.json());
    original = Buffer.from(file.content.replace(/\n/g, ''), 'base64').toString('utf8');
    commitFileSha = file.sha;
  } else if (fileLookupResponse.status === 404) {
    // A missing file is treated as empty; append and create fixes will create it.
    original = '';
    commitFileSha = undefined;
  } else {
    await requireOk(fileLookupResponse, 'File lookup');
  }

  let content = original;
  for (const fix of group.fixes) {
    content = applyAutoFixToFileContent(content, fix);
  }

  if (content === original) return false;

  const putBody: Record<string, unknown> = {
    message: autoFixGroupCommitMessage(group),
    content: Buffer.from(content).toString('base64'),
    branch: fixBranch,
  };
  if (commitFileSha) putBody.sha = commitFileSha;

  await requireOk(
    await githubRequest(githubContentsApiUrl(commitRepositoryName, filePath), token, {
      method: 'PUT',
      body: JSON.stringify(putBody),
    }),
    'Fix commit',
  );

  return true;
}

/** Opens a pull request, reusing an existing one when GitHub reports a duplicate. */
async function openPullRequest(options: {
  repositoryName: string;
  headOwner: string;
  baseBranch: string;
  fixBranch: string;
  title: string;
  body: string;
  token: string;
}): Promise<string> {
  const { repositoryName, headOwner, baseBranch, fixBranch, title, body, token } = options;

  const pullRequestResponse = await githubRequest(
    githubRepositoryApiUrl(repositoryName, 'pulls'),
    token,
    {
      method: 'POST',
      body: JSON.stringify({
        title,
        head: `${headOwner}:${fixBranch}`,
        base: baseBranch,
        body,
      }),
    },
  );

  if (pullRequestResponse.ok) {
    return pullRequestSchema.parse(await pullRequestResponse.json()).html_url;
  }

  if (pullRequestResponse.status === 422) {
    const existingUrl = await findExistingPullRequest(repositoryName, headOwner, fixBranch, token);
    if (existingUrl) return existingUrl;
  }

  await requireOk(pullRequestResponse, 'Pull request creation');
  return '';
}
