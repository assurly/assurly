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

  describe('saveScan', () => {
    function stubSupabase(): ReturnType<typeof vi.fn> {
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'publishable-key';
      const fetchMock = vi.fn().mockImplementation(async (url: string) => {
        if (String(url).includes('/rest/v1/scan_findings')) {
          return { ok: true, status: 201, json: async () => [] };
        }
        // The scans insert returns the created row.
        return {
          ok: true,
          status: 201,
          json: async () => [{ id: 'scan-1', repository_id: 'repo-1' }],
        };
      });
      vi.stubGlobal('fetch', fetchMock);
      return fetchMock;
    }

    function findingsPayload(fetchMock: ReturnType<typeof vi.fn>): Array<Record<string, unknown>> {
      const call = fetchMock.mock.calls.find(([url]) =>
        String(url).includes('/rest/v1/scan_findings'),
      );
      expect(call).toBeDefined();
      return JSON.parse((call![1] as RequestInit).body as string);
    }

    // Regression: a mixed-confidence finding set produced a bulk insert whose
    // objects had different key sets (JSON.stringify drops `undefined`), which
    // PostgREST rejects with PGRST102 "All object keys must match" → 500, and
    // the whole scan silently failed to persist.
    it('sends a uniform key set even when findings omit optional fields (no PGRST102)', async () => {
      const fetchMock = stubSupabase();

      await getUserDbAdapter('jwt').saveScan('repo-1', 'sha', 'main', 'failed', 1, 1, [
        // A blocker that sets every optional field.
        {
          rule_id: 'supabase-rls',
          severity: 'error',
          confidence: 'high',
          file_path: 'schema.sql',
          line_number: 3,
          message: 'RLS disabled',
          suggestion: 'Enable RLS',
        },
        // A finding that omits confidence, line_number, and suggestion entirely.
        {
          rule_id: 'github-actions-integration',
          severity: 'warning',
          file_path: 'Global Configs',
          message: 'CI workflow missing',
        },
      ]);

      const payload = findingsPayload(fetchMock);
      const keySets = payload.map((row) => Object.keys(row).sort().join(','));
      // Every row must expose exactly the same keys — the invariant PostgREST enforces.
      expect(new Set(keySets).size).toBe(1);
      // Omitted optionals are present as explicit null, never missing.
      expect(payload[1]).toMatchObject({
        scan_id: 'scan-1',
        confidence: null,
        line_number: null,
        suggestion: null,
      });
    });

    it('skips the findings insert entirely when there are no findings', async () => {
      const fetchMock = stubSupabase();
      await getUserDbAdapter('jwt').saveScan('repo-1', 'sha', 'main', 'success', 0, 0, []);
      const findingsCalls = fetchMock.mock.calls.filter(([url]) =>
        String(url).includes('/rest/v1/scan_findings'),
      );
      expect(findingsCalls).toHaveLength(0);
    });
  });
});
