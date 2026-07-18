import type { FixOutcomeCorpusRow, FixOutcomeStatus } from './dbAdapter';

/**
 * Exit-readiness metrics (Phase 8).
 *
 * A pure, aggregate-ONLY rollup of the verified-fix corpus — the moat asset an
 * acquirer evaluates. It is deliberately built from `FixOutcomeCorpusRow`, which
 * carries pattern columns only (generator fingerprint, rule id, fix strategy,
 * outcome) and NEVER a finding message, table name, PII, org/target id, or any
 * per-customer row (see dbAdapter.getFixOutcomeCorpus + convention §2.8). This
 * module counts patterns; it can never surface a customer.
 */

export interface OutcomeBreakdown {
  verifiedFixed: number;
  stillOpen: number;
  regressed: number;
  total: number;
}

export interface CorpusSlice {
  /** The pattern key for this slice (a generator fingerprint or a scanner rule id). */
  key: string;
  outcomes: OutcomeBreakdown;
}

export interface ExitMetrics {
  /** Number of monitored apps (targets) across all orgs — an aggregate scalar. */
  appsMonitored: number;
  /** Total number of verified-fix corpus rows. */
  corpusSize: number;
  /** Corpus-wide outcome breakdown. */
  outcomes: OutcomeBreakdown;
  /**
   * Share of resolved outcomes that were verified fixed, i.e.
   * verifiedFixed / (verifiedFixed + regressed). `null` when there is nothing
   * resolved yet. `still_open` is excluded because it is not a resolution.
   */
  verifiedFixRate: number | null;
  /** Regressions caught by the guardian (outcome === 'regressed'). */
  regressionsCaught: number;
  /** Fixes the re-probe confirmed closed (outcome === 'verified_fixed'). */
  fixesVerified: number;
  /** Outcome breakdown per AI generator fingerprint, most corpus rows first. */
  byGenerator: CorpusSlice[];
  /** Outcome breakdown per scanner rule id, most corpus rows first. */
  byRule: CorpusSlice[];
}

function emptyBreakdown(): OutcomeBreakdown {
  return { verifiedFixed: 0, stillOpen: 0, regressed: 0, total: 0 };
}

function tally(breakdown: OutcomeBreakdown, outcome: FixOutcomeStatus): void {
  switch (outcome) {
    case 'verified_fixed':
      breakdown.verifiedFixed += 1;
      break;
    case 'still_open':
      breakdown.stillOpen += 1;
      break;
    case 'regressed':
      breakdown.regressed += 1;
      break;
    default: {
      const exhaustive: never = outcome;
      throw new Error(`Unknown fix outcome: ${String(exhaustive)}`);
    }
  }
  breakdown.total += 1;
}

function toSlices(groups: Map<string, OutcomeBreakdown>): CorpusSlice[] {
  return [...groups.entries()]
    .map(([key, outcomes]) => ({ key, outcomes }))
    .sort((a, b) => b.outcomes.total - a.outcomes.total || a.key.localeCompare(b.key));
}

function rate(fixed: number, regressed: number): number | null {
  const resolved = fixed + regressed;
  if (resolved === 0) return null;
  return Number((fixed / resolved).toFixed(4));
}

/**
 * Rolls the pattern-only corpus up into aggregate KPIs. Pure — no I/O, no clock,
 * deterministic. `appsMonitored` is supplied by the caller (a scalar count) so
 * this stays free of the DB layer and trivially testable.
 */
export function rollupExitMetrics(
  rows: readonly FixOutcomeCorpusRow[],
  appsMonitored: number,
): ExitMetrics {
  const overall = emptyBreakdown();
  const byGenerator = new Map<string, OutcomeBreakdown>();
  const byRule = new Map<string, OutcomeBreakdown>();

  for (const row of rows) {
    tally(overall, row.outcome);

    const generatorKey = row.generator_fingerprint ?? 'unknown';
    const generatorBreakdown = byGenerator.get(generatorKey) ?? emptyBreakdown();
    tally(generatorBreakdown, row.outcome);
    byGenerator.set(generatorKey, generatorBreakdown);

    const ruleBreakdown = byRule.get(row.finding_rule_id) ?? emptyBreakdown();
    tally(ruleBreakdown, row.outcome);
    byRule.set(row.finding_rule_id, ruleBreakdown);
  }

  return {
    appsMonitored,
    corpusSize: overall.total,
    outcomes: overall,
    verifiedFixRate: rate(overall.verifiedFixed, overall.regressed),
    regressionsCaught: overall.regressed,
    fixesVerified: overall.verifiedFixed,
    byGenerator: toSlices(byGenerator),
    byRule: toSlices(byRule),
  };
}
