import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  ApiError,
  emptyObjectSchema,
  RATE_LIMITS,
  requireRouteUser,
  secureRoute,
} from '../../../utils/apiSecurity';
import { generateApiKey } from '../../../utils/apiKeys';
import type { ApiKeyRow } from '../../../utils/dbAdapter';
import { entitlementsForPlan, type BillingPlan } from '../../../utils/entitlements';

const createBodySchema = z
  .object({
    label: z.string().trim().min(1).max(120),
  })
  .strict();

/** Client DTO — never carries the key hash or the plaintext. */
function serializeApiKey(row: ApiKeyRow): {
  id: string;
  label: string;
  keyPrefix: string;
  plan: BillingPlan;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
} {
  return {
    id: row.id,
    label: row.label,
    keyPrefix: row.key_prefix,
    plan: row.plan,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
  };
}

/** List the org's programmatic API keys (metadata only — no hash, no plaintext). */
export const GET = secureRoute(
  {
    routeId: 'api-keys:read',
    auth: 'required',
    query: emptyObjectSchema,
    params: emptyObjectSchema,
    body: z.undefined(),
    bodyMode: 'none',
    maxBodyBytes: 0,
    rateLimit: RATE_LIMITS.read,
  },
  async ({ auth }) => {
    const context = requireRouteUser(auth);
    const org = await context.db.getOrganizationByUserId(context.user.id);
    if (!org) return NextResponse.json({ keys: [] });

    const keys = await context.db.listApiKeys(org.id);
    return NextResponse.json({ keys: keys.map(serializeApiKey) });
  },
);

/**
 * Issue a new key. The plaintext is generated server-side, returned exactly once
 * in this response, and NEVER persisted — only its sha256 hash is stored. The
 * plan is snapshotted from the org's billing plan for display; the live org plan
 * gates the programmatic rate limit.
 */
export const POST = secureRoute(
  {
    routeId: 'api-keys:create',
    auth: 'required',
    csrf: true,
    query: emptyObjectSchema,
    params: emptyObjectSchema,
    body: createBodySchema,
    bodyMode: 'json',
    maxBodyBytes: 4 * 1024,
    rateLimit: RATE_LIMITS.write,
  },
  async ({ auth, body }) => {
    const context = requireRouteUser(auth);
    const org = await context.db.getOrganizationByUserId(context.user.id);
    if (!org) throw new ApiError(400, 'no_organization', 'Create an organization first.');

    const generated = generateApiKey();
    // Snapshot the key's rate tier from the org's plan entitlement (server-side —
    // a caller cannot request a tier above what their plan grants).
    const { apiKeyTier } = entitlementsForPlan(org.billing_plan);
    const row = await context.db.createApiKey({
      organizationId: org.id,
      label: body.label,
      keyHash: generated.keyHash,
      keyPrefix: generated.keyPrefix,
      plan: apiKeyTier,
    });

    // `apiKey` (plaintext) is shown to the caller exactly once, here. It is not
    // stored (only `keyHash` is) and is deliberately excluded from the persisted
    // row and all subsequent list responses.
    return NextResponse.json(
      { apiKey: generated.plaintext, key: serializeApiKey(row) },
      {
        status: 201,
      },
    );
  },
);
