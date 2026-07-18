import { describe, expect, it, vi } from 'vitest';
import { isAllowedIncomingWebhookUrl, sendWebhookRegressionAlert } from './notify';
import type { ScanFinding } from './dbAdapter';

describe('isAllowedIncomingWebhookUrl', () => {
  it('allows only Slack/Discord HTTPS incoming-webhook hosts', () => {
    expect(isAllowedIncomingWebhookUrl('https://hooks.slack.com/services/T/B/X', 'slack')).toBe(
      true,
    );
    expect(isAllowedIncomingWebhookUrl('https://discord.com/api/webhooks/1/token', 'discord')).toBe(
      true,
    );
    expect(isAllowedIncomingWebhookUrl('https://evil.example/hooks', 'slack')).toBe(false);
    expect(isAllowedIncomingWebhookUrl('http://hooks.slack.com/services/T/B/X', 'slack')).toBe(
      false,
    );
  });
});

describe('sendWebhookRegressionAlert', () => {
  it('posts a Slack payload for a new blocker', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true });
    const finding: ScanFinding = {
      id: 'f1',
      scan_id: 's1',
      rule_id: 'runtime-supabase-rls-open',
      severity: 'error',
      file_path: 'runtime',
      message: 'RLS open',
      created_at: '2026-07-18T00:00:00Z',
    };

    await sendWebhookRegressionAlert(
      'https://hooks.slack.com/services/T/B/X',
      'slack',
      { name: 'App' },
      [finding],
      fetchImpl as unknown as typeof fetch,
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe('https://hooks.slack.com/services/T/B/X');
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body as string) as { text: string };
    expect(body.text).toContain('App');
    expect(body.text).toContain('RLS open');
  });

  it('no-ops on an empty regressions list', async () => {
    const fetchImpl = vi.fn();
    await sendWebhookRegressionAlert(
      'https://hooks.slack.com/services/T/B/X',
      'slack',
      { name: 'App' },
      [],
      fetchImpl as unknown as typeof fetch,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
