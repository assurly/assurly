/**
 * Assurly canary tokens — issue, hash, and alert helpers.
 *
 * Mirrors api_keys: plaintext shown once, only sha256 persisted. Prefix
 * `ask_canary_` is recognised by scanner-core so planted canaries are never
 * reported as leaks.
 */
import crypto from 'node:crypto';
import { ASSURLY_CANARY_PREFIX, isAssurlyCanaryToken } from '@assurly/scanner-core';
import { CANARY_HIT_ROTATE_COPY } from './canaryPlant';
import { getAdminDbAdapter, type CanaryTokenAuthRow, type DbAdapter } from './dbAdapter';
import { getResendApiKey, getResendFromAddress } from './env';
import { isAllowedIncomingWebhookUrl, type RegressionWebhookChannel } from './notify';

const DISPLAY_BODY_CHARS = 6;

export interface GeneratedCanaryToken {
  plaintext: string;
  tokenHash: string;
  tokenPrefix: string;
}

export function hashCanaryToken(plaintext: string): string {
  return crypto.createHash('sha256').update(plaintext, 'utf8').digest('hex');
}

/** Mints a new canary. 24 random bytes as base64url → 32-char body. */
export function generateCanaryToken(): GeneratedCanaryToken {
  const body = crypto.randomBytes(24).toString('base64url');
  const plaintext = `${ASSURLY_CANARY_PREFIX}${body}`;
  return {
    plaintext,
    tokenHash: hashCanaryToken(plaintext),
    tokenPrefix: `${ASSURLY_CANARY_PREFIX}${body.slice(0, DISPLAY_BODY_CHARS)}`,
  };
}

export function isValidCanaryTokenFormat(candidate: string): boolean {
  return isAssurlyCanaryToken(candidate);
}

/**
 * Coarse source fingerprint for hit logging. Never stores a raw IP — hashes a
 * truncated form (IPv4 /24, IPv6 /48) so the alert still has a stable signal.
 */
export function hashCanarySource(
  rawIp: string | null,
  userAgent: string | null,
): {
  sourceHash: string;
  userAgentHash: string | null;
} {
  const truncated = truncateIpForHash(rawIp);
  const sourceHash = crypto
    .createHash('sha256')
    .update(truncated || 'unknown')
    .digest('hex')
    .slice(0, 32);
  const userAgentHash = userAgent
    ? crypto.createHash('sha256').update(userAgent.slice(0, 200)).digest('hex').slice(0, 32)
    : null;
  return { sourceHash, userAgentHash };
}

function truncateIpForHash(rawIp: string | null): string {
  if (!rawIp) return '';
  const ip = rawIp.trim().split(',')[0]?.trim() ?? '';
  if (!ip) return '';
  // IPv4 → keep /24
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
    const parts = ip.split('.');
    return `${parts[0]}.${parts[1]}.${parts[2]}.0`;
  }
  // IPv6 → keep first 3 hextets (/48-ish)
  if (ip.includes(':')) {
    const parts = ip.split(':').filter(Boolean);
    return `${parts.slice(0, 3).join(':')}::`;
  }
  return 'other';
}

/** Identical JSON body for every canary callback response (oracle-safe). */
export const CANARY_CALLBACK_BODY = Object.freeze({ ok: true });

export function canaryCallbackResponse(): Response {
  return new Response(JSON.stringify(CANARY_CALLBACK_BODY), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

/**
 * Records a hit when the token hashes to a live canary. Always constant-time-ish
 * work from the caller's perspective — lookup runs for any well-formed token.
 * Returns whether a live canary was hit (for server logs only).
 */
export async function recordCanaryHitIfPresent(
  plaintext: string,
  rawIp: string | null,
  userAgent: string | null,
  db: DbAdapter = getAdminDbAdapter(),
): Promise<CanaryTokenAuthRow | null> {
  if (!isValidCanaryTokenFormat(plaintext)) {
    // Still hash so invalid/malformed paths do comparable work.
    hashCanaryToken(plaintext || 'invalid');
    return null;
  }

  const tokenHash = hashCanaryToken(plaintext);
  const row = await db.getCanaryTokenByHash(tokenHash);
  if (!row || row.revoked_at) return null;

  const { sourceHash, userAgentHash } = hashCanarySource(rawIp, userAgent);
  await db.recordCanaryTokenHit({
    canaryTokenId: row.id,
    organizationId: row.organization_id,
    targetId: row.target_id,
    sourceHash,
    userAgentHash,
  });
  return row;
}

export async function sendCanaryAlertEmail(
  to: string | string[],
  targetLabel: string,
  tokenPrefix: string,
): Promise<void> {
  const apiKey = getResendApiKey();
  if (!apiKey) {
    console.warn('[Assurly] RESEND_API_KEY is not configured; canary alert skipped.');
    return;
  }
  const recipients = Array.isArray(to) ? to : [to];
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from: getResendFromAddress(),
      to: recipients,
      subject: `[Assurly] Canary token triggered for ${targetLabel}`,
      html: `<h2>Canary tripwire was fetched</h2><p>Someone fetched a planted Assurly canary (<code>${tokenPrefix}…</code>) for <strong>${escapeHtml(targetLabel)}</strong>.</p><p>${escapeHtml(CANARY_HIT_ROTATE_COPY)}</p>`,
    }),
  });
  if (!response.ok) {
    throw new Error(`Canary alert email delivery failed (${response.status}).`);
  }
}

export async function sendCanaryWebhookAlert(
  webhookUrl: string,
  channel: RegressionWebhookChannel,
  targetLabel: string,
  tokenPrefix: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  if (!isAllowedIncomingWebhookUrl(webhookUrl, channel)) {
    console.warn(`[Assurly] Rejected ${channel} webhook URL; canary alert skipped.`);
    return;
  }
  const text = `Assurly: canary tripwire fetched for ${targetLabel}\n${CANARY_HIT_ROTATE_COPY} (${tokenPrefix}…)`;
  const body = channel === 'slack' ? { text } : { content: text.slice(0, 1900) };
  const response = await fetchImpl(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Canary ${channel} webhook delivery failed (${response.status}).`);
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;',
    };
    return entities[character] ?? character;
  });
}
