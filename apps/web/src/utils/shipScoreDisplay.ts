import { BLOCKED_SCORE_CAP } from '@assurly/scanner-core';
import type { Scan, Target } from './dbAdapter';
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

type ScoreTarget = Pick<Target, 'current_ship_score' | 'current_verdict' | 'verdict_evidence'>;

/**
 * Ship Score for a surface that only holds the `targets` row — the keyed
 * verdict API, the public badge, the trust page. Applies the same coverage and
 * blocked clamps the dashboard applies, derived from the row alone so a public
 * or hot route never pays for a scan/findings query. Null stays null: an
 * unscored target must never be handed a fabricated number.
 */
export function resolveTargetShipScore(target: ScoreTarget): number | null {
  if (target.current_ship_score == null) return null;

  const evidence = (target.verdict_evidence ?? {}) as {
    topIssue?: { key?: string | null; label?: string | null } | null;
  };
  const blocked = target.current_verdict === 'blocked';
  const incomplete = indicatesIncompleteCoverage({
    topIssueKey: evidence.topIssue?.key,
    topIssueLabel: evidence.topIssue?.label,
  });

  const coverageClamped =
    clampShipScoreForCoverage(target.current_ship_score, incomplete, { hasBlockers: blocked }) ??
    target.current_ship_score;
  return clampShipScoreForBlockedVerdict(coverageClamped, blocked);
}

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
