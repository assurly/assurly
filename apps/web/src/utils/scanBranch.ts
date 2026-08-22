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

const PREFERRED_ALTERNATE_BRANCHES = ['main', 'master', 'develop'] as const;

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
