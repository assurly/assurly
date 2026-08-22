import type { ScannerFinding } from '@assurly/scanner-core';
import type { DbAdapter, FixOutcomeInput, Target } from './dbAdapter';
import { isActiveProbeAllowed } from './ownership';
import { scanLiveUrlWithEvidence, type ProbeEvidence } from './runtimeScanner';
import {
  classifyReprobeOutcomes,
  collectProbeRuleIds,
  deriveBeforeSet,
  latestOutcomeByRule,
  type ReprobeClassification,
} from './verifiedFix';

export type ScanLiveUrlFn = typeof scanLiveUrlWithEvidence;

export interface ReprobeContext {
  target: Target;
  db: DbAdapter;
  /** Vercel deploy id when the re-probe was deploy-triggered; dedupes fix_outcome. */
  deployId?: string | null;
  /** The fix PR that plausibly closed the finding, when known. */
  prUrl?: string | null;
  /** How the fix was applied (auto-fix strategy), when known. */
  fixStrategy?: string | null;
  /** Injectable scanner for tests; defaults to the real probe. */
  scanImpl?: ScanLiveUrlFn;
  /** Injectable fetch for tests; defaults to global fetch (mirrors scan-url). */
  fetchImpl?: typeof fetch;
}

export interface ReprobeResult {
  /** Whether the ownership gate permitted the ACTIVE probe. */
  activeProbe: boolean;
  /** Whether a re-probe actually ran an active verification and could record outcomes. */
  probed: boolean;
  probeUrl: string | null;
  outcomes: ReprobeClassification[];
  findings: ScannerFinding[];
  evidence: ProbeEvidence[];
}

/**
 * The live URL to re-probe for a target. Only `url` targets carry a runtime
 * origin; `repo` targets have no live URL of their own, so a runtime re-probe
 * does not apply (their PR-scan regression path lives in api/github/webhook).
 */
export function resolveProbeUrl(target: Target): string | null {
  return target.kind === 'url' ? target.identifier : null;
}

/**
 * Re-probes a target and records the verified-fix outcomes. This is the ONE
 * active re-probe path shared by the Vercel deploy webhook and the on-demand
 * reprobe route. A re-probe IS an active probe, so it goes through the single
 * ownership authority (`isActiveProbeAllowed`) and FAILS CLOSED: if the gate does
 * not permit the active probe, no verification runs and nothing is recorded.
 *
 * Classification is delegated to the pure `verifiedFix` module; this function is
 * only the I/O (gate + scanner + persistence).
 */
export async function reprobeTargetAndRecord(context: ReprobeContext): Promise<ReprobeResult> {
  const { target, db } = context;
  const activeProbe = isActiveProbeAllowed({
    kind: target.kind,
    ownershipVerified: target.ownership_verified,
  });
  const probeUrl = resolveProbeUrl(target);

  if (!probeUrl) {
    return { activeProbe, probed: false, probeUrl: null, outcomes: [], findings: [], evidence: [] };
  }

  const scan = context.scanImpl ?? scanLiveUrlWithEvidence;
  // The gate flag is passed straight into the scanner exactly as scan-url does:
  // when it is false the scanner never enters its active branch, so no Supabase
  // row-pull and no AI planner call can occur for an unverified target.
  const { findings, evidence, blocked } = await scan(
    probeUrl,
    context.fetchImpl ?? fetch,
    undefined,
    { activeProbe, organizationId: target.organization_id },
  );

  if (blocked) {
    // The target refused the probe, so `findings` is empty for a reason that has
    // nothing to do with the app. Recording it would flip every open finding to
    // VERIFIED FIXED the first time a WAF or a rate limit turns the scanner away.
    return { activeProbe, probed: false, probeUrl, outcomes: [], findings, evidence };
  }

  if (!activeProbe) {
    // Gate closed. A passive scan may have run, but there is nothing verified to
    // record — verification requires proven ownership.
    return { activeProbe, probed: false, probeUrl, outcomes: [], findings, evidence };
  }

  const outcomes = await recordReprobeOutcomes({
    db,
    target,
    findings,
    deployId: context.deployId ?? null,
    prUrl: context.prUrl ?? null,
    fixStrategy: context.fixStrategy ?? null,
  });

  return { activeProbe, probed: true, probeUrl, outcomes, findings, evidence };
}

export interface RecordReprobeOutcomesParams {
  db: DbAdapter;
  target: Target;
  findings: readonly ScannerFinding[];
  deployId?: string | null;
  prUrl?: string | null;
  fixStrategy?: string | null;
}

/**
 * Classifies a set of probe findings against the target's recorded history and
 * persists the verified-fix outcomes. Shared by the active re-probe path and the
 * scan-time baseline seed, so there is ONE place that writes fix_outcome rows.
 *
 * Only STATE CHANGES are written: a rule whose outcome is unchanged from its last
 * record is skipped, so repeated scans/re-probes of a still-open finding do not
 * spam the log (or the corpus) — the notable transitions (first seen,
 * verified_fixed, regressed) are what land.
 */
export async function recordReprobeOutcomes(
  params: RecordReprobeOutcomesParams,
): Promise<ReprobeClassification[]> {
  const { db, target, findings } = params;
  const after = collectProbeRuleIds(findings);
  const history = await db.getFixOutcomesForTarget(target.id);
  const latest = latestOutcomeByRule(history);
  const before = deriveBeforeSet(latest);
  const known = new Set(latest.keys());
  const outcomes = classifyReprobeOutcomes({ before, after, known });

  const changed = outcomes.filter((outcome) => latest.get(outcome.ruleId) !== outcome.outcome);
  if (changed.length > 0) {
    const rows: FixOutcomeInput[] = changed.map((outcome) => ({
      organizationId: target.organization_id,
      targetId: target.id,
      findingRuleId: outcome.ruleId,
      generatorFingerprint: target.generator_fingerprint,
      fixStrategy: params.fixStrategy ?? null,
      outcome: outcome.outcome,
      prUrl: params.prUrl ?? null,
      deployId: params.deployId ?? null,
    }));
    await db.insertFixOutcomes(rows);
  }

  return changed;
}
