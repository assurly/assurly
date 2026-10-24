import { after, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  ApiError,
  emptyObjectSchema,
  RATE_LIMITS,
  secureRoute,
} from '../../../../utils/apiSecurity';
import { getAdminDbAdapter, type Target } from '../../../../utils/dbAdapter';
import { applyGuardianAfterReprobe } from '../../../../utils/guardian';
import { reprobeTargetAndRecord } from '../../../../utils/reprobe';
import {
  extractDeployOrigins,
  getVercelWebhookSecret,
  verifyVercelWebhookSignature,
} from '../../../../utils/vercelWebhook';

export const maxDuration = 60;

/**
 * The deploy events that mean "a new version is live" and are worth re-probing.
 * Preview deploys are naturally filtered out downstream: their ephemeral URLs do
 * not match any verified target origin, so no probe runs for them.
 */
const HANDLED_EVENTS = new Set(['deployment.succeeded', 'deployment.promoted', 'deployment-ready']);

const DEPLOY_ID_PATTERN = /^[A-Za-z0-9_-]{1,120}$/;

const vercelEventSchema = z
  .object({
    type: z.string().min(1).max(80),
    payload: z
      .object({
        deployment: z
          .object({ id: z.string().min(1).max(200) })
          .passthrough()
          .optional(),
      })
      .passthrough(),
  })
  .passthrough();

/**
 * Receives Vercel deploy webhooks and, for a verified guarded app, re-probes it
 * to record the verified-fix outcome (Phase 5).
 *
 * Security model (mirrors api/github/webhook/route.ts):
 * - The endpoint is unauthenticated by definition, so the RAW body is verified
 *   against the Vercel signing secret (HMAC-SHA1) BEFORE any DB access or probe.
 * - The payload is UNTRUSTED. We never probe a target named in it. We resolve the
 *   target from OUR OWN DB, matching the deploy origin against a `url` target this
 *   org already owns and has verified — the origin is only a lookup key.
 * - A re-probe IS an active probe: it runs through `isActiveProbeAllowed` inside
 *   `reprobeTargetAndRecord`, which fails closed.
 * - Idempotency: the deploy is claimed BEFORE processing, so a re-fired delivery
 *   never triggers a second probe or a duplicate fix_outcome row.
 */
export const POST = secureRoute(
  {
    routeId: 'vercel:webhook',
    auth: 'none',
    query: emptyObjectSchema,
    params: emptyObjectSchema,
    body: z.string().max(1024 * 1024),
    bodyMode: 'raw',
    maxBodyBytes: 1024 * 1024,
    rateLimit: RATE_LIMITS.webhook,
  },
  async ({ request, body, requestId }) => {
    const secret = getVercelWebhookSecret();
    if (!verifyVercelWebhookSignature(body, request.headers.get('x-vercel-signature'), secret)) {
      throw new ApiError(401, 'invalid_signature', 'Invalid webhook signature.');
    }

    let rawPayload: unknown;
    try {
      rawPayload = JSON.parse(body);
    } catch {
      throw new ApiError(400, 'invalid_json', 'Request body must be valid JSON.');
    }

    const event = vercelEventSchema.parse(rawPayload);
    if (!HANDLED_EVENTS.has(event.type)) {
      return NextResponse.json({ message: 'Event ignored.' });
    }

    const deployId = event.payload.deployment?.id;
    if (!deployId || !DEPLOY_ID_PATTERN.test(deployId)) {
      throw new ApiError(400, 'invalid_deploy', 'Invalid deployment id.');
    }

    const origins = extractDeployOrigins(rawPayload);
    if (origins.length === 0) {
      return NextResponse.json({ message: 'No deploy origin.' });
    }

    const db = getAdminDbAdapter();
    // Resolve the target from OUR DB by identity. The payload origin is only a
    // lookup key; we probe the stored, verified identifier, never the payload.
    let target: Target | null = null;
    for (const origin of origins) {
      target = await db.findVerifiedUrlTargetByOrigin(origin);
      if (target) break;
    }
    if (!target) {
      return NextResponse.json({ message: 'No matching guarded app.' });
    }

    const claimed = await db.claimVercelDelivery(
      deployId,
      event.type,
      target.organization_id,
      target.id,
    );
    if (!claimed) return NextResponse.json({ message: 'Duplicate delivery ignored.' });

    const claimedTarget = target;
    after(async () => {
      try {
        // Re-probe through the ownership gate, then apply Phase 6 guardian
        // alerts (new blockers only) + verdict refresh. Never a second probe path.
        const reprobe = await reprobeTargetAndRecord({ target: claimedTarget, db, deployId });
        await applyGuardianAfterReprobe({
          db,
          target: claimedTarget,
          findings: reprobe.findings,
          probed: reprobe.probed,
        });
        await db.finishVercelDelivery(deployId, true);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(
          JSON.stringify({
            service: 'assurly-api',
            requestId,
            route: 'vercel:webhook:background',
            status: 'failed',
            errorType: error instanceof Error ? error.name : 'UnknownError',
          }),
        );
        await db.finishVercelDelivery(deployId, false, message).catch((finishError) => {
          console.error(
            JSON.stringify({
              service: 'assurly-api',
              requestId,
              route: 'vercel:webhook:finalize',
              status: 'failed',
              errorType: finishError instanceof Error ? finishError.name : 'UnknownError',
            }),
          );
        });
      }
    });

    return NextResponse.json({ message: 'Webhook accepted.' }, { status: 202 });
  },
);
