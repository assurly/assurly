import type { ScanFinding } from './dbAdapter';
import { isAutoFixableFinding } from './githubAutoFix';

export interface ScanFixSummary {
  /** Errors reported by the static scan against upstream code. */
  issueCount: number;
  /** Findings that ShipReady can auto-fix with a PR. */
  fixableCount: number;
  /** Fixable findings that already have a linked pull request. */
  proposedCount: number;
  /** Fixable findings still missing a pull request. */
  remainingCount: number;
  /** Shared PR URL when every fixable finding points to the same pull request. */
  sharedBatchPrUrl: string | null;
}

export function summarizeScanFixes(
  findings: readonly ScanFinding[],
  errorCount: number,
): ScanFixSummary {
  const fixable = findings.filter(isAutoFixableFinding);
  const proposed = fixable.filter((finding) => Boolean(finding.fix_pr_url));
  const prUrls = new Set(proposed.map((finding) => finding.fix_pr_url).filter(Boolean));

  return {
    issueCount: errorCount,
    fixableCount: fixable.length,
    proposedCount: proposed.length,
    remainingCount: fixable.length - proposed.length,
    sharedBatchPrUrl: prUrls.size === 1 ? ([...prUrls][0] ?? null) : null,
  };
}

export function findingFixPrUrl(finding: ScanFinding): string | null {
  return finding.fix_pr_url ?? null;
}
