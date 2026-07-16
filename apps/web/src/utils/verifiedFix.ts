import type { ScannerFinding } from '@assurly/scanner-core';

/**
 * The verified-fix loop classification (Phase 5). A finding is:
 * - `verified_fixed` — present before the fix, gone after the re-probe;
 * - `still_open` — present in both probes (or a first-seen open baseline);
 * - `regressed` — absent before (previously closed), present again after.
 *
 * This module is PURE by design: it never performs the re-probe I/O. The
 * orchestrator (utils/reprobe.ts) runs the ownership-gated probe and feeds the
 * before/after rule-id sets in here, so classification is unit-testable in
 * isolation (handoff §5, deliverable 2).
 */
export type FixOutcome = 'verified_fixed' | 'still_open' | 'regressed';

export const FIX_OUTCOMES: readonly FixOutcome[] = [
  'verified_fixed',
  'still_open',
  'regressed',
] as const;

/**
 * The rule ids from a probe result that the verified-fix loop tracks. Only
 * error-severity findings count: a warning coming or going must not manufacture
 * a "regressed" verdict (alert fatigue is a Phase 6 concern, trust is a Phase 5
 * one). The scanner is the single source of these findings — we never re-derive
 * them here.
 */
export function collectProbeRuleIds(findings: readonly ScannerFinding[]): Set<string> {
  const ruleIds = new Set<string>();
  for (const finding of findings) {
    if (finding.severity === 'error') ruleIds.add(finding.ruleId);
  }
  return ruleIds;
}

/**
 * Classifies ONE rule against the before/after open sets. The caller must only
 * ask about a rule that appears in `before ∪ after`; a rule absent from both was
 * never open and has no outcome (the orchestrator guarantees this).
 */
export function resolveFixOutcome(
  before: Iterable<string>,
  after: Iterable<string>,
  ruleId: string,
): FixOutcome {
  const beforeSet = before instanceof Set ? before : new Set(before);
  const afterSet = after instanceof Set ? after : new Set(after);
  const wasOpen = beforeSet.has(ruleId);
  const isOpen = afterSet.has(ruleId);

  if (wasOpen && !isOpen) return 'verified_fixed';
  if (wasOpen && isOpen) return 'still_open';
  if (!wasOpen && isOpen) return 'regressed';
  throw new Error(`resolveFixOutcome called for an untracked rule: ${ruleId}`);
}

/** A prior fix_outcome row, reduced to what classification needs. */
export interface FixOutcomeHistoryRow {
  finding_rule_id: string;
  outcome: FixOutcome;
  created_at: string;
}

/**
 * Reduces the append-only fix_outcome log to the latest outcome per rule. The
 * log is the self-bootstrapping history that tells the next re-probe what was
 * open before it ran.
 */
export function latestOutcomeByRule(
  rows: readonly FixOutcomeHistoryRow[],
): Map<string, FixOutcome> {
  const latestAt = new Map<string, string>();
  const latest = new Map<string, FixOutcome>();
  for (const row of rows) {
    const seen = latestAt.get(row.finding_rule_id);
    if (seen === undefined || row.created_at > seen) {
      latestAt.set(row.finding_rule_id, row.created_at);
      latest.set(row.finding_rule_id, row.outcome);
    }
  }
  return latest;
}

/**
 * The set of rules that were OPEN before this re-probe: those whose latest
 * recorded outcome is `still_open` or `regressed`. A `verified_fixed` rule is
 * considered closed, so its reappearance later is a genuine regression.
 */
export function deriveBeforeSet(latestByRule: Map<string, FixOutcome>): Set<string> {
  const before = new Set<string>();
  for (const [ruleId, outcome] of latestByRule) {
    if (outcome === 'still_open' || outcome === 'regressed') before.add(ruleId);
  }
  return before;
}

export interface ReprobeClassification {
  ruleId: string;
  outcome: FixOutcome;
}

/**
 * Classifies a whole re-probe: for every rule in `before ∪ after`, decide its
 * outcome. `resolveFixOutcome` stays the single classifier; the only nuance this
 * layer adds is the BASELINE case — a rule open now that we have never recorded
 * before is `still_open` (a first observation), not `regressed` (which requires a
 * prior closed record, tracked via `known`).
 */
export function classifyReprobeOutcomes(params: {
  before: Set<string>;
  after: Set<string>;
  known: Set<string>;
}): ReprobeClassification[] {
  const { before, after, known } = params;
  const rules = new Set<string>([...before, ...after]);
  const classifications: ReprobeClassification[] = [];
  for (const ruleId of rules) {
    const wasOpen = before.has(ruleId);
    if (!wasOpen && !known.has(ruleId)) {
      // First time we have ever seen this rule and it is open now: baseline.
      classifications.push({ ruleId, outcome: 'still_open' });
      continue;
    }
    classifications.push({ ruleId, outcome: resolveFixOutcome(before, after, ruleId) });
  }
  return classifications;
}

/** A corpus row reduced to pattern columns — never any customer data (§2.8). */
export interface CorpusPatternRow {
  generator_fingerprint: string | null;
  finding_rule_id: string;
  fix_strategy: string | null;
  outcome: FixOutcome;
}

export interface CorpusPattern {
  generatorFingerprint: string;
  findingRuleId: string;
  fixStrategy: string;
  total: number;
  verifiedFixed: number;
  stillOpen: number;
  regressed: number;
  /** Share of outcomes that reached `verified_fixed`, 0–1. */
  verifiedFixedRate: number;
}

/**
 * The exit asset: aggregate patterns of how AI-built apps fail and which fixes
 * actually closed them, grouped by (generator, rule, strategy). Aggregate-only —
 * counts and a rate, never a customer row (§2.8).
 */
export function rollupFixOutcomes(rows: readonly CorpusPatternRow[]): CorpusPattern[] {
  const groups = new Map<string, CorpusPattern>();
  for (const row of rows) {
    const generatorFingerprint = row.generator_fingerprint ?? 'unknown';
    const fixStrategy = row.fix_strategy ?? 'unknown';
    const key = `${generatorFingerprint}\u0000${row.finding_rule_id}\u0000${fixStrategy}`;
    let pattern = groups.get(key);
    if (!pattern) {
      pattern = {
        generatorFingerprint,
        findingRuleId: row.finding_rule_id,
        fixStrategy,
        total: 0,
        verifiedFixed: 0,
        stillOpen: 0,
        regressed: 0,
        verifiedFixedRate: 0,
      };
      groups.set(key, pattern);
    }
    pattern.total += 1;
    if (row.outcome === 'verified_fixed') pattern.verifiedFixed += 1;
    else if (row.outcome === 'still_open') pattern.stillOpen += 1;
    else pattern.regressed += 1;
  }
  const patterns = [...groups.values()];
  for (const pattern of patterns) {
    pattern.verifiedFixedRate = pattern.total === 0 ? 0 : pattern.verifiedFixed / pattern.total;
  }
  return patterns.sort((a, b) => b.total - a.total);
}
