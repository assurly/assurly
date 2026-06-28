import { afterEach, describe, expect, it, vi } from 'vitest';
import { getUserDbAdapter } from './dbAdapter';

describe('user database adapter', () => {
  const originalEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
  });

  it('uses the verified user JWT and never the service-role key', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'publishable-key';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-secret';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [],
    });
    vi.stubGlobal('fetch', fetchMock);

    await getUserDbAdapter('verified-user-jwt').getRepository('repo-a');
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.headers).toMatchObject({
      apikey: 'publishable-key',
      Authorization: 'Bearer verified-user-jwt',
    });
    expect(JSON.stringify(init.headers)).not.toContain('service-role-secret');
  });
});
