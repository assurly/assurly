import type { DbAdapter, Target } from '../dbAdapter';
import { getResendApiKey, getResendFromAddress } from '../env';
import {
  isAllowedIncomingWebhookUrl,
  type RegressionWebhookChannel,
} from '../notify';
import {
  PROD_WATCH_ABUSE_RULE_ID,
  PROD_WATCH_ALERT_COLLAPSE_MS,
} from './constants';

export interface ProdWatchAlertDecision {
  shouldAlert: boolean;
  reason: 'no_sequence' | 'collapsed' | 'fire';
  incidentId?: string;
}

/**
 * Collapse repeat alerts for an ongoing incident. One open incident per
 * (target, rule) produces at most one alert per PROD_WATCH_ALERT_COLLAPSE_MS.
 */
export async function decideProdWatchAlert(options: {
  db: DbAdapter;
  organizationId: string;
  targetId: string;
  detected: boolean;
  nowMs?: number;
}): Promise<ProdWatchAlertDecision> {
  const nowMs = options.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();

  if (!options.detected) {
    await options.db.closeProdWatchIncident({
      targetId: options.targetId,
      ruleId: PROD_WATCH_ABUSE_RULE_ID,
    });
    return { shouldAlert: false, reason: 'no_sequence' };
  }

  const open = await options.db.getOpenProdWatchIncident(
    options.targetId,
    PROD_WATCH_ABUSE_RULE_ID,
  );

  if (open?.last_alerted_at) {
    const last = Date.parse(open.last_alerted_at);
    if (Number.isFinite(last) && nowMs - last < PROD_WATCH_ALERT_COLLAPSE_MS) {
      await options.db.touchProdWatchIncident({
        id: open.id,
        lastSeenAt: nowIso,
        alerted: false,
      });
      return { shouldAlert: false, reason: 'collapsed', incidentId: open.id };
    }
  }

  const incident = await options.db.upsertOpenProdWatchIncident({
    organizationId: options.organizationId,
    targetId: options.targetId,
    ruleId: PROD_WATCH_ABUSE_RULE_ID,
    lastSeenAt: nowIso,
    lastAlertedAt: nowIso,
  });

  return { shouldAlert: true, reason: 'fire', incidentId: incident.id };
}

export async function notifyProdWatchAbuse(options: {
  db: DbAdapter;
  target: Target;
  organizationAdminEmails: string[];
}): Promise<void> {
  const label = options.target.display_name ?? options.target.identifier;
  const prefs = await options.db.getTargetAlertPrefs(options.target.id);

  const emailPref = prefs.find((pref) => pref.channel === 'email');
  const emailEnabled = emailPref ? emailPref.enabled : true;
  if (emailEnabled && options.organizationAdminEmails.length > 0) {
    await sendProdWatchAlertEmail(options.organizationAdminEmails, label);
  }

  for (const channel of ['slack', 'discord'] as const) {
    const pref = prefs.find((row) => row.channel === channel);
    if (!pref?.enabled || !pref.webhook_url) continue;
    await sendProdWatchWebhookAlert(pref.webhook_url, channel, label);
  }
}

async function sendProdWatchAlertEmail(
  to: string[],
  targetLabel: string,
): Promise<void> {
  const apiKey = getResendApiKey();
  if (!apiKey) {
    console.warn('[Assurly] RESEND_API_KEY is not configured; Prod Watch alert skipped.');
    return;
  }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from: getResendFromAddress(),
      to,
      subject: `[Assurly] Prod Watch observation for ${targetLabel}`,
      html:
        `<h2>Possible anon-key abuse sequence observed</h2>` +
        `<p>Prod Watch derived an abuse-sequence signal for <strong>${escapeHtml(targetLabel)}</strong> ` +
        `from recent Supabase API traffic shapes (schema introspection → table enumeration → bulk read).</p>` +
        `<p><em>This is an observation about traffic that already happened. It is not a guarantee of ` +
        `intrusion, continuous coverage, or detection of every attack. It does not block a ship.</em></p>` +
        `<p>Review the target in your Assurly dashboard and your Supabase project logs. ` +
        `Rotate the anon key if you confirm misuse.</p>`,
    }),
  });
  if (!response.ok) {
    throw new Error(`Prod Watch alert email delivery failed (${response.status}).`);
  }
}

async function sendProdWatchWebhookAlert(
  webhookUrl: string,
  channel: RegressionWebhookChannel,
  targetLabel: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  if (!isAllowedIncomingWebhookUrl(webhookUrl, channel)) {
    console.warn(`[Assurly] Rejected ${channel} webhook URL; Prod Watch alert skipped.`);
    return;
  }
  const text =
    `Assurly Prod Watch observation for ${targetLabel}\n` +
    `Possible anon-key abuse sequence (schema → enumerate → bulk read). ` +
    `Informational only — not continuous coverage, not a ship blocker.`;
  const body = channel === 'slack' ? { text } : { content: text.slice(0, 1900) };
  const response = await fetchImpl(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Prod Watch ${channel} webhook delivery failed (${response.status}).`);
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
