import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  ApiError,
  emptyObjectSchema,
  RATE_LIMITS,
  requireRouteUser,
  secureRoute,
} from '../../../../../utils/apiSecurity';
import { isAllowedIncomingWebhookUrl } from '../../../../../utils/notify';

const idParams = z.object({ id: z.string().uuid() }).strict();

const prefBodySchema = z
  .object({
    channel: z.enum(['email', 'slack', 'discord']),
    enabled: z.boolean(),
    webhookUrl: z.string().url().max(2048).nullable().optional(),
  })
  .strict();

function serializePref(row: {
  id: string;
  channel: string;
  webhook_url: string | null;
  enabled: boolean;
  updated_at: string;
}): {
  id: string;
  channel: string;
  webhookUrl: string | null;
  enabled: boolean;
  updatedAt: string;
} {
  return {
    id: row.id,
    channel: row.channel,
    webhookUrl: row.webhook_url,
    enabled: row.enabled,
    updatedAt: row.updated_at,
  };
}

export const GET = secureRoute(
  {
    routeId: 'targets:alert-prefs:read',
    auth: 'required',
    query: emptyObjectSchema,
    params: idParams,
    body: z.undefined(),
    bodyMode: 'none',
    maxBodyBytes: 0,
    rateLimit: RATE_LIMITS.read,
  },
  async ({ auth, params }) => {
    const context = requireRouteUser(auth);
    const target = await context.db.getTargetById(params.id);
    if (!target) throw new ApiError(404, 'not_found', 'Target not found.');

    const prefs = await context.db.getTargetAlertPrefs(target.id);
    return NextResponse.json({ prefs: prefs.map(serializePref) });
  },
);

export const PUT = secureRoute(
  {
    routeId: 'targets:alert-prefs:write',
    auth: 'required',
    csrf: true,
    query: emptyObjectSchema,
    params: idParams,
    body: prefBodySchema,
    bodyMode: 'json',
    maxBodyBytes: 4 * 1024,
    rateLimit: RATE_LIMITS.write,
  },
  async ({ auth, params, body }) => {
    const context = requireRouteUser(auth);
    const target = await context.db.getTargetById(params.id);
    if (!target) throw new ApiError(404, 'not_found', 'Target not found.');

    if (body.channel === 'slack' || body.channel === 'discord') {
      if (body.enabled) {
        const url = body.webhookUrl ?? null;
        if (!url || !isAllowedIncomingWebhookUrl(url, body.channel)) {
          throw new ApiError(
            400,
            'invalid_webhook',
            `A valid ${body.channel} incoming-webhook HTTPS URL is required.`,
          );
        }
      }
    }

    const pref = await context.db.upsertTargetAlertPref({
      organizationId: target.organization_id,
      targetId: target.id,
      channel: body.channel,
      webhookUrl: body.channel === 'email' ? null : (body.webhookUrl ?? null),
      enabled: body.enabled,
    });

    return NextResponse.json({ pref: serializePref(pref) });
  },
);
