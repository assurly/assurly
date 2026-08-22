import { NextResponse } from 'next/server';
import { z } from 'zod';
import { RATE_LIMITS, requireApiKey, secureRoute } from '../../../../utils/apiSecurity';
import { getAdminDbAdapter } from '../../../../utils/dbAdapter';
import { requireOwnedCanaryTargetByIdentifier } from '../../../../utils/canaryAccess';
import { generateCanaryToken } from '../../../../utils/canaryTokens';
import {
  CANARY_PLANT_HINT,
  CANARY_SILENT_ALARM_LABEL,
  buildCanaryCallbackUrl,
  buildCanaryMcpDecoySnippet,
  buildCanaryPlantSnippet,
  resolveCanaryCallbackOrigin,
} from '../../../../utils/canaryPlant';
import { getApplicationUrl } from '../../../../utils/env';

const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

const issueBody = z
  .object({
    repo: z.string().trim().max(201).regex(REPO_PATTERN),
  })
  .strict();

/**
 * Programmatic silent-alarm mint for MCP/CLI plant. Returns the public snippet;
 * the caller writes `.env.example` locally — source never leaves their machine.
 */
export const POST = secureRoute(
  {
    routeId: 'v1:canary',
    auth: 'apiKey',
    query: z.object({}).strict(),
    params: z.object({}).strict(),
    body: issueBody,
    bodyMode: 'json',
    maxBodyBytes: 4 * 1024,
    rateLimit: RATE_LIMITS.sensitive,
  },
  async ({ apiKey, body }) => {
    const key = requireApiKey(apiKey);
    const db = getAdminDbAdapter();
    const target = await requireOwnedCanaryTargetByIdentifier(
      db,
      key.organizationId,
      'repo',
      body.repo,
    );

    const generated = generateCanaryToken();
    const callbackUrl = buildCanaryCallbackUrl(
      resolveCanaryCallbackOrigin(getApplicationUrl()),
      generated.plaintext,
    );
    const snippet = buildCanaryPlantSnippet(callbackUrl);
    const mcpSnippet = buildCanaryMcpDecoySnippet(callbackUrl);
    const row = await db.createCanaryToken({
      organizationId: target.organization_id,
      targetId: target.id,
      tokenHash: generated.tokenHash,
      tokenPrefix: generated.tokenPrefix,
      label: CANARY_SILENT_ALARM_LABEL,
    });

    return NextResponse.json(
      {
        id: row.id,
        label: row.label,
        tokenPrefix: row.token_prefix,
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
