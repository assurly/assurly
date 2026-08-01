import { NextResponse } from 'next/server';
import { z } from 'zod';
import { runDeepReview } from '../../../utils/ai/deepReview';
import { buildShipGateFromWebFindings } from '../../../utils/shipGate';
import { ApiError, emptyObjectSchema, RATE_LIMITS, secureRoute } from '../../../utils/apiSecurity';
import { detectGeneratorFingerprint } from '../../../utils/generatorFingerprint';
import { persistUrlTargetShipGateVerdict } from '../../../utils/guardian';
import { scanLiveUrlWithEvidence, type ProbeEvidence } from '../../../utils/runtimeScanner';
import { assertScannableUrl, UrlSafetyError } from '../../../utils/urlSafety';
import { isActiveProbeAllowed, normalizeUrlIdentifier } from '../../../utils/ownership';
import { recordReprobeOutcomes } from '../../../utils/reprobe';
import { entitlementsForPlan } from '../../../utils/entitlements';
import type { AuthContext } from '../../../utils/auth';
import type { DbAdapter, Organization, ProbeEvidenceInput, Target } from '../../../utils/dbAdapter';
import type { VisibilityReport } from '../../../utils/visibilityScan';

/** Headline-only visibility payload — scores + verdict, no per-check detail. */
type VisibilityHeadline = Pick<
  VisibilityReport,
  'score' | 'aiReadinessScore' | 'searchReadinessScore' | 'verdict'
>;

const scanUrlBody = z
  .object({
    url: z.string().trim().min(1).max(2048),
  })
  .strict();

/**
 * Persists probe evidence for an authenticated scan (best-effort — a persistence
 * failure never fails the scan). Anonymous previews render evidence straight from
 * the response with no DB write. Evidence is already redacted by the scanner.
 */
/** The `url` target the scan resolved to, plus whether the active probe ran. */
interface ScanUrlTarget {
  id: string;
  ownershipVerified: boolean;
}

interface UrlTargetGate {
  activeProbe: boolean;
  target: ScanUrlTarget | null;
  /** The full target row, kept for the verified-fix baseline seed (Phase 5). */
  targetRow: Target | null;
  organizationId: string | null;
  paidTierAllowed: boolean;
  /** Full SEO & GEO check list (paid). Free/anonymous get headline only. */
  visibilityReportEnabled: boolean;
}

const PASSIVE_GATE: UrlTargetGate = {
  activeProbe: false,
  target: null,
  targetRow: null,
  organizationId: null,
  paidTierAllowed: false,
  visibilityReportEnabled: false,
};

/**
 * Gates the visibility report for the response. Entitled plans get the full
 * report; unentitled plans get scores + verdict with `checks` omitted
 * server-side (never CSS-hidden). Returns `null` when the scanner produced no
 * report.
 */
function gateVisibilityReport(
  visibility: VisibilityReport | undefined,
  entitled: boolean,
): { visibility: VisibilityReport | VisibilityHeadline; locked: boolean } | null {
  if (!visibility) return null;
  if (entitled) {
    return { visibility, locked: false };
  }
  return {
    visibility: {
      score: visibility.score,
      aiReadinessScore: visibility.aiReadinessScore,
      searchReadinessScore: visibility.searchReadinessScore,
      verdict: visibility.verdict,
    },
    locked: true,
  };
}

/**
 * Looks up an EXISTING `url` target for this origin and decides whether the
 * ACTIVE proof-probe may run. One-off authenticated scans must NOT create a
 * target row — that polluted "Your apps" with every random probe. Guarding a
 * URL is an explicit POST /api/targets action (plan limit enforced there).
 *
 * Ownership gate: an active data-pull is impossible unless
 * `ownership_verified = true`. Fail-closed on lookup errors → passive-only.
 */
async function resolveUrlTargetGate(auth: AuthContext, scanUrl: string): Promise<UrlTargetGate> {
  let organization: Organization | null;
  try {
    organization = await auth.db.getOrganizationByUserId(auth.user.id);
  } catch (error) {
    console.warn('[Assurly] failed to resolve url target gate:', (error as Error).message);
    return PASSIVE_GATE;
  }
  if (!organization) return PASSIVE_GATE;

  const entitlements = entitlementsForPlan(organization.billing_plan);
  const paidFields = {
    organizationId: organization.id,
    paidTierAllowed: entitlements.deepReviewEnabled,
    visibilityReportEnabled: entitlements.visibilityReportEnabled,
  };

  const identifier = normalizeUrlIdentifier(scanUrl);
  try {
    const row = await auth.db.getTargetByIdentifier(organization.id, 'url', identifier);
    if (!row) {
      // One-off probe: entitlements for visibility / deep-review gating, but no
      // target row — nothing is written to "Your apps" until Guard.
      return {
        activeProbe: false,
        target: null,
        targetRow: null,
        ...paidFields,
      };
    }
    // Existing row (explicit Guard, verified or pending): attach for Ownership
    // Verify UI + verdict projection. Active probe stays ownership-gated.
    return {
      activeProbe: isActiveProbeAllowed({ kind: 'url', ownershipVerified: row.ownership_verified }),
      target: { id: row.id, ownershipVerified: row.ownership_verified },
      targetRow: row,
      ...paidFields,
    };
  } catch (error) {
    console.warn('[Assurly] failed to resolve url target gate:', (error as Error).message);
    return PASSIVE_GATE;
  }
}

async function persistEvidence(auth: AuthContext, evidence: ProbeEvidence[]): Promise<void> {
  if (evidence.length === 0) return;
  try {
    const organization = await auth.db.getOrganizationByUserId(auth.user.id);
    if (!organization) return;
    const rows: ProbeEvidenceInput[] = evidence.map((item) => ({
      organizationId: organization.id,
      scanId: null,
      findingRuleId: item.findingRuleId,
      kind: item.kind,
      summary: item.summary,
      redactedSample: item.redactedSample ?? null,
    }));
    await auth.db.insertProbeEvidence(rows);
  } catch (error) {
    console.warn('[Assurly] failed to persist probe evidence:', (error as Error).message);
  }
}

/**
 * Persists a detected AI-builder fingerprint on the url target (best-effort).
 * Only writes when detection is confident (`!== 'unknown'`); leaving
 * `generator_fingerprint` null is the honest answer when no signal is present,
 * and merge-upsert preserves a previously detected value when this scan finds none.
 */
async function persistGeneratorFingerprint(
  db: DbAdapter,
  organizationId: string,
  identifier: string,
  pageText: string,
): Promise<void> {
  const fingerprint = detectGeneratorFingerprint({ pageText });
  if (fingerprint === 'unknown') return;
  try {
    await db.upsertTarget({
      organizationId,
      kind: 'url',
      identifier,
      generatorFingerprint: fingerprint,
    });
  } catch (error) {
    console.warn('[Assurly] failed to persist generator fingerprint:', (error as Error).message);
  }
}

export const POST = secureRoute(
  {
    routeId: 'scan:url',
    auth: 'optional',
    query: emptyObjectSchema,
    params: emptyObjectSchema,
    body: scanUrlBody,
    bodyMode: 'json',
    maxBodyBytes: 4 * 1024,
    rateLimit: RATE_LIMITS.expensive,
    csrf: true,
  },
  async ({ body, auth }) => {
    let parsedUrl;
    try {
      parsedUrl = assertScannableUrl(body.url);
    } catch (error) {
      if (error instanceof UrlSafetyError) {
        throw new ApiError(400, 'invalid_url', error.message);
      }
      throw error;
    }

    // Ownership gate (Phase 3): the ACTIVE data-exfiltration proof (Supabase RLS
    // row-pull + AI planner) only runs for a `url` target the caller has proven
    // they own. Anonymous callers and unverified URLs get the safe/passive checks
    // only (headers, public-bundle secrets). This is the server-side enforcement
    // point — the UI cannot bypass it. The planner never runs around this gate.
    const gate = auth ? await resolveUrlTargetGate(auth, parsedUrl.toString()) : PASSIVE_GATE;

    const { findings, evidence, planSource, pageText, visibility } = await scanLiveUrlWithEvidence(
      parsedUrl.toString(),
      fetch,
      undefined,
      {
        activeProbe: gate.activeProbe,
        organizationId: gate.organizationId ?? undefined,
        // Always run — free users get the headline (conversion); paid get checks.
        visibilityAudit: true,
      },
    );
    const report = buildShipGateFromWebFindings(findings, {
      scannedFileCount: 1,
      cleanFileCount: findings.length === 0 ? 1 : 0,
    });
    const gatedVisibility = gateVisibilityReport(visibility, gate.visibilityReportEnabled);

    if (auth) await persistEvidence(auth, evidence);

    // Project the Ship Gate verdict onto an EXISTING url target only. One-off
    // probes leave gate.targetRow null and never touch "Your apps".
    if (auth && gate.organizationId && gate.targetRow) {
      const identifier = normalizeUrlIdentifier(parsedUrl.toString());
      await persistUrlTargetShipGateVerdict({
        db: auth.db,
        organizationId: gate.organizationId,
        identifier,
        findings,
        previous: gate.targetRow,
      });
      // Seed the moat corpus grouping: persist a detected fingerprint on the url
      // target created above. pageText stays server-side — never returned to the client.
      await persistGeneratorFingerprint(auth.db, gate.organizationId, identifier, pageText ?? '');
    }

    // Verified-fix baseline (Phase 5): when the ownership-gated active probe runs,
    // record the currently-open runtime findings so a later re-probe (after a fix
    // deploys) can flip them to VERIFIED FIXED. Best-effort — a persistence failure
    // never fails the scan. Only state changes are written (see recordReprobeOutcomes).
    if (auth && gate.activeProbe && gate.targetRow) {
      try {
        await recordReprobeOutcomes({ db: auth.db, target: gate.targetRow, findings });
      } catch (error) {
        console.warn('[Assurly] failed to record fix-outcome baseline:', (error as Error).message);
      }
    }

    // Layer 2 deep review (paid + ownership-gated). Runs only after the active
    // probe, so it reasons from real evidence — never speculates on a passive
    // scan. Null on free tier, passive scan, AI unavailable, or a failed call.
    const deepReview = await runDeepReview(
      findings,
      { targetOrigin: parsedUrl.origin },
      {
        organizationId: gate.organizationId ?? undefined,
        paidTierAllowed: gate.paidTierAllowed,
        activeProbeRan: gate.activeProbe,
      },
    );

    // A Pro user scanning a URL they haven't verified yet is one ownership check
    // away from unlocking deep review. Signal it so the client can turn the gate
    // into a funnel step instead of silently omitting the feature.
    const deepReviewLocked = gate.paidTierAllowed && !gate.activeProbe;

    return NextResponse.json({
      report,
      findings,
      evidence,
      target: gate.target,
      ...(planSource ? { planSource } : {}),
      ...(deepReview ? { deepReview } : {}),
      ...(deepReviewLocked ? { deepReviewLocked: true } : {}),
      ...(gatedVisibility ? { visibility: gatedVisibility.visibility } : {}),
      ...(gatedVisibility?.locked ? { visibilityLocked: true } : {}),
    });
  },
);
