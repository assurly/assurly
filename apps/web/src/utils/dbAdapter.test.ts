import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getAdminDbAdapter,
  getUserDbAdapter,
  SUPABASE_FETCH_TIMEOUT_MS,
  SUPABASE_MUTATION_TIMEOUT_MS,
} from './dbAdapter';

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

    it('persists Ship Gate source-of-truth columns on the scans insert', async () => {
      const fetchMock = stubSupabase();
      await getUserDbAdapter('jwt').saveScan('repo-1', 'sha', 'main', 'success', 0, 0, [], {
        shipScore: 92,
        verdict: 'review',
        scannedFileCount: 12,
        cleanFileCount: 10,
        scanScope: { scanned: 12, skipped: 3, roots: ['apps/web'] },
        failureReason: null,
      });

      const scanCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/rest/v1/scans'));
      expect(scanCall).toBeDefined();
      const body = JSON.parse((scanCall![1] as RequestInit).body as string) as Record<
        string,
        unknown
      >;
      expect(body).toMatchObject({
        ship_score: 92,
        verdict: 'review',
        scanned_file_count: 12,
        clean_file_count: 10,
        scan_scope: { scanned: 12, skipped: 3, roots: ['apps/web'] },
        failure_reason: null,
      });
    });

    it('lowercases a hex SHA and deletes older scans of the same commit', async () => {
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'publishable-key';
      const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        const href = String(url);
        const method = init?.method ?? 'GET';
        if (href.endsWith('/rest/v1/scans') && method === 'POST') {
          return new Response(
            JSON.stringify([
              {
                id: 'scan-new',
                repository_id: 'repo-1',
                commit_sha: 'c8039c4aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                created_at: '2026-08-17T12:00:00.000Z',
              },
            ]),
            { status: 201 },
          );
        }
        if (href.includes('/rest/v1/scans?select=id,created_at') && method === 'GET') {
          return new Response(
            JSON.stringify([
              { id: 'scan-old', created_at: '2026-08-17T11:00:00.000Z' },
              { id: 'scan-new', created_at: '2026-08-17T12:00:00.000Z' },
            ]),
            { status: 200 },
          );
        }
        if (href.includes('/rest/v1/scans?id=eq.scan-old') && method === 'DELETE') {
          return new Response(JSON.stringify([{ id: 'scan-old' }]), { status: 200 });
        }
        return new Response(JSON.stringify([]), { status: 200 });
      });
      vi.stubGlobal('fetch', fetchMock);

      await getUserDbAdapter('jwt').saveScan(
        'repo-1',
        'C8039C4aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        'main',
        'success',
        0,
        0,
        [],
      );

      const insertCall = fetchMock.mock.calls.find(
        ([url, init]) =>
          String(url).endsWith('/rest/v1/scans') && (init as RequestInit).method === 'POST',
      );
      expect(JSON.parse((insertCall![1] as RequestInit).body as string).commit_sha).toBe(
        'c8039c4aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      );
      const deleteCall = fetchMock.mock.calls.find(
        ([url, init]) =>
          String(url).includes('id=eq.scan-old') && (init as RequestInit).method === 'DELETE',
      );
      expect(deleteCall).toBeDefined();
    });

    it('does not prune sibling scans for an unknown placeholder SHA', async () => {
      const fetchMock = stubSupabase();
      await getUserDbAdapter('jwt').saveScan('repo-1', 'unknown', 'main', 'success', 0, 0, []);
      const siblingList = fetchMock.mock.calls.filter(([url]) =>
        String(url).includes('select=id,created_at'),
      );
      const deletes = fetchMock.mock.calls.filter(
        ([, init]) => (init as RequestInit | undefined)?.method === 'DELETE',
      );
      expect(siblingList).toHaveLength(0);
      expect(deletes).toHaveLength(0);
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

    it('deleteCanaryToken throws when the delete matched no row', async () => {
      stubDeleteResponse([]);
      await expect(getUserDbAdapter('jwt').deleteCanaryToken('canary-1')).rejects.toThrow(
        /matched no canary_tokens row/i,
      );
    });

    it('deleteCanaryToken resolves and asks for the deleted row back', async () => {
      const fetchMock = stubDeleteResponse([{ id: 'canary-1' }]);

      await expect(getUserDbAdapter('jwt').deleteCanaryToken('canary-1')).resolves.toBeUndefined();

      const init = fetchMock.mock.calls[0][1] as RequestInit;
      expect(init.method).toBe('DELETE');
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

  it('loads the organization in one memberships embed query', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'publishable-key';
    const org = { id: 'org-1', name: 'acme', billing_plan: 'pro' };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify([{ organizations: org }]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await getUserDbAdapter('jwt').getOrganizationByUserId('user-1');
    expect(result).toEqual(org);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('memberships?select=organizations(*)');
    expect(String(fetchMock.mock.calls[0][0])).not.toContain('/rest/v1/organizations?');
  });

  it('fetches latest scan summaries for many repos in one query', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'publishable-key';
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            id: 'scan-new',
            repository_id: 'repo-a',
            ship_score: 59,
            created_at: '2026-08-02T00:00:00.000Z',
          },
          {
            id: 'scan-old',
            repository_id: 'repo-a',
            ship_score: 40,
            created_at: '2026-08-01T00:00:00.000Z',
          },
          {
            id: 'scan-b',
            repository_id: 'repo-b',
            ship_score: 80,
            created_at: '2026-08-01T00:00:00.000Z',
          },
        ]),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const summaries = await getUserDbAdapter('jwt').getLatestScanSummaries(['repo-a', 'repo-b']);
    expect(summaries.get('repo-a')?.id).toBe('scan-new');
    expect(summaries.get('repo-b')?.id).toBe('scan-b');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('repository_id=in.(repo-a,repo-b)');
    expect(url).toContain('select=id,repository_id,ship_score,created_at,verdict,failure_reason');
  });

  it('limits recent scans and does not select star', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'publishable-key';
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await getUserDbAdapter('jwt').getRecentScans('repo-a');
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('limit=50');
    expect(url).not.toContain('select=*');
  });

  it('orders dismissed repositories deterministically', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'publishable-key';
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await getUserDbAdapter('jwt').getDismissedRepositories('org-a');
    const url = String(fetchMock.mock.calls[0][0]);
    // Bulk dismissals share one timestamp, so the name key is what stops the
    // Restore rows from reshuffling between loads.
    expect(url).toContain('order=dismissed_at.desc,name.asc');
  });

  /**
   * Real `fetch` never settles a hung connection until the AbortSignal fires.
   * A mock that ignores the signal would hide a missing timeout: the race
   * against `HUNG` is what fails the suite instead of hanging it.
   */
  function neverSettlingFetch(_input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    return new Promise((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) return;
      const abort = (): void => {
        const reason = signal.reason;
        reject(
          reason instanceof Error
            ? reason
            : new DOMException('The operation was aborted due to timeout.', 'TimeoutError'),
        );
      };
      if (signal.aborted) {
        abort();
        return;
      }
      signal.addEventListener('abort', abort, { once: true });
    });
  }

  it(
    'rejects a hung GET within the read budget',
    async () => {
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'publishable-key';
      vi.stubGlobal('fetch', vi.fn(neverSettlingFetch));

      const outcome = await Promise.race([
        getUserDbAdapter('jwt')
          .getRepository('repo-a')
          .then(
            () => 'resolved',
            (error: Error) => `rejected: ${error.message}`,
          ),
        new Promise<string>((resolve) =>
          setTimeout(() => resolve('HUNG'), SUPABASE_FETCH_TIMEOUT_MS + 1_000),
        ),
      ]);

      expect(outcome).toBe(
        `rejected: Supabase request timed out after ${SUPABASE_FETCH_TIMEOUT_MS}ms`,
      );
    },
    SUPABASE_FETCH_TIMEOUT_MS + 5_000,
  );

  it('gives mutations a longer timeout than reads', async () => {
    // Aborting a write risks a silent partial success, so the mutation budget
    // must never drop below the read budget when either is retuned.
    expect(SUPABASE_MUTATION_TIMEOUT_MS).toBeGreaterThanOrEqual(SUPABASE_FETCH_TIMEOUT_MS);

    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'publishable-key';
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    try {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockImplementation(
            () => new Response(JSON.stringify([{ id: 'key-1' }]), { status: 200 }),
          ),
      );

      await getUserDbAdapter('jwt').getRepository('repo-a');
      expect(timeoutSpy).toHaveBeenCalledWith(SUPABASE_FETCH_TIMEOUT_MS);

      timeoutSpy.mockClear();
      await getUserDbAdapter('jwt').deleteApiKey('key-1');
      expect(timeoutSpy).toHaveBeenCalledWith(SUPABASE_MUTATION_TIMEOUT_MS);
    } finally {
      timeoutSpy.mockRestore();
    }
  });

  it(
    'getOrganizationAdminEmails: rejects a hung Auth Admin API call within the read budget',
    async () => {
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'publishable-key';
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-secret';

      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation((url: RequestInfo | URL, init?: RequestInit) => {
          // Memberships list resolves immediately so the loop reaches the Auth Admin call
          if (String(url).includes('/rest/v1/memberships')) {
            return Promise.resolve(
              new Response(JSON.stringify([{ user_id: 'user-uuid-1' }]), { status: 200 }),
            );
          }
          // Auth Admin API hangs until the AbortSignal fires
          return neverSettlingFetch(url, init);
        }),
      );

      const outcome = await Promise.race([
        getAdminDbAdapter()
          .getOrganizationAdminEmails('org-1')
          .then(
            () => 'resolved',
            (error: Error) => `rejected: ${error.message}`,
          ),
        new Promise<string>((resolve) =>
          setTimeout(() => resolve('HUNG'), SUPABASE_FETCH_TIMEOUT_MS + 1_000),
        ),
      ]);

      expect(outcome).toBe(
        `rejected: Supabase request timed out after ${SUPABASE_FETCH_TIMEOUT_MS}ms`,
      );
    },
    SUPABASE_FETCH_TIMEOUT_MS + 5_000,
  );
});
