import crypto from 'node:crypto';
import { ConfigurationError } from './env';

const GITHUB_API_URL = 'https://api.github.com';
const GITHUB_API_VERSION = '2026-03-10';
const GITHUB_USER_AGENT = 'Assurly-App';

export interface GitHubAppConfig {
  appId: string;
  privateKey: string;
}

export interface GitHubInstallationState {
  userId: string;
  organizationId: string;
  expiresAt: number;
  nonce: string;
}

/**
 * Raised when an authenticated GitHub API call returns a non-OK status. Carries
 * the upstream HTTP status so callers can translate it into a meaningful,
 * correctly-classified client response instead of an opaque 500.
 */
export class GitHubApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'GitHubApiError';
  }
}

/** Raised when no available credential can write to the target repository. */
export class GitHubWriteAccessError extends Error {
  readonly status = 403;

  constructor(message: string) {
    super(message);
    this.name = 'GitHubWriteAccessError';
  }
}

/** Raised when the target file already contains the proposed fix. */
export class AutoFixAlreadyAppliedError extends Error {
  readonly status = 409;

  constructor(message = 'This fix has already been applied.') {
    super(message);
    this.name = 'AutoFixAlreadyAppliedError';
  }
}

/** Server-side PAT used by the public-scan proxy and as a write fallback for auto-fix. */
export function getGitHubServerPat(): string | undefined {
  const value = process.env.GITHUB_PAT?.trim() || process.env.GITHUB_TOKEN?.trim();
  return value || undefined;
}

/** Resolves the best available GitHub token for read-only repository access. */
export function resolveGitHubReadToken(userGitHubToken?: string): string | undefined {
  return userGitHubToken || getGitHubServerPat();
}

const RELOGIN_FOR_WRITE_MESSAGE =
  'Assurly needs permission to create pull requests on GitHub. Sign out, sign in again, and approve repository access when prompted.';

interface RepositoryPermissionsResponse {
  permissions?: {
    push?: boolean;
    admin?: boolean;
  };
}

async function tokenHasRepoWriteScope(token: string): Promise<boolean> {
  const response = await fetch(`${GITHUB_API_URL}/user`, {
    headers: githubHeaders(token),
  });
  if (!response.ok) return false;
  const scopes =
    response.headers
      .get('x-oauth-scopes')
      ?.split(',')
      .map((scope) => scope.trim()) ?? [];
  return scopes.includes('repo') || scopes.includes('public_repo');
}

/** Returns true when the token can push commits to the repository. */
export async function tokenCanPushToRepository(
  token: string,
  repositoryName: string,
): Promise<boolean> {
  const response = await fetch(githubRepositoryApiUrl(repositoryName), {
    headers: githubHeaders(token),
  });
  if (!response.ok) return false;

  const data = (await response.json()) as RepositoryPermissionsResponse;
  if (data.permissions?.push || data.permissions?.admin) return true;
  if (data.permissions) return false;

  return tokenHasRepoWriteScope(token);
}

export interface GitHubWriteTokenOptions {
  userGitHubToken?: string;
  repositoryName: string;
  installationId?: string;
  repositoryId?: number;
}

export interface GitHubWriteTarget {
  token: string;
  /** Repository where fix branches and commits are created. */
  commitRepositoryName: string;
  /** Upstream repository that receives the pull request. */
  pullRequestRepositoryName: string;
  /** GitHub login used in the PR head ref (`owner:branch`). */
  pullRequestHeadOwner: string;
}

async function getGitHubAuthenticatedLogin(token: string): Promise<string | null> {
  const response = await fetch(`${GITHUB_API_URL}/user`, { headers: githubHeaders(token) });
  if (!response.ok) return null;
  const data = (await response.json()) as { login?: unknown };
  return typeof data.login === 'string' && data.login.length > 0 ? data.login : null;
}

async function ensureUserFork(token: string, upstreamName: string): Promise<string | null> {
  const [, repo] = parseGitHubRepositoryName(upstreamName);
  const login = await getGitHubAuthenticatedLogin(token);
  if (!login) return null;

  const expectedForkName = `${login}/${repo}`;
  if (isGitHubRepositoryName(expectedForkName)) {
    const existingFork = await fetch(githubRepositoryApiUrl(expectedForkName), {
      headers: githubHeaders(token),
    });
    if (existingFork.ok && (await tokenCanPushToRepository(token, expectedForkName))) {
      return expectedForkName;
    }
  }

  const forkResponse = await fetch(githubRepositoryApiUrl(upstreamName, 'forks'), {
    method: 'POST',
    headers: { ...githubHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!forkResponse.ok) return null;

  const fork = (await forkResponse.json()) as { full_name?: unknown };
  if (typeof fork.full_name !== 'string' || !isGitHubRepositoryName(fork.full_name)) return null;
  return (await tokenCanPushToRepository(token, fork.full_name)) ? fork.full_name : null;
}

/**
 * Resolves where Assurly should commit and open a fix PR. Uses direct write
 * access when available, otherwise forks a public upstream repo into the user's
 * account and opens a cross-repository pull request.
 */
export async function resolveGitHubWriteTarget(
  options: GitHubWriteTokenOptions,
): Promise<GitHubWriteTarget> {
  const upstream = options.repositoryName;
  const [upstreamOwner] = parseGitHubRepositoryName(upstream);

  const directTarget = async (token: string): Promise<GitHubWriteTarget | null> => {
    if (!(await tokenCanPushToRepository(token, upstream))) return null;
    return {
      token,
      commitRepositoryName: upstream,
      pullRequestRepositoryName: upstream,
      pullRequestHeadOwner: upstreamOwner,
    };
  };

  if (options.userGitHubToken) {
    const fromUser = await directTarget(options.userGitHubToken);
    if (fromUser) return fromUser;
  }

  if (options.installationId) {
    try {
      const installationToken = await getInstallationAccessToken(
        options.installationId,
        options.repositoryId,
      );
      const fromInstallation = await directTarget(installationToken);
      if (fromInstallation) return fromInstallation;
    } catch (error) {
      if (!(error instanceof GitHubApiError && (error.status === 404 || error.status === 422))) {
        throw error;
      }
    }
  }

  const pat = getGitHubServerPat();
  if (pat) {
    const fromPat = await directTarget(pat);
    if (fromPat) return fromPat;
  }

  if (options.userGitHubToken) {
    if (!(await tokenHasRepoWriteScope(options.userGitHubToken))) {
      throw new GitHubWriteAccessError(RELOGIN_FOR_WRITE_MESSAGE);
    }

    const forkName = await ensureUserFork(options.userGitHubToken, upstream);
    if (forkName) {
      const [forkOwner] = parseGitHubRepositoryName(forkName);
      return {
        token: options.userGitHubToken,
        commitRepositoryName: forkName,
        pullRequestRepositoryName: upstream,
        pullRequestHeadOwner: forkOwner,
      };
    }

    throw new GitHubWriteAccessError(
      'Unable to fork this repository. Confirm your GitHub account can fork public repositories and try again.',
    );
  }

  throw new GitHubWriteAccessError(
    'Sign in with GitHub and grant repository access to create fix pull requests on public repositories.',
  );
}

/**
 * Resolves a token that can write to GitHub. Tries the signed-in user's OAuth
 * token, the GitHub App installation token, and a server-side PAT — returning
 * the first credential that can actually push to the target repository.
 */
export async function resolveGitHubWriteToken(options: GitHubWriteTokenOptions): Promise<string> {
  return (await resolveGitHubWriteTarget(options)).token;
}

function requiredEnvironmentVariable(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new ConfigurationError(`${name} is required for GitHub integration.`);
  return value;
}

export function getGitHubAppConfig(): GitHubAppConfig {
  const appId = requiredEnvironmentVariable('GITHUB_APP_ID');
  if (!/^[0-9]+$/.test(appId)) throw new ConfigurationError('GITHUB_APP_ID must be numeric.');
  return {
    appId,
    privateKey: requiredEnvironmentVariable('GITHUB_PRIVATE_KEY').replace(/\\n/g, '\n'),
  };
}

export function getGitHubWebhookSecret(): string {
  return requiredEnvironmentVariable('GITHUB_WEBHOOK_SECRET');
}

export function getGitHubAppSlug(): string {
  const slug = requiredEnvironmentVariable('NEXT_PUBLIC_GITHUB_APP_NAME');
  if (!/^[A-Za-z0-9-]{1,100}$/.test(slug)) {
    throw new ConfigurationError('NEXT_PUBLIC_GITHUB_APP_NAME is invalid.');
  }
  return slug;
}

function getGitHubStateSecret(): string {
  return requiredEnvironmentVariable('GITHUB_STATE_SECRET');
}

export function verifyGitHubWebhookSignature(
  body: string,
  signature: string | null,
  secret = getGitHubWebhookSecret(),
): boolean {
  if (!signature || !/^sha256=[a-f0-9]{64}$/.test(signature)) return false;
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

function generateAppJwt(config: GitHubAppConfig): string {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({ iat: now - 60, exp: now + 540, iss: config.appId }),
  ).toString('base64url');
  const tokenInput = `${header}.${payload}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(tokenInput), config.privateKey);
  return `${tokenInput}.${signature.toString('base64url')}`;
}

function requireNumericId(value: string, label: string): string {
  if (!/^[0-9]{1,20}$/.test(value)) throw new Error(`Invalid ${label}.`);
  return value;
}

export function githubHeaders(token?: string, accept = 'application/vnd.github+json') {
  return {
    Accept: accept,
    'X-GitHub-Api-Version': GITHUB_API_VERSION,
    'User-Agent': GITHUB_USER_AGENT,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export async function getInstallationAccessToken(
  installationId: string,
  repositoryId?: number,
): Promise<string> {
  const config = getGitHubAppConfig();
  const normalizedInstallationId = requireNumericId(installationId, 'installation ID');
  const response = await fetch(
    `${GITHUB_API_URL}/app/installations/${normalizedInstallationId}/access_tokens`,
    {
      method: 'POST',
      headers: {
        ...githubHeaders(generateAppJwt(config)),
        'Content-Type': 'application/json',
      },
      body:
        repositoryId === undefined ? undefined : JSON.stringify({ repository_ids: [repositoryId] }),
    },
  );
  if (!response.ok) {
    throw new GitHubApiError(
      response.status,
      `GitHub installation token request failed (${response.status}).`,
    );
  }
  const data = (await response.json()) as { token?: unknown };
  if (typeof data.token !== 'string' || !data.token) {
    throw new GitHubApiError(502, 'GitHub installation token response is invalid.');
  }
  return data.token;
}

export async function getGitHubInstallation(installationId: string): Promise<unknown> {
  const config = getGitHubAppConfig();
  const response = await fetch(
    `${GITHUB_API_URL}/app/installations/${requireNumericId(installationId, 'installation ID')}`,
    { headers: githubHeaders(generateAppJwt(config)) },
  );
  if (!response.ok) throw new Error(`GitHub installation lookup failed (${response.status}).`);
  return response.json();
}

/**
 * Non-throwing check that a stored repository name is a valid GitHub
 * "owner/repo". Lets callers return a clear 4xx for malformed records instead
 * of letting {@link parseGitHubRepositoryName} throw an opaque error.
 */
export function isGitHubRepositoryName(fullName: string): boolean {
  const parts = fullName.split('/');
  return (
    parts.length === 2 &&
    parts.every((part) => /^[A-Za-z0-9_.-]+$/.test(part) && part.length <= 100)
  );
}

export function parseGitHubRepositoryName(fullName: string): [string, string] {
  if (!isGitHubRepositoryName(fullName)) {
    throw new Error('Invalid GitHub repository name.');
  }
  const parts = fullName.split('/');
  return [parts[0], parts[1]];
}

export function encodeGitHubPath(path: string): string {
  if (!path || path.startsWith('/') || path.includes('\\') || path.includes('\0')) {
    throw new Error('Invalid GitHub file path.');
  }
  const segments = path.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error('Invalid GitHub file path.');
  }
  return segments.map(encodeURIComponent).join('/');
}

export function githubRepositoryApiUrl(fullName: string, ...segments: string[]): string {
  const [owner, repository] = parseGitHubRepositoryName(fullName);
  const suffix = segments.length ? `/${segments.map(encodeURIComponent).join('/')}` : '';
  return `${GITHUB_API_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}${suffix}`;
}

export function requireGitHubRef(ref: string): string {
  if (!ref || ref.length > 255 || ref.includes('\0') || ref.includes('..')) {
    throw new Error('Invalid GitHub ref.');
  }
  return ref;
}

export function githubContentsApiUrl(fullName: string, path: string, ref?: string): string {
  const [owner, repository] = parseGitHubRepositoryName(fullName);
  const url = new URL(
    `${GITHUB_API_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/contents/${encodeGitHubPath(path)}`,
  );
  if (ref) url.searchParams.set('ref', requireGitHubRef(ref));
  return url.toString();
}

export async function fetchGitHubFile(
  token: string,
  fullName: string,
  path: string,
  ref: string,
  maxBytes = 512 * 1024,
): Promise<string> {
  const response = await fetch(githubContentsApiUrl(fullName, path, ref), {
    headers: githubHeaders(token, 'application/vnd.github.raw+json'),
  });
  if (!response.ok) throw new Error(`GitHub file fetch failed (${response.status}).`);
  return readLimitedResponseText(response, maxBytes);
}

export interface GitHubBatchFile {
  path: string;
  /** File contents, or `null` when the file could not be read (missing, too large, transient). */
  content: string | null;
}

/**
 * Fetches many repository files in one server-side pass with bounded concurrency.
 * A single unreadable file never fails the batch — its content comes back `null`.
 * This is what lets the scan proxies (public + private) replace hundreds of
 * per-file client round trips (which trip rate limits and take minutes) with one
 * request. Order of the returned array matches the de-duplicated input paths.
 */
export async function fetchGitHubFilesBatch(
  token: string,
  fullName: string,
  paths: readonly string[],
  ref: string,
  options: { concurrency?: number; maxBytes?: number } = {},
): Promise<GitHubBatchFile[]> {
  const { concurrency = 15, maxBytes = 512 * 1024 } = options;
  const uniquePaths = [...new Set(paths)];
  const results = new Map<string, string | null>();
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < uniquePaths.length) {
      const path = uniquePaths[cursor++];
      try {
        results.set(path, await fetchGitHubFile(token, fullName, path, ref, maxBytes));
      } catch {
        results.set(path, null);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, uniquePaths.length) }, worker));
  return uniquePaths.map((path) => ({ path, content: results.get(path) ?? null }));
}

export async function readLimitedResponseText(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const contentLength = Number(response.headers?.get?.('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error('GitHub response exceeds the configured size limit.');
  }
  if (!response.body) {
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > maxBytes) {
      throw new Error('GitHub response exceeds the configured size limit.');
    }
    return text;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error('GitHub response exceeds the configured size limit.');
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

export function createGitHubInstallationState(userId: string, organizationId: string): string {
  const payload: GitHubInstallationState = {
    userId,
    organizationId,
    expiresAt: Math.floor(Date.now() / 1000) + 10 * 60,
    nonce: crypto.randomBytes(18).toString('base64url'),
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', getGitHubStateSecret())
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${signature}`;
}

export function verifyGitHubInstallationState(state: string): GitHubInstallationState {
  const [encoded, signature, extra] = state.split('.');
  if (!encoded || !signature || extra) throw new Error('Invalid GitHub installation state.');
  const expected = crypto
    .createHmac('sha256', getGitHubStateSecret())
    .update(encoded)
    .digest('base64url');
  if (
    signature.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  ) {
    throw new Error('Invalid GitHub installation state.');
  }
  const payload = JSON.parse(
    Buffer.from(encoded, 'base64url').toString('utf8'),
  ) as Partial<GitHubInstallationState>;
  if (
    typeof payload.userId !== 'string' ||
    typeof payload.organizationId !== 'string' ||
    typeof payload.expiresAt !== 'number' ||
    typeof payload.nonce !== 'string' ||
    payload.expiresAt < Math.floor(Date.now() / 1000)
  ) {
    throw new Error('Expired or invalid GitHub installation state.');
  }
  return payload as GitHubInstallationState;
}
