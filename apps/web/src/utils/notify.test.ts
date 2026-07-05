import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScanFinding } from './dbAdapter';
import { sendRegressionAlert } from './notify';

const finding: ScanFinding = {
  id: 'finding-1',
  scan_id: 'scan-1',
  rule_id: 'rls-missing',
  severity: 'error',
  file_path: 'supabase/migrations/001.sql',
  line_number: 8,
  message: 'Table created without row level security.',
  created_at: '2026-01-01T00:00:00.000Z',
};

describe('sendRegressionAlert', () => {
  beforeEach(() => {
    process.env.RESEND_API_KEY = 're_test_key';
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.RESEND_API_KEY;
  });

  it('does not call the provider when the API key is missing', async () => {
    delete process.env.RESEND_API_KEY;
    const fetchMock = vi.mocked(fetch);

    await sendRegressionAlert('admin@example.com', { name: 'owner/repo' }, [finding]);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not call the provider when there are no regressions', async () => {
    const fetchMock = vi.mocked(fetch);

    await sendRegressionAlert('admin@example.com', { name: 'owner/repo' }, []);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends one email through Resend when regressions exist', async () => {
    const fetchMock = vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 200 }));

    await sendRegressionAlert(['admin@example.com'], { name: 'owner/repo' }, [finding]);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({
      Authorization: 'Bearer re_test_key',
      'Content-Type': 'application/json',
    });
    const body = JSON.parse(String(init?.body));
    expect(body.to).toEqual(['admin@example.com']);
    expect(body.subject).toContain('owner/repo');
    expect(body.html).toContain('row level security');
  });

  it('throws when the provider returns an error response', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('failed', { status: 502 }));

    await expect(
      sendRegressionAlert('admin@example.com', { name: 'owner/repo' }, [finding]),
    ).rejects.toThrow('Regression alert email delivery failed (502).');
  });
});
