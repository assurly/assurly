import {
  INSTANT_GATE_MAX_FILES,
  instantGateSurfaceFiles,
  isScannableFile,
  measureScanScopeTotals,
  rankFilesByRelevance,
  type ScanScopeTotals,
} from '@assurly/scanner-core';
import {
  GITHUB_FETCH_TIMEOUT_MS,
  githubRepositoryApiUrl,
  readLimitedResponseText,
} from './githubApp';

/** Byte ceiling for a single GitHub tree response. */
export const INSTANT_GATE_TREE_MAX_BYTES = 2 * 1024 * 1024;
const TREE_MAX_ENTRIES = 5000;

export const INSTANT_GATE_TREE_CACHE_TTL_MS = 60_000;

export const REPOSITORY_TOO_LARGE_MESSAGE =
  'This repository is too large for the in-browser scan. Run `npx assurly scan` locally for a complete scan of a repository this size.';

export interface SlimTreeEntry {
  path: string;
  type: 'blob';
}

export interface InstantGateTreeResult {
  default_branch: string;
  commit_sha?: string;
  truncated: boolean;
  tree: SlimTreeEntry[];
  /** Repository-wide counts; `tree` is only the capped sample of it. */
  totals: ScanScopeTotals;
}

interface GitHubTreeEntry {
  path: string;
  type: 'blob' | 'tree' | 'commit';
  sha?: string;
}

export class InstantGateTreeError extends Error {
  constructor(
    readonly kind: 'too_large' | 'rate_limit' | 'unavailable',
    message: string,
    readonly githubStatus?: number,
  ) {
    super(message);
    this.name = 'InstantGateTreeError';
  }
}

const treeCache = new Map<string, { at: number; value: InstantGateTreeResult }>();

export function clearInstantGateTreeCacheForTests(): void {
  treeCache.clear();
}

/**
 * @param treeIsPartial Only part of the repository was fetched (the apps/ and
 *   supabase/ subtree path below), so the measured counts are a floor.
 */
export function selectInstantGateTreeEntries(
  entries: readonly { path?: unknown; type?: unknown; sha?: unknown; url?: unknown }[],
  githubTruncated = false,
  treeIsPartial = false,
): { tree: SlimTreeEntry[]; truncated: boolean; totals: ScanScopeTotals } {
  const blobs = entries.filter(
    (entry): entry is { path: string; type: 'blob' } =>
      entry.type === 'blob' && typeof entry.path === 'string' && entry.path.length > 0,
  );
  const scannable = blobs.filter((entry) => isScannableFile(entry.path));
  const surface = instantGateSurfaceFiles(scannable, (entry) => entry.path);
  const ranked = rankFilesByRelevance(surface, (entry) => entry.path).slice(
    0,
    INSTANT_GATE_MAX_FILES,
  );
  return {
    tree: ranked.map((entry) => ({ path: entry.path, type: 'blob' })),
    truncated: githubTruncated || ranked.length < surface.length,
    // Measured on everything fetched, not on `ranked` — the browser receives
    // `ranked` and nothing else, so a sample-derived figure would only ever
    // describe the sample.
    totals: measureScanScopeTotals(
      blobs.map((entry) => entry.path),
      { partial: githubTruncated || treeIsPartial },
    ),
  };
}

function throwForGitHubStatus(status: number): never {
  if (status === 403 || status === 429) {
    throw new InstantGateTreeError('rate_limit', 'GitHub API rate limit exceeded.', status);
  }
  throw new InstantGateTreeError('unavailable', 'GitHub is temporarily unavailable.', status);
}

async function readGitHubTree(
  response: Response,
): Promise<{ entries: GitHubTreeEntry[]; truncated: boolean }> {
  if (!response.ok) throwForGitHubStatus(response.status);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readLimitedResponseText(response, INSTANT_GATE_TREE_MAX_BYTES));
  } catch (error) {
    if (error instanceof InstantGateTreeError) throw error;
    throw new InstantGateTreeError('too_large', REPOSITORY_TOO_LARGE_MESSAGE);
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new InstantGateTreeError('too_large', REPOSITORY_TOO_LARGE_MESSAGE);
  }
  const record = parsed as { tree?: unknown; truncated?: unknown };
  if (!Array.isArray(record.tree) || record.tree.length > TREE_MAX_ENTRIES) {
    throw new InstantGateTreeError('too_large', REPOSITORY_TOO_LARGE_MESSAGE);
  }
  const entries: GitHubTreeEntry[] = [];
  for (const item of record.tree) {
    if (!item || typeof item !== 'object') continue;
    const row = item as { path?: unknown; type?: unknown; sha?: unknown };
    if (typeof row.path !== 'string' || row.path.length === 0 || row.path.length > 1024) continue;
    if (row.type !== 'blob' && row.type !== 'tree' && row.type !== 'commit') continue;
    entries.push({
      path: row.path,
      type: row.type,
      sha: typeof row.sha === 'string' ? row.sha : undefined,
    });
  }
  return { entries, truncated: record.truncated === true };
}

function prefixEntries(entries: GitHubTreeEntry[], prefix: string): GitHubTreeEntry[] {
  return entries.map((entry) => ({
    ...entry,
    path: `${prefix}/${entry.path}`,
  }));
}

function directorySha(root: GitHubTreeEntry[], name: string): string | undefined {
  const entry = root.find((item) => item.type === 'tree' && item.path === name);
  return entry?.sha;
}

async function githubGet(
  url: string,
  headers: HeadersInit,
  fetchImpl: typeof fetch,
): Promise<Response> {
  return fetchImpl(url, {
    headers,
    signal: AbortSignal.timeout(GITHUB_FETCH_TIMEOUT_MS),
  });
}

export async function loadInstantGateTree(options: {
  repo: string;
  branch: string;
  headers: HeadersInit;
  cacheKey: string;
  fetchImpl?: typeof fetch;
}): Promise<InstantGateTreeResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const treeUrl = (ref: string, recursive: boolean): string => {
    const url = new URL(githubRepositoryApiUrl(options.repo, 'git', 'trees', ref));
    if (recursive) url.searchParams.set('recursive', '1');
    return url.toString();
  };
  const commitUrl = githubRepositoryApiUrl(options.repo, 'commits', options.branch);
  const commitResponse = await githubGet(commitUrl, options.headers, fetchImpl);

  let commitSha: string | undefined;
  if (commitResponse.ok) {
    try {
      const commitData = (await commitResponse.json()) as { sha?: unknown };
      if (typeof commitData.sha === 'string' && commitData.sha.length > 0) {
        commitSha = commitData.sha;
      }
    } catch {
      // Scan proceeds without a commit SHA.
    }
  }

  const cacheId = `${options.cacheKey}@${commitSha ?? options.branch}`;
  const hit = treeCache.get(cacheId);
  if (hit && Date.now() - hit.at < INSTANT_GATE_TREE_CACHE_TTL_MS) {
    return hit.value;
  }

  const rootResponse = await githubGet(treeUrl(options.branch, false), options.headers, fetchImpl);
  const root = await readGitHubTree(rootResponse);
  const appsSha = directorySha(root.entries, 'apps');

  let combined: GitHubTreeEntry[] = [];
  let truncated = root.truncated;

  if (appsSha) {
    const supabaseSha = directorySha(root.entries, 'supabase');
    const subtreeRefs: Array<{ sha: string; prefix: string }> = [{ sha: appsSha, prefix: 'apps' }];
    if (supabaseSha) subtreeRefs.push({ sha: supabaseSha, prefix: 'supabase' });

    const subtrees = await Promise.all(
      subtreeRefs.map(async ({ sha, prefix }) => {
        const response = await githubGet(treeUrl(sha, true), options.headers, fetchImpl);
        const parsed = await readGitHubTree(response);
        return { prefix, parsed };
      }),
    );
    for (const { prefix, parsed } of subtrees) {
      truncated = truncated || parsed.truncated;
      combined.push(...prefixEntries(parsed.entries, prefix));
    }
  } else {
    const recursiveResponse = await githubGet(
      treeUrl(options.branch, true),
      options.headers,
      fetchImpl,
    );
    const parsed = await readGitHubTree(recursiveResponse);
    truncated = truncated || parsed.truncated;
    combined = parsed.entries;
  }

  // The apps/ branch above fetches two subtrees rather than the repository, so
  // the counts describe those roots only and must be reported as a floor.
  const selected = selectInstantGateTreeEntries(combined, truncated, Boolean(appsSha));
  const value: InstantGateTreeResult = {
    default_branch: options.branch,
    ...(commitSha ? { commit_sha: commitSha } : {}),
    truncated: selected.truncated,
    tree: selected.tree,
    totals: selected.totals,
  };
  treeCache.set(cacheId, { at: Date.now(), value });
  return value;
}
