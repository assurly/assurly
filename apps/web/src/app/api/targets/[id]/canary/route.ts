import { NextResponse } from 'next/server';
import { z } from 'zod';
import { RATE_LIMITS, requireRouteUser, secureRoute } from '../../../../../utils/apiSecurity';
import { generateCanaryToken } from '../../../../../utils/canaryTokens';
import {
  CANARY_PLANT_HINT,
  buildCanaryCallbackUrl,
  buildCanaryMcpDecoySnippet,
  buildCanaryPlantSnippet,
  resolveCanaryCallbackOrigin,
} from '../../../../../utils/canaryPlant';
import { getApplicationUrl } from '../../../../../utils/env';
import { ASSURLY_CANARY_PREFIX } from '@assurly/scanner-core';
import { requireOwnedCanaryTarget } from '../../../../../utils/canaryAccess';

const targetParams = z.object({ id: z.string().uuid() }).strict();

const issueBody = z
  .object({
    label: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

/** Lists non-secret canary metadata for a target (prefixes only — never hashes). */
export const GET = secureRoute(
  {
    routeId: 'targets:canary-list',
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
    const target = await requireOwnedCanaryTarget(context.db, params.id);
    const tokens = await context.db.listCanaryTokens(target.id);
    return NextResponse.json({
      targetId: target.id,
      prefix: ASSURLY_CANARY_PREFIX,
      tokens: tokens.map((token) => ({
        id: token.id,
        label: token.label,
        tokenPrefix: token.token_prefix,
        hitCount: token.hit_count,
        lastHitAt: token.last_hit_at,
        revokedAt: token.revoked_at,
        createdAt: token.created_at,
      })),
    });
  },
);

/**
 * Issues a new canary for an ownership-gated target. The plaintext is returned
 * exactly once; only the hash is persisted.
 */
export const POST = secureRoute(
  {
    routeId: 'targets:canary-issue',
    auth: 'required',
    query: z.object({}).strict(),
    params: targetParams,
    body: issueBody,
    bodyMode: 'json',
    maxBodyBytes: 2 * 1024,
    rateLimit: RATE_LIMITS.sensitive,
    csrf: true,
  },
  async ({ auth, params, body }) => {
    const context = requireRouteUser(auth);
    const target = await requireOwnedCanaryTarget(context.db, params.id);
    const generated = generateCanaryToken();
    const callbackUrl = buildCanaryCallbackUrl(
      resolveCanaryCallbackOrigin(getApplicationUrl()),
      generated.plaintext,
    );
    const snippet = buildCanaryPlantSnippet(callbackUrl);
    const mcpSnippet = buildCanaryMcpDecoySnippet(callbackUrl);
    const row = await context.db.createCanaryToken({
      organizationId: target.organization_id,
      targetId: target.id,
      tokenHash: generated.tokenHash,
      tokenPrefix: generated.tokenPrefix,
      label: body.label ?? 'Canary',
    });

    return NextResponse.json(
      {
        id: row.id,
        label: row.label,
        tokenPrefix: row.token_prefix,
        /** Shown once — store it where you want the tripwire. */
        token: generated.plaintext,
        callbackUrl,
        snippet,
        mcpSnippet,
        plantHint: CANARY_PLANT_HINT,
        createdAt: row.created_at,
      },
      { status: 201 },
    );
  },
);
