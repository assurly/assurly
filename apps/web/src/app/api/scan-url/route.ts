import { NextResponse } from 'next/server';
import { z } from 'zod';
import { buildShipGateFromWebFindings } from '../../../utils/shipGate';
import { ApiError, emptyObjectSchema, RATE_LIMITS, secureRoute } from '../../../utils/apiSecurity';
import { scanLiveUrlWithEvidence, type ProbeEvidence } from '../../../utils/runtimeScanner';
import { assertScannableUrl, UrlSafetyError } from '../../../utils/urlSafety';
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

    // Active data-exfiltration proof (Supabase RLS row-pull) only runs for a
    // signed-in user. Anonymous callers get the safe/passive checks (headers,
    // public-bundle secrets) until ownership verification lands in Phase 3.
    const activeProbe = auth !== null;

    const { findings, evidence } = await scanLiveUrlWithEvidence(
      parsedUrl.toString(),
      fetch,
      undefined,
      { activeProbe },
    );
    const report = buildShipGateFromWebFindings(findings, {
      scannedFileCount: 1,
      cleanFileCount: findings.length === 0 ? 1 : 0,
    });

    if (auth) await persistEvidence(auth, evidence);

    return NextResponse.json({ report, findings, evidence });
  },
);
