import type { Severity } from '@assurly/scanner-core';
import type {
  DbAdapter,
  FixOutcomeRow,
  FixOutcomeStatus,
  TargetKind,
  TargetVerdict,
} from './dbAdapter';
import { isActiveProbeAllowed } from './ownership/gate';
import {
  categoryRemediation,
  toPublicTrustProjection,
  type PublicTrustProjection,
} from './publicTrust';

/**
 * The programmatic (agent / OEM / keyed API) verdict resolver — Phase 7 +
 * Proof-of-Fix surfacing.
 *
 * This path is STRICTLY READ-ONLY over the hosted verdict. It reads one target
 * row (and its stored fix-outcome history) and projects them through the
 * shape-only allowlist; it never calls the scanner, a probe primitive, or a
 * re-probe, so it can never become an active-probe bypass. The ownership gate
 * (`isActiveProbeAllowed`) is still consulted so `activeProbeAllowed`
 * truthfully reflects that an active re-probe would be OWNER-ONLY — but this
 * path exposes no re-probe, so a stranger/unverified target yields the passive
 * stored verdict only.
 */

export interface ProgrammaticVerdictQuery {
  kind: TargetKind;
  /** Already normalized: an origin for `url`, `owner/repo` for `repo`. */
  identifier: string;
}

/**
 * Per-rule fix outcome from the last re-probe that changed state for that rule.
 *
 * Shape-only by design: rule id + outcome + observation time. Never finding
 * messages, file paths, evidence, or table names — the Trust page promises the
 * verdict API stays shape-only.
 *
 * `observedAt` is the wall-clock of that re-probe. It is NOT "current state of
 * the agent's working tree". An agent that just edited code must deploy and
 * re-probe before treating these as verification of that edit.
 */
export interface ProgrammaticFixOutcome {
  ruleId: string;
  outcome: FixOutcomeStatus;
  /** ISO-8601 timestamp of the re-probe that produced this observation. */
  observedAt: string;
}

/** The stable, shape-only response for the keyed API and the MCP tool. */
export interface ProgrammaticVerdict {
  status: TargetVerdict;
  shipScore: number | null;
  displayName: string | null;
  identifier: string;
  kind: TargetKind;
  lastCheckedAt: string | null;
  generatorFingerprint: string | null;
  topIssue: {
    category: string;
    severity: Severity;
    remediation: string;
  } | null;
  trustPageUrl: string | null;
  badgeUrl: string | null;
  /**
   * Whether the active proof-probe would be permitted for this target
   * (owner-only). The programmatic path NEVER triggers a probe — this only
   * reflects the ownership gate so callers understand the verdict is passive
   * for a stranger/unverified target.
   */
  activeProbeAllowed: boolean;
  /**
   * Latest per-rule fix outcome from stored re-probes. Empty when the target
   * has no history (or is unknown to the caller's org). Pure read — never
   * triggers a probe.
   */
  fixOutcomes: ProgrammaticFixOutcome[];
}

/** The whitelisted top-level keys of a programmatic verdict — used by shape tests. */
export const PROGRAMMATIC_VERDICT_KEYS = [
  'status',
  'shipScore',
  'displayName',
  'identifier',
  'kind',
  'lastCheckedAt',
  'generatorFingerprint',
  'topIssue',
  'trustPageUrl',
  'badgeUrl',
  'activeProbeAllowed',
  'fixOutcomes',
] as const;

/** Whitelisted keys of each `fixOutcomes[]` entry — used by shape tests. */
export const PROGRAMMATIC_FIX_OUTCOME_KEYS = ['ruleId', 'outcome', 'observedAt'] as const;

/**
 * Collapses the fix-outcome history to the newest row per rule. History is
 * ascending by `created_at`; the last write wins. Pure — no I/O.
 */
export function toProgrammaticFixOutcomes(rows: FixOutcomeRow[]): ProgrammaticFixOutcome[] {
  const byRule = new Map<string, ProgrammaticFixOutcome>();
  for (const row of rows) {
    byRule.set(row.finding_rule_id, {
      ruleId: row.finding_rule_id,
      outcome: row.outcome,
      observedAt: row.created_at,
    });
  }
  return [...byRule.values()].sort((a, b) => a.ruleId.localeCompare(b.ruleId));
}

function trustUrls(
  appBaseUrl: string | null,
  badgeToken: string | null,
): { trustPageUrl: string | null; badgeUrl: string | null } {
  if (!appBaseUrl || !badgeToken) return { trustPageUrl: null, badgeUrl: null };
  const base = appBaseUrl.replace(/\/$/, '');
  return {
    trustPageUrl: `${base}/report/${badgeToken}`,
    badgeUrl: `${base}/api/badge/${badgeToken}`,
  };
}

function toResponse(
  query: ProgrammaticVerdictQuery,
  projection: PublicTrustProjection | null,
  activeProbeAllowed: boolean,
  appBaseUrl: string | null,
  fixOutcomes: ProgrammaticFixOutcome[],
): ProgrammaticVerdict {
  if (!projection) {
    // No published verdict for this identifier in the caller's org — the most
    // passive answer, with no cross-org data and no probe.
    return {
      status: 'unknown',
      shipScore: null,
      displayName: null,
      identifier: query.identifier,
      kind: query.kind,
      lastCheckedAt: null,
      generatorFingerprint: null,
      topIssue: null,
      trustPageUrl: null,
      badgeUrl: null,
      activeProbeAllowed,
      fixOutcomes: [],
    };
  }

  const { trustPageUrl, badgeUrl } = trustUrls(appBaseUrl, projection.badgeToken);
  return {
    status: projection.verdict,
    shipScore: projection.shipScore,
    displayName: projection.displayName,
    identifier: projection.identifier,
    kind: projection.kind,
    lastCheckedAt: projection.lastCheckedAt,
    generatorFingerprint: projection.generatorFingerprint,
    topIssue: projection.topIssue
      ? {
          category: projection.topIssue.category,
          severity: projection.topIssue.severity,
          remediation: categoryRemediation(projection.topIssue.category),
        }
      : null,
    trustPageUrl,
    badgeUrl,
    activeProbeAllowed,
    fixOutcomes,
  };
}

/**
 * Resolves the hosted verdict for a target the given org may know about. Scopes
 * the lookup to the caller's org (never enumerates other orgs) and returns the
 * shape-only projection; a target the org does not own yields `unknown`.
 *
 * Fix outcomes are a second pure read of stored rows — never a probe.
 */
export async function resolveProgrammaticVerdict(
  db: Pick<DbAdapter, 'getTargetByIdentifier' | 'getFixOutcomesForTarget'>,
  organizationId: string,
  query: ProgrammaticVerdictQuery,
  appBaseUrl: string | null,
): Promise<ProgrammaticVerdict> {
  const target = await db.getTargetByIdentifier(organizationId, query.kind, query.identifier);
  if (!target) {
    // Stranger / not monitored by this org: passive `unknown`, and the gate is
    // "not allowed" since there is no owned+verified target behind it.
    return toResponse(query, null, false, appBaseUrl, []);
  }

  // Consult the single ownership authority. This does NOT trigger a probe — it
  // only records whether an active re-probe WOULD be permitted (owner-only).
  const activeProbeAllowed = isActiveProbeAllowed({
    kind: target.kind,
    ownershipVerified: target.ownership_verified,
  });

  const history = await db.getFixOutcomesForTarget(target.id);
  const fixOutcomes = toProgrammaticFixOutcomes(history);

  return toResponse(
    query,
    toPublicTrustProjection(target),
    activeProbeAllowed,
    appBaseUrl,
    fixOutcomes,
  );
}
