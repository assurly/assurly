import type { ScanFinding } from './dbAdapter';
import { getResendApiKey, getResendFromAddress } from './env';

export interface RegressionAlertRepository {
  name: string;
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

/** Sends a regression alert email via Resend. No-ops when the API key is absent. */
export async function sendRegressionAlert(
  to: string | string[],
  repo: RegressionAlertRepository,
  regressions: ScanFinding[],
): Promise<void> {
  if (regressions.length === 0) return;

  const apiKey = getResendApiKey();
  if (!apiKey) {
    console.warn('[ShipReady] RESEND_API_KEY is not configured; regression alert skipped.');
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
      subject: `[ShipReady] New blocker in ${repo.name}`,
      html: `<h2>New Ship Gate blocker detected</h2><p>A new blocker appeared in <strong>${repoName}</strong> since the previous scan.</p><ul>${formatRegressionList(regressions)}</ul><p>Review the latest scan in your ShipReady dashboard.</p>`,
    }),
  });

  if (!response.ok) {
    throw new Error(`Regression alert email delivery failed (${response.status}).`);
  }
}
