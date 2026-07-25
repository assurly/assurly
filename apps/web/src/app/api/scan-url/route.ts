import { NextResponse } from 'next/server';
import { z } from 'zod';
import { runDeepReview } from '../../../utils/ai/deepReview';
import { buildShipGateFromWebFindings } from '../../../utils/shipGate';
import { ApiError, emptyObjectSchema, RATE_LIMITS, secureRoute } from '../../../utils/apiSecurity';
import { detectGeneratorFingerprint } from '../../../utils/generatorFingerprint';
import { scanLiveUrlWithEvidence, type ProbeEvidence } from '../../../utils/runtimeScanner';
import { assertScannableUrl, UrlSafetyError } from '../../../utils/urlSafety';
import { isActiveProbeAllowed, normalizeUrlIdentifier } from '../../../utils/ownership';
import { recordReprobeOutcomes } from '../../../utils/reprobe';
import { entitlementsForPlan } from '../../../utils/entitlements';
import type { AuthContext } from '../../../utils/auth';
import type { DbAdapter, Organization, ProbeEvidenceInput, Target } from '../../../utils/dbAdapter';

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
}

const PASSIVE_GATE: UrlTargetGate = {
  activeProbe: false,
  target: null,
  targetRow: null,
  organizationId: null,
  paidTierAllowed: false,
};

/**
 * Enforces the plan's guarded-app entitlement (Phase 8) before a NEW `url` target
 * is created. A re-scan of an already-guarded app is always allowed; only guarding
 * a brand-new app past the plan's `guardedAppLimit` is rejected — server-side, so
 * the UI cannot bypass it. Fails OPEN on a DB error (a transient count failure must
 * never 500 a scan or wrongly block a paying customer) but throws a real 402 on a
 * confirmed over-limit, which propagates out of the route.
 */
async function assertWithinGuardedAppLimit(
  db: DbAdapter,
  organization: Organization,
  identifier: string,
): Promise<void> {
  const { guardedAppLimit } = entitlementsForPlan(organization.billing_plan);
  if (guardedAppLimit === null) return;

  let existing: Target | null;
  let currentCount: number;
  try {
    existing = await db.getTargetByIdentifier(organization.id, 'url', identifier);
    if (existing) return; // updating an existing guarded app, not creating a new one
    currentCount = (await db.getTargets(organization.id)).length;
  } catch {
    return; // fail open on a lookup error — never block a scan over a count failure
  }

  if (currentCount >= guardedAppLimit) {
    throw new ApiError(
      402,
      'plan_required',
      `Your plan guards up to ${guardedAppLimit} app${guardedAppLimit === 1 ? '' : 's'}. Upgrade to guard more.`,
    );
  }
}

/**
 * Resolves (or creates) the caller's `url` target for this origin and decides
 * whether the ACTIVE proof-probe may run. The ownership gate is enforced here,
 * server-side: an active data-pull is impossible for a `url` target unless it is
 * `ownership_verified = true`. Fail-closed — any lookup failure leaves the scan
 * passive-only. The guarded-app entitlement (Phase 8) is enforced BEFORE the
 * upsert; an over-limit `ApiError` deliberately propagates (it is not swallowed).
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

  const identifier = normalizeUrlIdentifier(scanUrl);
  // Server-side entitlement gate (Phase 8). Throws 402 on a confirmed over-limit,
  // which must escape this function — hence it runs OUTSIDE the passive try/catch.
  await assertWithinGuardedAppLimit(auth.db, organization, identifier);

  try {
    // Upsert preserves ownership_verified on conflict (it is not in the payload),
    // so re-scanning never silently re-grants or revokes an active probe.
    const row = await auth.db.upsertTarget({
      organizationId: organization.id,
      kind: 'url',
      identifier,
      displayName: identifier,
    });
    return {
      activeProbe: isActiveProbeAllowed({ kind: 'url', ownershipVerified: row.ownership_verified }),
      target: { id: row.id, ownershipVerified: row.ownership_verified },
      targetRow: row,
      organizationId: organization.id,
      paidTierAllowed: entitlementsForPlan(organization.billing_plan).deepReviewEnabled,
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

    const { findings, evidence, planSource, pageText } = await scanLiveUrlWithEvidence(
      parsedUrl.toString(),
      fetch,
      undefined,
      {
        activeProbe: gate.activeProbe,
        organizationId: gate.organizationId ?? undefined,
      },
    );
    const report = buildShipGateFromWebFindings(findings, {
      scannedFileCount: 1,
      cleanFileCount: findings.length === 0 ? 1 : 0,
    });

    if (auth) await persistEvidence(auth, evidence);

    // Seed the moat corpus grouping: persist a detected fingerprint on the url
    // target created above. pageText stays server-side — never returned to the client.
    if (auth && gate.organizationId && gate.targetRow) {
      await persistGeneratorFingerprint(
        auth.db,
        gate.organizationId,
        normalizeUrlIdentifier(parsedUrl.toString()),
        pageText ?? '',
      );
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
    });
  },
);
