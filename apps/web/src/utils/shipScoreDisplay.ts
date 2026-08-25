import { BLOCKED_SCORE_CAP } from '@assurly/scanner-core';
import type { Scan } from './dbAdapter';
import { buildShipGateFromScanFindings } from './shipGate';

export { BLOCKED_SCORE_CAP };

/** Matches scanner-core incomplete coverage cap (trust: never claim READY above this). */
export const INCOMPLETE_SCORE_CAP = 79;
/** Matches scanner-core floor for incomplete Instant Gate with zero blockers. */
export const INCOMPLETE_NO_BLOCKER_FLOOR = 40;

export function indicatesIncompleteCoverage(input: {
  topIssueKey?: string | null;
  topIssueLabel?: string | null;
  findingRuleIds?: Iterable<string>;
}): boolean {
  const key = (input.topIssueKey ?? '').toLowerCase();
  const label = (input.topIssueLabel ?? '').toLowerCase();
  if (key.includes('scan-completeness') || label.includes('incomplete')) {
    return true;
  }
  for (const ruleId of input.findingRuleIds ?? []) {
    if (ruleId === 'scan-completeness') {
      return true;
    }
  }
  return false;
}

export function clampShipScoreForCoverage(
  score: number | null,
  incomplete: boolean,
  options: { hasBlockers?: boolean } = {},
): number | null {
  if (score == null) return null;
  if (!incomplete) return score;
  let next = Math.min(score, INCOMPLETE_SCORE_CAP);
  if (!options.hasBlockers) {
    next = Math.max(next, INCOMPLETE_NO_BLOCKER_FLOOR);
  }
  return next;
}

export function clampShipScoreForBlockedVerdict(
  score: number | null,
  blocked: boolean,
): number | null {
  if (score == null) return null;
  if (!blocked) return score;
  return Math.min(score, BLOCKED_SCORE_CAP);
}

type ScoreScan = Pick<Scan, 'ship_score' | 'scanned_file_count' | 'clean_file_count'> & {
  verdict?: Scan['verdict'] | 'unknown' | null;
};

type TrendFinding = Parameters<typeof buildShipGateFromScanFindings>[0];

export interface DisplayedShipScoreHints {
  incomplete?: boolean;
  blocked?: boolean;
}

function findingsSuggestBlockers(findings: TrendFinding): boolean {
  return findings.some(
    (finding) => finding.severity === 'error' && (finding.confidence ?? 'high') === 'high',
  );
}

/**
 * Single Ship Score resolver for trend, cards, and detail.
 * Prefer persisted `ship_score`; legacy rows recompute. Incomplete coverage never
 * displays above {@link INCOMPLETE_SCORE_CAP}, and incomplete + no blockers never
 * displays a dumpster-fire 0 ({@link INCOMPLETE_NO_BLOCKER_FLOOR}). Blocked
 * verdicts never display above {@link BLOCKED_SCORE_CAP}.
 */
export function resolveDisplayedShipScore(
  scan: ScoreScan,
  findings: TrendFinding,
  hints: DisplayedShipScoreHints = {},
): number {
  const incomplete =
    hints.incomplete ??
    indicatesIncompleteCoverage({
      findingRuleIds: findings.map((finding) => finding.rule_id),
    });
  const blocked =
    hints.blocked ?? (scan.verdict === 'blocked' || findingsSuggestBlockers(findings));

  // Incomplete Instant Gate: recompute through the engine so cap + floor match
  // scanner-core (persisted pre-floor rows would otherwise keep showing 0).
  if (incomplete && findings.length > 0) {
    const scannedFileCount =
      typeof scan.scanned_file_count === 'number' ? scan.scanned_file_count : undefined;
    return buildShipGateFromScanFindings(findings, {
      scannedFileCount,
      cleanFileCount:
        typeof scannedFileCount === 'number'
          ? Math.max(0, scannedFileCount - new Set(findings.map((f) => f.file_path)).size)
          : typeof scan.clean_file_count === 'number'
            ? scan.clean_file_count
            : undefined,
    }).shipScore;
  }

  if (typeof scan.ship_score === 'number') {
    const coverageClamped =
      clampShipScoreForCoverage(scan.ship_score, incomplete, {
        hasBlockers: blocked,
      }) ?? scan.ship_score;
    return clampShipScoreForBlockedVerdict(coverageClamped, blocked) ?? coverageClamped;
  }

  const scannedFileCount =
    typeof scan.scanned_file_count === 'number' ? scan.scanned_file_count : undefined;
  const shipGate = buildShipGateFromScanFindings(findings, {
    scannedFileCount,
    cleanFileCount:
      typeof scannedFileCount === 'number'
        ? Math.max(0, scannedFileCount - new Set(findings.map((f) => f.file_path)).size)
        : typeof scan.clean_file_count === 'number'
          ? scan.clean_file_count
          : undefined,
  });
  return shipGate.shipScore;
}
