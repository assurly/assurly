import type { DbAdapter, Repository, ScanFinding, Target, TargetAlertPref } from './dbAdapter';
import { sendRegressionAlert, sendWebhookRegressionAlert } from './notify';

function regressionKey(
  finding: Pick<ScanFinding, 'rule_id' | 'file_path' | 'line_number'>,
): string {
  return `${finding.rule_id}|${finding.file_path}|${finding.line_number ?? 0}`;
}

/** Returns findings in `current` that were not present in `previous` (pure, no I/O). */
export function detectRegressions(previous: ScanFinding[], current: ScanFinding[]): ScanFinding[] {
  const previousKeys = new Set(previous.map(regressionKey));
  return current.filter((finding) => !previousKeys.has(regressionKey(finding)));
}

/**
 * A finding blocks the Ship Gate only when it is error-severity AND high
 * confidence — mirroring scanner-core's `isBlockerFinding` (a missing confidence
 * is treated as 'high' for legacy rows). Error + medium/low is a review item, so
 * it must NOT trigger a "new blocker" alert.
 */
function isBlockerFinding(finding: ScanFinding): boolean {
  return finding.severity === 'error' && (finding.confidence ?? 'high') === 'high';
}

export function detectNewBlockers(previous: ScanFinding[], current: ScanFinding[]): ScanFinding[] {
  return detectRegressions(previous, current).filter(isBlockerFinding);
}

export async function notifyIfRegressionBlockers(
  db: DbAdapter,
  repository: Repository,
  previousFindings: ScanFinding[],
  currentFindings: ScanFinding[],
): Promise<void> {
  const newBlockers = detectNewBlockers(previousFindings, currentFindings);
  if (newBlockers.length === 0) return;

  const recipients = await db.getOrganizationAdminEmails(repository.organization_id);
  if (recipients.length === 0) return;

  await sendRegressionAlert(recipients, { name: repository.name }, newBlockers);
}

export interface TargetRegressionNotifyResult {
  alerted: boolean;
  newBlockers: ScanFinding[];
}

/**
 * Low-noise regression alerts for a monitored target (Phase 6 guardian).
 * Alerts ONLY when `detectNewBlockers` is non-empty — never on the steady state
 * and never when a finding was newly fixed. Email (Resend) remains the default;
 * optional Slack/Discord webhooks run alongside when enabled in prefs.
 */
export async function notifyIfTargetRegressionBlockers(
  db: DbAdapter,
  target: Pick<Target, 'id' | 'organization_id' | 'display_name' | 'identifier'>,
  previousFindings: ScanFinding[],
  currentFindings: ScanFinding[],
): Promise<TargetRegressionNotifyResult> {
  const newBlockers = detectNewBlockers(previousFindings, currentFindings);
  if (newBlockers.length === 0) {
    return { alerted: false, newBlockers: [] };
  }

  const appName = target.display_name ?? target.identifier;
  const prefs = await db.getTargetAlertPrefs(target.id);
  const prefByChannel = new Map(prefs.map((pref) => [pref.channel, pref]));

  let delivered = false;

  if (isChannelEnabled(prefByChannel.get('email'), /* defaultOn */ true)) {
    const recipients = await db.getOrganizationAdminEmails(target.organization_id);
    if (recipients.length > 0) {
      await sendRegressionAlert(recipients, { name: appName }, newBlockers);
      delivered = true;
    }
  }

  for (const channel of ['slack', 'discord'] as const) {
    const pref = prefByChannel.get(channel);
    if (!isChannelEnabled(pref, /* defaultOn */ false)) continue;
    if (!pref?.webhook_url) continue;
    await sendWebhookRegressionAlert(pref.webhook_url, channel, { name: appName }, newBlockers);
    delivered = true;
  }

  return { alerted: delivered, newBlockers };
}

function isChannelEnabled(pref: TargetAlertPref | undefined, defaultOn: boolean): boolean {
  if (!pref) return defaultOn;
  return pref.enabled;
}
