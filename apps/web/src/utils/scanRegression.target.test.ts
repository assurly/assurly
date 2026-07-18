import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DbAdapter, ScanFinding } from './dbAdapter';
import { notifyIfTargetRegressionBlockers } from './scanRegression';

const sendRegressionAlert = vi.fn();
const sendWebhookRegressionAlert = vi.fn();

vi.mock('./notify', () => ({
  sendRegressionAlert: (...args: unknown[]) => sendRegressionAlert(...args),
  sendWebhookRegressionAlert: (...args: unknown[]) => sendWebhookRegressionAlert(...args),
}));

function finding(
  partial: Partial<ScanFinding> & Pick<ScanFinding, 'rule_id' | 'file_path'>,
): ScanFinding {
  return {
    id: partial.id ?? 'finding-1',
    scan_id: partial.scan_id ?? 'scan-1',
    severity: partial.severity ?? 'error',
    confidence: partial.confidence ?? 'high',
    line_number: partial.line_number ?? 1,
    message: partial.message ?? 'Issue detected',
    created_at: partial.created_at ?? '2026-01-01T00:00:00.000Z',
    ...partial,
  };
}

describe('notifyIfTargetRegressionBlockers', () => {
  const db = {
    getOrganizationAdminEmails: vi.fn(),
    getTargetAlertPrefs: vi.fn(),
  } as unknown as DbAdapter & {
    getOrganizationAdminEmails: ReturnType<typeof vi.fn>;
    getTargetAlertPrefs: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    db.getOrganizationAdminEmails.mockResolvedValue(['owner@example.com']);
    db.getTargetAlertPrefs.mockResolvedValue([]);
  });

  it('sends exactly one email alert when a new blocker appears', async () => {
    const previous = [finding({ rule_id: 'old', file_path: 'runtime' })];
    const current = [
      finding({ rule_id: 'old', file_path: 'runtime' }),
      finding({ id: 'new', rule_id: 'runtime-supabase-rls-open', file_path: 'runtime' }),
    ];

    const result = await notifyIfTargetRegressionBlockers(
      db,
      {
        id: 'target-1',
        organization_id: 'org-1',
        display_name: 'App',
        identifier: 'https://app.example',
      },
      previous,
      current,
    );

    expect(result.alerted).toBe(true);
    expect(result.newBlockers).toHaveLength(1);
    expect(sendRegressionAlert).toHaveBeenCalledTimes(1);
    expect(sendWebhookRegressionAlert).not.toHaveBeenCalled();
  });

  it('sends ZERO alerts when findings are unchanged', async () => {
    const findings = [finding({ rule_id: 'runtime-supabase-rls-open', file_path: 'runtime' })];
    const result = await notifyIfTargetRegressionBlockers(
      db,
      {
        id: 'target-1',
        organization_id: 'org-1',
        display_name: 'App',
        identifier: 'https://app.example',
      },
      findings,
      findings,
    );

    expect(result.alerted).toBe(false);
    expect(sendRegressionAlert).not.toHaveBeenCalled();
    expect(sendWebhookRegressionAlert).not.toHaveBeenCalled();
  });

  it('sends ZERO alerts when a finding was newly fixed', async () => {
    const previous = [finding({ rule_id: 'runtime-supabase-rls-open', file_path: 'runtime' })];
    const result = await notifyIfTargetRegressionBlockers(
      db,
      {
        id: 'target-1',
        organization_id: 'org-1',
        display_name: 'App',
        identifier: 'https://app.example',
      },
      previous,
      [],
    );

    expect(result.alerted).toBe(false);
    expect(sendRegressionAlert).not.toHaveBeenCalled();
  });

  it('also delivers to an enabled Slack webhook alongside email', async () => {
    db.getTargetAlertPrefs.mockResolvedValue([
      {
        id: 'p1',
        organization_id: 'org-1',
        target_id: 'target-1',
        channel: 'slack',
        webhook_url: 'https://hooks.slack.com/services/T/B/X',
        enabled: true,
        created_at: '2026-07-18T00:00:00Z',
        updated_at: '2026-07-18T00:00:00Z',
      },
    ]);

    await notifyIfTargetRegressionBlockers(
      db,
      {
        id: 'target-1',
        organization_id: 'org-1',
        display_name: 'App',
        identifier: 'https://app.example',
      },
      [],
      [finding({ rule_id: 'runtime-supabase-rls-open', file_path: 'runtime' })],
    );

    expect(sendRegressionAlert).toHaveBeenCalledTimes(1);
    expect(sendWebhookRegressionAlert).toHaveBeenCalledTimes(1);
    expect(sendWebhookRegressionAlert).toHaveBeenCalledWith(
      'https://hooks.slack.com/services/T/B/X',
      'slack',
      { name: 'App' },
      expect.any(Array),
    );
  });
});
