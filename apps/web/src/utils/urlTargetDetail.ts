import { z } from 'zod';
import type { FixOutcomeRow, ProbeEvidenceKind, ProbeEvidenceRow, Target } from './dbAdapter';
import { readBlockerSnapshot } from './guardian';
import type { FixOutcome } from './verifiedFix';

/** Redacted proof fields the detail view may show. Anything else is dropped. */
const redactedSampleSchema = z
  .object({
    table: z.string().max(200).optional(),
    path: z.string().max(500).optional(),
    rowCount: z.number().int().nonnegative().optional(),
    columns: z.array(z.string().max(200)).max(50).optional(),
    sampleCell: z.string().max(200).optional(),
    secretLabel: z.string().max(200).optional(),
    maskedSecret: z.string().max(200).optional(),
    headers: z.array(z.string().max(200)).max(50).optional(),
  })
  .strip();

export type RedactedSample = z.infer<typeof redactedSampleSchema>;

export interface UrlTargetEvidence {
  findingRuleId: string;
  kind: ProbeEvidenceKind;
  summary: string;
  redactedSample?: RedactedSample;
  /** When this proof was taken. */
  checkedAt: string;
}

export interface UrlTargetBlocker {
  ruleId: string;
  message: string;
  /** Where the probe found it: a table on the REST API, or a route. */
  location: string;
  evidence: UrlTargetEvidence | null;
  /**
   * The verified-fix state of this rule: when a probe first found it and when
   * its current state was recorded.
   */
  outcome: { status: FixOutcome; since: string; foundAt: string } | null;
}

export interface UrlTargetDetail {
  id: string;
  identifier: string;
  displayName: string;
  verdict: Target['current_verdict'];
  shipScore: number | null;
  lastCheckedAt: string | null;
  ownershipVerified: boolean;
  blockers: UrlTargetBlocker[];
  /** Proof behind findings that do not block launch (missing headers). */
  otherEvidence: UrlTargetEvidence[];
}

function toEvidence(row: ProbeEvidenceRow): UrlTargetEvidence {
  const sample = redactedSampleSchema.safeParse(row.redacted_sample ?? {});
  return {
    findingRuleId: row.finding_rule_id,
    kind: row.kind,
    summary: row.summary,
    ...(sample.success && Object.keys(sample.data).length > 0
      ? { redactedSample: sample.data }
      : {}),
    checkedAt: row.created_at,
  };
}

interface RuleHistory {
  latest: FixOutcomeRow;
  firstSeenAt: string;
}

function outcomeHistory(rows: readonly FixOutcomeRow[]): Map<string, RuleHistory> {
  const history = new Map<string, RuleHistory>();
  for (const row of rows) {
    const seen = history.get(row.finding_rule_id);
    if (!seen) {
      history.set(row.finding_rule_id, { latest: row, firstSeenAt: row.created_at });
      continue;
    }
    history.set(row.finding_rule_id, {
      latest: row.created_at > seen.latest.created_at ? row : seen.latest,
      firstSeenAt: row.created_at < seen.firstSeenAt ? row.created_at : seen.firstSeenAt,
    });
  }
  return history;
}

/**
 * What a guarded URL's card stands on: each blocker from the last check with
 * the redacted proof the probe took and whether a later probe verified a fix.
 * Built from rows already persisted by the probe — nothing is fetched or
 * probed here.
 */
export function buildUrlTargetDetail(
  target: Target,
  evidenceRows: readonly ProbeEvidenceRow[],
  outcomeRows: readonly FixOutcomeRow[],
): UrlTargetDetail {
  const evidence = evidenceRows.map(toEvidence);
  const evidenceByRule = new Map(evidence.map((item) => [item.findingRuleId, item]));
  const outcomes = outcomeHistory(outcomeRows);

  const blockers = readBlockerSnapshot(target.verdict_evidence).map((finding) => {
    const history = outcomes.get(finding.rule_id);
    return {
      ruleId: finding.rule_id,
      message: finding.message,
      location: finding.file_path,
      evidence: evidenceByRule.get(finding.rule_id) ?? null,
      outcome: history
        ? {
            status: history.latest.outcome,
            since: history.latest.created_at,
            foundAt: history.firstSeenAt,
          }
        : null,
    };
  });
  const blockerRules = new Set(blockers.map((blocker) => blocker.ruleId));

  return {
    id: target.id,
    identifier: target.identifier,
    displayName: target.display_name ?? target.identifier,
    verdict: target.current_verdict,
    shipScore: target.current_ship_score,
    lastCheckedAt: target.last_checked_at,
    ownershipVerified: target.ownership_verified,
    blockers,
    otherEvidence: evidence.filter((item) => !blockerRules.has(item.findingRuleId)),
  };
}
