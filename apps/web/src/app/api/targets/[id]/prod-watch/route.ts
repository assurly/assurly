import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  ApiError,
  RATE_LIMITS,
  requireRouteUser,
  secureRoute,
} from '../../../../../utils/apiSecurity';
import type { DbAdapter, Target } from '../../../../../utils/dbAdapter';
import { isActiveProbeAllowed } from '../../../../../utils/ownership';
import {
  encryptProdWatchToken,
  isProdWatchFeatureEnabled,
  isValidSupabaseProjectRef,
} from '../../../../../utils/prodWatch';

const targetParams = z.object({ id: z.string().uuid() }).strict();

const enableBody = z
  .object({
    supabaseProjectRef: z
      .string()
      .trim()
      .min(10)
      .max(32)
      .regex(/^[a-z0-9]+$/, 'Project ref must be lowercase alphanumeric.'),
    /**
     * Customer-supplied Supabase Management API access token. Must be read-only
     * in practice; Assurly only issues GET to the hardcoded Management host.
     */
    accessToken: z.string().trim().min(20).max(2048),
  })
  .strict();

async function loadOwnedTarget(db: DbAdapter, id: string): Promise<Target> {
  const target = await db.getTargetById(id);
  if (!target) throw new ApiError(404, 'not_found', 'Target not found.');
  if (
    !isActiveProbeAllowed({
      kind: target.kind,
      ownershipVerified: target.ownership_verified,
    })
  ) {
    throw new ApiError(
      403,
      'ownership_required',
      'Verify ownership of this target before enabling Prod Watch.',
    );
  }
  return target;
}

/**
 * GET — current Prod Watch opt-in state (never returns the credential).
 * Off by default when no row exists.
 */
export const GET = secureRoute(
  {
    routeId: 'targets:prod-watch-get',
    auth: 'required',
    query: z.object({}).strict(),
    params: targetParams,
    body: z.undefined(),
    bodyMode: 'none',
    maxBodyBytes: 0,
    rateLimit: RATE_LIMITS.read,
  },
  async ({ auth, params }) => {
    const context = requireRouteUser(auth);
    const target = await loadOwnedTarget(context.db, params.id);
    const sub = await context.db.getProdWatchSubscription(target.id);
    return NextResponse.json({
      featureEnabled: isProdWatchFeatureEnabled(),
      targetId: target.id,
      enabled: sub?.enabled === true,
      supabaseProjectRef: sub?.supabase_project_ref ?? null,
      lastStatus: sub?.last_status ?? 'never',
      lastCheckedAt: sub?.last_checked_at ?? null,
      lastError: sub?.last_error ?? null,
      // Explicit: credential material is never returned after enable.
      hasCredential: Boolean(sub?.access_token_ciphertext),
    });
  },
);

/**
 * PUT — explicit opt-in. Requires ownership + feature flag. Never inferred
 * from an existing scan relationship alone.
 */
export const PUT = secureRoute(
  {
    routeId: 'targets:prod-watch-enable',
    auth: 'required',
    query: z.object({}).strict(),
    params: targetParams,
    body: enableBody,
    bodyMode: 'json',
    maxBodyBytes: 8_192,
    rateLimit: RATE_LIMITS.write,
    csrf: true,
  },
  async ({ auth, params, body }) => {
    if (!isProdWatchFeatureEnabled()) {
      throw new ApiError(
        403,
        'feature_disabled',
        'Prod Watch is not enabled in this environment.',
      );
    }
    const context = requireRouteUser(auth);
    const target = await loadOwnedTarget(context.db, params.id);
    if (!isValidSupabaseProjectRef(body.supabaseProjectRef)) {
      throw new ApiError(400, 'invalid_request', 'Invalid Supabase project ref.');
    }

    const publicRow = await context.db.upsertProdWatchSubscription({
      organizationId: target.organization_id,
      targetId: target.id,
      enabled: true,
      supabaseProjectRef: body.supabaseProjectRef,
      accessTokenCiphertext: encryptProdWatchToken(body.accessToken),
    });

    return NextResponse.json({
      targetId: target.id,
      enabled: publicRow.enabled,
      supabaseProjectRef: publicRow.supabase_project_ref,
      lastStatus: publicRow.last_status,
      // Reminder in API shape — no detection promise.
      notice:
        'Prod Watch is observational only. It does not guarantee detection or continuous coverage, and never blocks a ship.',
    });
  },
);

/**
 * DELETE — one-click disable: deletes credential and purges derived data.
 */
export const DELETE = secureRoute(
  {
    routeId: 'targets:prod-watch-disable',
    auth: 'required',
    query: z.object({}).strict(),
    params: targetParams,
    body: z.undefined(),
    bodyMode: 'none',
    maxBodyBytes: 0,
    rateLimit: RATE_LIMITS.write,
    csrf: true,
  },
  async ({ auth, params }) => {
    const context = requireRouteUser(auth);
    const target = await loadOwnedTarget(context.db, params.id);
    await context.db.revokeProdWatchSubscription(target.id);
    return NextResponse.json({
      targetId: target.id,
      enabled: false,
      purged: true,
    });
  },
);
