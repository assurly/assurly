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
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));
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
          return new Response(JSON.stringify([]), { status: 201 });
        }
        // The scans insert returns the created row.
        return new Response(JSON.stringify([{ id: 'scan-1', repository_id: 'repo-1' }]), {
          status: 201,
        });
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

  describe('empty-body inserts (Prefer: return=minimal)', () => {
    // Regression: a `return=minimal` POST comes back 201 with NO body. The old
    // helper only skipped JSON parsing on 204, so it called response.json() on an
    // empty body and threw "Unexpected end of JSON input" — silently losing every
    // probe_evidence / fix_outcome insert (best-effort, so it never failed a scan).
    // The prior tests mocked `json: async () => []`, so they never exercised this.
    it('insertProbeEvidence does not throw on a 201 with an empty body', async () => {
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'publishable-key';
      const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 201 }));
      vi.stubGlobal('fetch', fetchMock);

      await expect(
        getUserDbAdapter('jwt').insertProbeEvidence([
          {
            organizationId: 'org-1',
            findingRuleId: 'runtime-supabase-rls-open',
            kind: 'rls_rows',
            summary: 'We read 5 rows from customers.',
          },
        ]),
      ).resolves.toBeUndefined();

      expect(fetchMock).toHaveBeenCalledOnce();
      const init = fetchMock.mock.calls[0][1] as RequestInit;
      expect(JSON.stringify(init.headers)).toContain('return=minimal');
    });
  });

  describe('deletes must prove a row actually went', () => {
    // Regression: under RLS a DELETE that matches no row is NOT an error — it
    // simply affects zero rows and returns success. With `Prefer: return=minimal`
    // the adapter discarded the body, so "deleted" and "deleted nothing" were
    // indistinguishable: with the api_keys DELETE policy missing, the route
    // answered 200 {"deleted":true} while every key survived, and the dashboard's
    // optimistic removal silently diverged from the database until a refresh
    // brought the rows back. Both delete paths must now fail loudly instead.
    function stubDeleteResponse(rows: unknown): ReturnType<typeof vi.fn> {
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'publishable-key';
      const fetchMock = vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify(rows), { status: 200 }));
      vi.stubGlobal('fetch', fetchMock);
      return fetchMock;
    }

    it('deleteApiKey throws when the delete matched no row', async () => {
      stubDeleteResponse([]);
      await expect(getUserDbAdapter('jwt').deleteApiKey('key-1')).rejects.toThrow(
        /matched no api_keys row/i,
      );
    });

    it('deleteApiKey resolves and asks for the deleted row back', async () => {
      const fetchMock = stubDeleteResponse([{ id: 'key-1' }]);

      await expect(getUserDbAdapter('jwt').deleteApiKey('key-1')).resolves.toBeUndefined();

      const init = fetchMock.mock.calls[0][1] as RequestInit;
      expect(init.method).toBe('DELETE');
      // `return=minimal` here would reintroduce the silent no-op.
      expect(JSON.stringify(init.headers)).toContain('return=representation');
    });

    it('deleteScan throws when the delete matched no row', async () => {
      stubDeleteResponse([]);
      await expect(getUserDbAdapter('jwt').deleteScan('scan-1')).rejects.toThrow(
        /matched no scans row/i,
      );
    });

    it('deleteScan resolves and asks for the deleted row back', async () => {
      const fetchMock = stubDeleteResponse([{ id: 'scan-1' }]);

      await expect(getUserDbAdapter('jwt').deleteScan('scan-1')).resolves.toBeUndefined();

      const init = fetchMock.mock.calls[0][1] as RequestInit;
      expect(init.method).toBe('DELETE');
      expect(JSON.stringify(init.headers)).toContain('return=representation');
    });
  });
});
