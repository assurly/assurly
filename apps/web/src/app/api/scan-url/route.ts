import { NextResponse } from 'next/server';
import { z } from 'zod';
import { runDeepReview } from '../../../utils/ai/deepReview';
import { buildShipGateFromWebFindings } from '../../../utils/shipGate';
import { ApiError, emptyObjectSchema, RATE_LIMITS, secureRoute } from '../../../utils/apiSecurity';
import { scanLiveUrlWithEvidence, type ProbeEvidence } from '../../../utils/runtimeScanner';
import { assertScannableUrl, UrlSafetyError } from '../../../utils/urlSafety';
import { isActiveProbeAllowed, normalizeUrlIdentifier } from '../../../utils/ownership';
import type { AuthContext } from '../../../utils/auth';
import type { ProbeEvidenceInput } from '../../../utils/dbAdapter';

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
  organizationId: string | null;
  paidTierAllowed: boolean;
}

/**
 * Resolves (or creates) the caller's `url` target for this origin and decides
 * whether the ACTIVE proof-probe may run. The ownership gate is enforced here,
 * server-side: an active data-pull is impossible for a `url` target unless it is
 * `ownership_verified = true`. Fail-closed — any lookup failure leaves the scan
 * passive-only.
 */
async function resolveUrlTargetGate(auth: AuthContext, scanUrl: string): Promise<UrlTargetGate> {
  try {
    const organization = await auth.db.getOrganizationByUserId(auth.user.id);
    if (!organization) {
      return { activeProbe: false, target: null, organizationId: null, paidTierAllowed: false };
    }

    const identifier = normalizeUrlIdentifier(scanUrl);
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
      organizationId: organization.id,
      paidTierAllowed: organization.billing_plan === 'pro',
    };
  } catch (error) {
    console.warn('[Assurly] failed to resolve url target gate:', (error as Error).message);
    return { activeProbe: false, target: null, organizationId: null, paidTierAllowed: false };
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
    const gate = auth
      ? await resolveUrlTargetGate(auth, parsedUrl.toString())
      : {
          activeProbe: false,
          target: null,
          organizationId: null,
          paidTierAllowed: false,
        };

    const { findings, evidence, planSource } = await scanLiveUrlWithEvidence(
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

    // Layer 2 deep review (paid only). Never blocks the Layer-1 verdict — null
    // when free tier, AI unavailable, or the call fails.
    const deepReview = await runDeepReview(
      findings,
      { targetOrigin: parsedUrl.origin },
      {
        organizationId: gate.organizationId ?? undefined,
        paidTierAllowed: gate.paidTierAllowed,
      },
    );

    return NextResponse.json({
      report,
      findings,
      evidence,
      target: gate.target,
      ...(planSource ? { planSource } : {}),
      ...(deepReview ? { deepReview } : {}),
    });
  },
);
