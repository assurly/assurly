/** Query fragment that pins Instant Gate to a specific GitHub branch. */
export function branchQueryParam(branch: string | null | undefined): string {
  if (!branch) return '';
  return `&branch=${encodeURIComponent(branch)}`;
}

export interface GithubBranchList {
  default_branch: string | null;
  branches: string[];
}

export function parseGithubBranchList(payload: unknown): GithubBranchList {
  if (!payload || typeof payload !== 'object') {
    return { default_branch: null, branches: [] };
  }
  const record = payload as { default_branch?: unknown; branches?: unknown };
  const branches = Array.isArray(record.branches)
    ? record.branches.filter((name): name is string => typeof name === 'string' && name.length > 0)
    : [];
  return {
    default_branch: typeof record.default_branch === 'string' ? record.default_branch : null,
    branches,
  };
}

/**
 * Branches Assurly opened for fix pull requests (`assurly-fix-<hash>`, and the
 * `shipready-fix-*` ones from before the rename). They are ours, not the
 * user's code lines: Attesta's picker listed 33 branches, 33 minus `main`.
 */
export function isAssurlyFixBranch(name: string): boolean {
  return /^(?:assurly|shipready)-fix-/.test(name);
}

/** The user's branches for the scan picker, plus the one being scanned. */
export function visibleScanBranches(branches: readonly string[], current: string | null): string[] {
  const own = branches.filter((name) => !isAssurlyFixBranch(name));
  return current && !own.includes(current) ? [current, ...own] : own;
}

const PREFERRED_ALTERNATE_BRANCHES = ['main', 'master', 'develop'] as const;

/**
 * The branch to check instead when GitHub's default branch holds no app code.
 * Anima, SentinelLog and Attesta---Fixes keep a README-only `src` as default
 * and their code on `main`, so every scan of the default failed. Only the
 * conventional trunk names qualify: guessing among feature branches would
 * hand the verdict to work that is not shipping.
 */
export function pickBranchForEmptyDefault(
  emptyDefaultBranch: string,
  branches: readonly string[],
): string | null {
  return (
    PREFERRED_ALTERNATE_BRANCHES.find(
      (name) => name !== emptyDefaultBranch && branches.includes(name),
    ) ?? null
  );
}

/**
 * After an empty scan, offer other branches that might hold application files.
 * Preferred names come first so "Scan main instead" is the first action.
 */
export function suggestAlternateScanBranches(
  currentBranch: string,
  branches: readonly string[],
): string[] {
  const others = new Set(branches.filter((name) => name !== currentBranch));
  const preferred = PREFERRED_ALTERNATE_BRANCHES.filter((name) => others.has(name));
  const rest = [...others].filter(
    (name) => !(PREFERRED_ALTERNATE_BRANCHES as readonly string[]).includes(name),
  );
  return [...preferred, ...rest];
}
