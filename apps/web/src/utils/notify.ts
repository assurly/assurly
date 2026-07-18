import type { ScanFinding } from './dbAdapter';
import { getResendApiKey, getResendFromAddress } from './env';

export interface RegressionAlertRepository {
  name: string;
}

export type RegressionWebhookChannel = 'slack' | 'discord';

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;',
    };
    return entities[character];
  });
}

function formatRegressionList(regressions: ScanFinding[]): string {
  return regressions
    .map((finding) => {
      const location = finding.line_number
        ? `${finding.file_path}:L${finding.line_number}`
        : finding.file_path;
      return `<li><strong>${escapeHtml(location)}</strong> — ${escapeHtml(finding.message)}</li>`;
    })
    .join('');
}

function formatRegressionPlainList(regressions: ScanFinding[]): string {
  return regressions
    .map((finding) => {
      const location = finding.line_number
        ? `${finding.file_path}:L${finding.line_number}`
        : finding.file_path;
      return `• ${location} — ${finding.message}`;
    })
    .join('\n');
}

/** Sends a regression alert email via Resend. No-ops when the API key is absent. */
export async function sendRegressionAlert(
  to: string | string[],
  repo: RegressionAlertRepository,
  regressions: ScanFinding[],
): Promise<void> {
  if (regressions.length === 0) return;

  const apiKey = getResendApiKey();
  if (!apiKey) {
    console.warn('[Assurly] RESEND_API_KEY is not configured; regression alert skipped.');
    return;
  }

  const recipients = Array.isArray(to) ? to : [to];
  const repoName = escapeHtml(repo.name);
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from: getResendFromAddress(),
      to: recipients,
      subject: `[Assurly] New blocker in ${repo.name}`,
      html: `<h2>New Ship Gate blocker detected</h2><p>Your app was safe yesterday; a new blocker appeared in <strong>${repoName}</strong>.</p><ul>${formatRegressionList(regressions)}</ul><p>Review the latest check in your Assurly dashboard.</p>`,
    }),
  });

  if (!response.ok) {
    throw new Error(`Regression alert email delivery failed (${response.status}).`);
  }
}

/**
 * Optional Slack/Discord incoming-webhook delivery alongside email (Phase 6).
 * Does not replace Resend — call sites should keep sendRegressionAlert as the
 * primary channel. Validates the URL shape before fetching.
 */
export async function sendWebhookRegressionAlert(
  webhookUrl: string,
  channel: RegressionWebhookChannel,
  repo: RegressionAlertRepository,
  regressions: ScanFinding[],
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  if (regressions.length === 0) return;
  if (!isAllowedIncomingWebhookUrl(webhookUrl, channel)) {
    console.warn(`[Assurly] Rejected ${channel} webhook URL; alert skipped.`);
    return;
  }

  const text =
    `Assurly: new Ship Gate blocker in ${repo.name}\n` +
    `Your app was safe yesterday; this check found a regression.\n` +
    formatRegressionPlainList(regressions);

  const body =
    channel === 'slack'
      ? { text }
      : {
          content: text.slice(0, 1900),
        };

  const response = await fetchImpl(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Regression ${channel} webhook delivery failed (${response.status}).`);
  }
}

/** Allow only well-known Slack/Discord incoming-webhook hosts over HTTPS. */
export function isAllowedIncomingWebhookUrl(
  rawUrl: string,
  channel: RegressionWebhookChannel,
): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;

  switch (channel) {
    case 'slack':
      return parsed.hostname === 'hooks.slack.com' && parsed.pathname.startsWith('/services/');
    case 'discord':
      return (
        (parsed.hostname === 'discord.com' || parsed.hostname === 'discordapp.com') &&
        parsed.pathname.startsWith('/api/webhooks/')
      );
    default: {
      const neverChannel: never = channel;
      return neverChannel;
    }
  }
}
