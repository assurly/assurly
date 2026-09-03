/**
 * Which persisted scan owns a repository's shipping verdict.
 *
 * A ship gate answers "is what I am shipping safe?". Pull-request heads and
 * feature branches are not what is shipping; the repository's default branch
 * is. Surfaces that report a repo-level score (dashboard card, `targets`
 * projection, keyed API) must all select that scan.
 */

export interface VerdictOwningScanFields {
  branch?: string | null;
  scan_scope?: Record<string, unknown> | null;
}

/**
 * Last-resort guess for rows that predate default-branch recording. It is a
 * guess, not a guarantee: a repository that ships from `src` or `develop` has
 * no scan this can identify, so callers should pass the repository's real
 * default whenever they know it.
 */
const LEGACY_DEFAULT_BRANCHES = new Set(['main', 'master']);

/** CLI / MCP Full Gate when the caller omitted a git branch. */
const CLI_LOCAL_BRANCH = 'local';

/** Matches the `branch` column width; anything longer is not a real ref. */
const MAX_BRANCH_LENGTH = 255;

function branchName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_BRANCH_LENGTH) return null;
  return trimmed;
}

/**
 * The GitHub default branch a scan observed while it ran. Client-supplied via
 * `scan_scope` passthrough, so it is validated rather than trusted.
 */
export function recordedDefaultBranch(scan: VerdictOwningScanFields): string | null {
  return branchName(scan.scan_scope?.defaultBranch);
}

function scanSource(scope: Record<string, unknown> | null | undefined): string | null {
  const value = scope?.source;
  return typeof value === 'string' ? value : null;
}

/**
 * `repoDefaultBranch` is the repository's current default. It outranks the
 * default a scan recorded: that one is point-in-time, so after a branch rename
 * a scan of the old default is no longer a verdict about what ships.
 */
export function scanOwnsRepoVerdict(
  scan: VerdictOwningScanFields,
  repoDefaultBranch?: string | null,
): boolean {
  if (scanSource(scan.scan_scope) === 'pull_request') return false;
  const branch = scan.branch?.trim() ?? '';
  if (!branch) return true;
  if (branch === CLI_LOCAL_BRANCH) return true;
  const repoDefault = branchName(repoDefaultBranch);
  if (repoDefault) return branch === repoDefault;
  const recorded = recordedDefaultBranch(scan);
  if (recorded) return branch === recorded;
  return LEGACY_DEFAULT_BRANCHES.has(branch);
}

export function selectVerdictOwningScan<T extends VerdictOwningScanFields>(
  scansNewestFirst: readonly T[],
  repoDefaultBranch?: string | null,
): T | undefined {
  return scansNewestFirst.find((scan) => scanOwnsRepoVerdict(scan, repoDefaultBranch));
}

export function indexLatestVerdictOwningSummaries<
  T extends VerdictOwningScanFields & { repository_id: string },
>(
  rowsNewestFirst: readonly T[],
  defaultBranchByRepoId?: ReadonlyMap<string, string | null | undefined>,
): Map<string, T> {
  const summaries = new Map<string, T>();
  for (const row of rowsNewestFirst) {
    if (summaries.has(row.repository_id)) continue;
    if (!scanOwnsRepoVerdict(row, defaultBranchByRepoId?.get(row.repository_id))) continue;
    summaries.set(row.repository_id, row);
  }
  return summaries;
}
