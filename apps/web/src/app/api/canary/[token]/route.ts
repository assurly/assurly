import { after } from 'next/server';
import { z } from 'zod';
import { RATE_LIMITS, secureRoute } from '../../../../utils/apiSecurity';
import { getAdminDbAdapter } from '../../../../utils/dbAdapter';
import {
  canaryCallbackResponse,
  hashCanarySource,
  hashCanaryToken,
  isValidCanaryTokenFormat,
  sendCanaryAlertEmail,
  sendCanaryWebhookAlert,
} from '../../../../utils/canaryTokens';
import type { CanaryTokenAuthRow, DbAdapter } from '../../../../utils/dbAdapter';

/**
 * Public canary callback. Unauthenticated by definition.
 *
 * Oracle-safety invariants (do not weaken):
 *   - Identical response for valid, invalid, and malformed tokens.
 *   - Never disclose owner, target, org, or any metadata.
 *   - Constant-ish work: hash + lookup regardless of validity.
 *   - Rate limit tighter than RATE_LIMITS.public.
 */
// min(0): empty/malformed tokens must still get the identical 200 response
// (oracle-safety). secureRoute would otherwise 400 before our handler runs.
const tokenParams = z.object({ token: z.string().min(0).max(200) }).strict();

function clientIp(request: Request): string | null {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]?.trim() ?? null;
  return request.headers.get('x-real-ip');
}

async function lookupCanaryHit(
  db: DbAdapter,
  token: string,
  request: Request,
): Promise<CanaryTokenAuthRow | null> {
  // Always hash — including malformed — so timing does not become an oracle.
  const candidate = isValidCanaryTokenFormat(token) ? token : token || 'invalid';
  const tokenHash = hashCanaryToken(candidate);
  if (!isValidCanaryTokenFormat(token)) {
    // Still touch the DB shape with a guaranteed-miss hash for constant-ish work.
    await db.getCanaryTokenByHash(tokenHash);
    return null;
  }
  const row = await db.getCanaryTokenByHash(tokenHash);
  if (!row || row.revoked_at) return null;
  const { sourceHash, userAgentHash } = hashCanarySource(
    clientIp(request),
    request.headers.get('user-agent'),
  );
  await db.recordCanaryTokenHit({
    canaryTokenId: row.id,
    organizationId: row.organization_id,
    targetId: row.target_id,
    sourceHash,
    userAgentHash,
  });
  return row;
}

async function handleCanaryCallback(
  request: Request,
  token: string,
  requestId: string,
): Promise<Response> {
  const db = getAdminDbAdapter();

  let hit: CanaryTokenAuthRow | null = null;
  try {
    hit = await lookupCanaryHit(db, token, request);
  } catch (error) {
    console.error(
      JSON.stringify({
        service: 'assurly-api',
        requestId,
        route: 'canary:callback',
        status: 'lookup_failed',
        errorType: error instanceof Error ? error.name : 'UnknownError',
      }),
    );
  }

  if (hit) {
    after(async () => {
      try {
        const target = await db.getTargetById(hit.target_id);
        const targetLabel = target?.display_name || target?.identifier || 'your app';
        const emails = await db.getOrganizationAdminEmails(hit.organization_id);
        if (emails.length > 0) {
          await sendCanaryAlertEmail(emails, targetLabel, hit.token_prefix);
        }
        if (target) {
          const prefs = await db.getTargetAlertPrefs(target.id);
          for (const pref of prefs) {
            if (pref.channel === 'email') continue;
            if ((pref.channel === 'slack' || pref.channel === 'discord') && pref.webhook_url) {
              await sendCanaryWebhookAlert(
                pref.webhook_url,
                pref.channel,
                targetLabel,
                hit.token_prefix,
              ).catch(() => undefined);
            }
          }
        }
      } catch (error) {
        console.error(
          JSON.stringify({
            service: 'assurly-api',
            requestId,
            route: 'canary:callback:alert',
            status: 'failed',
            errorType: error instanceof Error ? error.name : 'UnknownError',
          }),
        );
      }
    });
  }

  return canaryCallbackResponse();
}

export const GET = secureRoute(
  {
    routeId: 'canary:callback',
    auth: 'none',
    query: z.object({}).strict(),
    params: tokenParams,
    body: z.undefined(),
    bodyMode: 'none',
    maxBodyBytes: 0,
    rateLimit: RATE_LIMITS.canaryCallback,
  },
  async ({ request, params, requestId }) => handleCanaryCallback(request, params.token, requestId),
);

export const POST = secureRoute(
  {
    routeId: 'canary:callback-post',
    auth: 'none',
    query: z.object({}).strict(),
    params: tokenParams,
    body: z.string(),
    bodyMode: 'raw',
    maxBodyBytes: 8 * 1024,
    rateLimit: RATE_LIMITS.canaryCallback,
  },
  async ({ request, params, requestId }) => handleCanaryCallback(request, params.token, requestId),
);
