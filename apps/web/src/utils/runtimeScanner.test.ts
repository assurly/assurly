import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildSupabaseExposureEvidence,
  checkSecurityHeaders,
  checkSecurityHeadersWithEvidence,
  maskSecretValue,
  probeSupabaseRls,
  probeSupabaseRlsWithEvidence,
  redactCell,
  runtimeFetch,
  safeFetch,
  scanLiveUrl,
  scanLiveUrlWithEvidence,
  RUNTIME_FETCH_TIMEOUT_MS,
  RUNTIME_MAX_REDIRECTS,
  RUNTIME_MAX_RESPONSE_BYTES,
  BUNDLE_FETCH_BUDGET_MS,
  BUNDLE_MAX_SCRIPTS,
  BUNDLE_MAX_TOTAL_BYTES,
  VISIBILITY_AUDIT_BUDGET_MS,
  scanBundleForSecrets,
  scanBundleForSecretsWithEvidence,
  scanBundleForCanaryInClient,
  type LookupImpl,
} from './runtimeScanner';
import { DEFAULT_SENSITIVE_API_PATHS } from './probes';
import { SCANNER_IDENTITY_HEADER } from './scannerBlocked';
import { buildShipGateFromWebFindings } from './shipGate';

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.signature`;
}

/** A fake DNS resolver so tests never touch real network/DNS. */
function fakeLookup(address = '203.0.113.10'): LookupImpl {
  return async () => [{ address, family: 4 }];
}

const PRIVATE_LOOKUP: LookupImpl = async () => [{ address: '10.0.0.5', family: 4 }];

describe('runtimeScanner', () => {
  describe('scanBundleForSecrets', () => {
    it('returns a masked runtime-secret-in-bundle finding for Stripe live keys', () => {
      const findings = scanBundleForSecrets('const key = "sk_live_abc123def456";');
      expect(findings).toHaveLength(1);
      expect(findings[0]?.ruleId).toBe('runtime-secret-in-bundle');
      expect(findings[0]?.severity).toBe('error');
      expect(findings[0]?.message).toContain('sk_live_****');
      expect(findings[0]?.message).toContain('f456');
      expect(findings[0]?.message).not.toContain('sk_live_abc123def456');
    });

    it('detects multiple secret patterns without duplicates', () => {
      const bundle = [
        'sk_test_abc123def456',
        'AKIAIOSFODNN7EXAMPLE',
        'AIzaSyAbCdEfGhIjKlMnOpQrStUvWxYz1234567',
        makeJwt({ role: 'service_role', iss: 'supabase' }),
      ].join('\n');
      const findings = scanBundleForSecrets(bundle);
      expect(findings.length).toBeGreaterThanOrEqual(4);
      expect(new Set(findings.map((finding) => finding.message)).size).toBe(findings.length);
    });

    it('masks values using maskSecretValue', () => {
      expect(maskSecretValue('sk_live_abc123def456')).toBe('sk_live_****f456');
      expect(maskSecretValue('sk_test_abc123def456')).toBe('sk_test_****f456');
    });
  });

  describe('scanBundleForCanaryInClient', () => {
    it('warns when the tripwire is in public JS and does not treat it as a secret leak', () => {
      const bundle = `const env = { ASSURLY_CANARY_URL: "https://assurly.dev/api/canary/ask_canary_${'a'.repeat(32)}" };`;
      const findings = scanBundleForCanaryInClient(bundle);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.ruleId).toBe('assurly-canary-in-client');
      expect(findings[0]?.severity).toBe('warning');
      expect(findings[0]?.suggestion).toMatch(/Rotate real/);
      expect(
        scanBundleForSecrets(bundle).some((f) => f.ruleId === 'runtime-secret-in-bundle'),
      ).toBe(false);
    });
  });

  describe('checkSecurityHeaders', () => {
    it('returns no findings when all required headers are present', () => {
      const headers = new Headers({
        'strict-transport-security': 'max-age=31536000',
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'self'",
      });
      expect(checkSecurityHeaders(headers)).toEqual([]);
    });

    it('flags missing Strict-Transport-Security', () => {
      const headers = new Headers({
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'self'",
      });
      const findings = checkSecurityHeaders(headers);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.ruleId).toBe('runtime-missing-security-headers');
      expect(findings[0]?.message).toContain('Strict-Transport-Security');
    });

    it('flags missing X-Content-Type-Options', () => {
      const headers = new Headers({
        'strict-transport-security': 'max-age=31536000',
        'content-security-policy': "default-src 'self'",
      });
      const findings = checkSecurityHeaders(headers);
      expect(findings[0]?.message).toContain('X-Content-Type-Options');
    });

    it('flags missing Content-Security-Policy', () => {
      const headers = new Headers({
        'strict-transport-security': 'max-age=31536000',
        'x-content-type-options': 'nosniff',
      });
      const findings = checkSecurityHeaders(headers);
      expect(findings[0]?.message).toContain('Content-Security-Policy');
    });

    it('gives a Vercel-specific remediation with concrete values when the host is Vercel', () => {
      const headers = new Headers({
        server: 'Vercel',
        'strict-transport-security': 'max-age=63072000',
      });
      const suggestion = checkSecurityHeaders(headers)[0]?.suggestion ?? '';
      expect(suggestion).toContain('Detected Vercel');
      expect(suggestion).toContain('vercel.json');
      // Only the actually-missing headers, with concrete values.
      expect(suggestion).toContain('X-Content-Type-Options: nosniff');
      expect(suggestion).not.toContain('Strict-Transport-Security'); // present, not flagged
      // The CSP is disclosed as needing tuning, not handed over as a safe drop-in.
      expect(suggestion).toContain('Widen the Content-Security-Policy');
    });

    it('falls back to generic (Next.js / proxy) guidance for unknown hosts', () => {
      const headers = new Headers({ server: 'nginx' });
      const suggestion = checkSecurityHeaders(headers)[0]?.suggestion ?? '';
      expect(suggestion).not.toContain('Detected Vercel');
      expect(suggestion).toContain('next.config.js');
      expect(suggestion).toContain('X-Content-Type-Options: nosniff');
    });
  });

  describe('probeSupabaseRls', () => {
    const supabaseUrl = 'https://demo.supabase.co';
    const anonKey = makeJwt({ role: 'anon', iss: 'supabase' });

    it('yields runtime-supabase-rls-open when anon GET returns rows', async () => {
      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        expect((init?.method ?? 'GET').toUpperCase()).toBe('GET');
        if (url.includes('/rest/v1/profiles')) {
          return new Response(JSON.stringify([{ id: '1' }]), { status: 200 });
        }
        return new Response(JSON.stringify([]), { status: 200 });
      }) as typeof fetch;

      const findings = await probeSupabaseRls(supabaseUrl, anonKey, fetchMock, fakeLookup());
      const rlsFinding = findings.find((finding) => finding.ruleId === 'runtime-supabase-rls-open');
      expect(rlsFinding).toBeDefined();
      expect(rlsFinding?.severity).toBe('error');
      expect(
        findings.some((finding) => finding.ruleId === 'runtime-supabase-anon-write-implied'),
      ).toBe(true);
      const calls = (fetchMock as ReturnType<typeof vi.fn>).mock.calls as Array<
        [RequestInfo | URL, RequestInit | undefined]
      >;
      expect(calls.every(([, init]) => (init?.method ?? 'GET').toUpperCase() === 'GET')).toBe(true);
    });

    it('never issues mutating HTTP methods', async () => {
      const fetchMock = vi.fn(
        async () => new Response(JSON.stringify([]), { status: 200 }),
      ) as typeof fetch;
      await probeSupabaseRls(supabaseUrl, anonKey, fetchMock, fakeLookup());
      for (const call of vi.mocked(fetchMock).mock.calls) {
        const init = call[1];
        expect((init?.method ?? 'GET').toUpperCase()).toBe('GET');
      }
    });

    it('rejects a supabaseUrl that resolves to a private address before probing any table', async () => {
      const fetchMock = vi.fn() as typeof fetch;
      await expect(
        probeSupabaseRls(supabaseUrl, anonKey, fetchMock, PRIVATE_LOOKUP),
      ).rejects.toThrow();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects a supabaseUrl that is not http(s) or points at a blocked host, without fetching', async () => {
      const fetchMock = vi.fn() as typeof fetch;
      await expect(
        probeSupabaseRls('http://169.254.169.254', anonKey, fetchMock, fakeLookup()),
      ).rejects.toThrow();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('runtimeFetch', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    });

    it('rejects mutating HTTP methods', async () => {
      const fetchMock = vi.fn() as typeof fetch;
      await expect(
        runtimeFetch('https://example.com', { method: 'DELETE' }, fetchMock),
      ).rejects.toThrow('Mutating HTTP method');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('applies the configured timeout to fetch', async () => {
      const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        expect(init?.signal).toBeDefined();
        return Promise.resolve(new Response('<html></html>', { status: 200 }));
      }) as typeof fetch;
      await runtimeFetch('https://example.com', {}, fetchMock);
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(RUNTIME_FETCH_TIMEOUT_MS).toBe(8_000);
      expect(RUNTIME_MAX_RESPONSE_BYTES).toBe(5 * 1024 * 1024);
    });

    it('never auto-follows redirects (redirect: manual)', async () => {
      const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        expect(init?.redirect).toBe('manual');
        return Promise.resolve(new Response('', { status: 200 }));
      }) as typeof fetch;
      await runtimeFetch('https://example.com', {}, fetchMock);
    });

    // Bot protection challenges any non-browser User-Agent, which made live,
    // healthy sites look unreachable. We present as a browser and declare who we
    // are in a separate header a host can allowlist.
    it('sends a mainstream browser User-Agent plus the Assurly identity header', async () => {
      const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        const headers = init?.headers as Record<string, string>;
        expect(headers['User-Agent']).toContain('Mozilla/5.0');
        expect(headers['User-Agent']).toContain('Chrome/');
        expect(headers['User-Agent']).not.toMatch(/assurly/i);
        expect(headers[SCANNER_IDENTITY_HEADER]).toContain('assurly.dev');
        return Promise.resolve(new Response('', { status: 200 }));
      }) as typeof fetch;
      await runtimeFetch('https://example.com', {}, fetchMock);
      expect(fetchMock).toHaveBeenCalledOnce();
    });
  });

  describe('safeFetch', () => {
    it('pins the connection to the resolved, validated address via a dispatcher', async () => {
      const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect((init as { dispatcher?: unknown } | undefined)?.dispatcher).toBeDefined();
        return new Response('ok', { status: 200 });
      }) as typeof fetch;

      const { response, finalUrl } = await safeFetch(
        'https://example.com/page',
        {},
        fetchMock,
        fakeLookup(),
      );
      expect(response.status).toBe(200);
      expect(finalUrl.toString()).toBe('https://example.com/page');
      expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('follows a redirect to another safe host and re-validates + re-resolves it', async () => {
      const lookups: string[] = [];
      const lookupImpl: LookupImpl = async (hostname) => {
        lookups.push(hostname);
        return [{ address: '203.0.113.20', family: 4 }];
      };

      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        if (String(input) === 'https://example.com/start') {
          return new Response('', {
            status: 302,
            headers: { location: 'https://example.org/final' },
          });
        }
        return new Response('landed', { status: 200 });
      }) as typeof fetch;

      const { response, finalUrl } = await safeFetch(
        'https://example.com/start',
        {},
        fetchMock,
        lookupImpl,
      );

      expect(finalUrl.toString()).toBe('https://example.org/final');
      expect(await response.text()).toBe('landed');
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(lookups).toEqual(['example.com', 'example.org']);
    });

    it('with redirects: same-origin, hands back a cross-origin 3xx instead of following it', async () => {
      const requested: string[] = [];
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        requested.push(String(input));
        if (String(input) === 'https://example.com/api/auth/login') {
          return new Response('', {
            status: 307,
            headers: { location: 'https://accounts.example.org/authorize?state=abc' },
          });
        }
        return new Response('landed', { status: 200 });
      }) as typeof fetch;

      const { response, finalUrl } = await safeFetch(
        'https://example.com/api/auth/login',
        {},
        fetchMock,
        fakeLookup(),
        { redirects: 'same-origin' },
      );

      expect(requested).toEqual(['https://example.com/api/auth/login']);
      expect(response.status).toBe(307);
      expect(finalUrl.toString()).toBe('https://example.com/api/auth/login');
    });

    it('with redirects: same-origin, still follows a redirect that stays on the origin', async () => {
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        if (String(input) === 'https://example.com/api/users') {
          return new Response('', { status: 308, headers: { location: '/api/users/' } });
        }
        return new Response('landed', { status: 200 });
      }) as typeof fetch;

      const { response, finalUrl } = await safeFetch(
        'https://example.com/api/users',
        {},
        fetchMock,
        fakeLookup(),
        { redirects: 'same-origin' },
      );

      expect(response.status).toBe(200);
      expect(finalUrl.toString()).toBe('https://example.com/api/users/');
    });

    it('rejects a redirect that points at a private/internal address, without following it', async () => {
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        if (String(input) === 'https://example.com/start') {
          return new Response('', {
            status: 302,
            headers: { location: 'http://169.254.169.254/latest/meta-data/' },
          });
        }
        throw new Error('should never fetch the redirect target');
      }) as typeof fetch;

      await expect(
        safeFetch('https://example.com/start', {}, fetchMock, fakeLookup()),
      ).rejects.toThrow();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('rejects when a target DNS-resolves to a private address, even if the hostname looks public', async () => {
      const fetchMock = vi.fn() as typeof fetch;
      await expect(
        safeFetch('https://example.com/start', {}, fetchMock, PRIVATE_LOOKUP),
      ).rejects.toThrow();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('gives up after RUNTIME_MAX_REDIRECTS hops instead of looping forever', async () => {
      const fetchMock = vi.fn(
        async () =>
          new Response('', { status: 302, headers: { location: 'https://example.com/loop' } }),
      ) as typeof fetch;

      await expect(
        safeFetch('https://example.com/loop', {}, fetchMock, fakeLookup()),
      ).rejects.toThrow('Too many redirects');
      expect(fetchMock).toHaveBeenCalledTimes(RUNTIME_MAX_REDIRECTS + 1);
    });
  });

  describe('probeSupabaseRlsWithEvidence', () => {
    const supabaseUrl = 'https://demo.supabase.co';
    const anonKey = makeJwt({ role: 'anon', iss: 'supabase' });

    it('returns redacted evidence (count, columns, masked sample) for an open table', async () => {
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/rest/v1/users')) {
          return new Response(JSON.stringify([{ id: '1', email: 'alice@example.com' }]), {
            status: 200,
            headers: { 'content-range': '0-0/512' },
          });
        }
        return new Response(JSON.stringify([]), { status: 200 });
      }) as typeof fetch;

      const { evidence } = await probeSupabaseRlsWithEvidence(
        supabaseUrl,
        anonKey,
        fetchMock,
        fakeLookup(),
      );
      const rls = evidence.find((item) => item.kind === 'rls_rows');
      expect(rls).toBeDefined();
      expect(rls?.summary).toContain('512 rows');
      expect(rls?.summary).toContain('users');
      expect(rls?.redactedSample?.rowCount).toBe(512);
      expect(rls?.redactedSample?.columns).toEqual(['id', 'email']);
      // Sample cell is masked — never the raw email.
      expect(rls?.redactedSample?.sampleCell).not.toContain('alice@example.com');
      expect(JSON.stringify(rls)).not.toContain('alice@example.com');
    });

    it('requests an exact count without a mutating method', async () => {
      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        expect((init?.method ?? 'GET').toUpperCase()).toBe('GET');
        const url = String(input);
        if (url.includes('/rest/v1/orders')) {
          return new Response(JSON.stringify([{ id: '9' }]), { status: 200 });
        }
        return new Response(JSON.stringify([]), { status: 200 });
      }) as typeof fetch;
      await probeSupabaseRlsWithEvidence(supabaseUrl, anonKey, fetchMock, fakeLookup());
    });
  });

  describe('redactCell', () => {
    it('masks an email keeping its shape', () => {
      expect(redactCell('alice@example.com')).toBe('a***@***.com');
    });
    it('masks a generic string to a first-character stub', () => {
      expect(redactCell('SensitiveValue')).toBe('S***');
    });
    it('masks numbers and booleans', () => {
      expect(redactCell(42)).toBe('***');
      expect(redactCell(true)).toBe('***');
    });
  });

  describe('scanBundleForSecretsWithEvidence', () => {
    it('emits redacted exposed-secret evidence', () => {
      const { evidence } = scanBundleForSecretsWithEvidence('const k = "sk_live_abc123def456";');
      expect(evidence).toHaveLength(1);
      expect(evidence[0]?.kind).toBe('exposed_secret');
      expect(evidence[0]?.redactedSample?.maskedSecret).toBe('sk_live_****f456');
      expect(JSON.stringify(evidence[0])).not.toContain('sk_live_abc123def456');
    });
  });

  describe('checkSecurityHeadersWithEvidence', () => {
    it('emits missing-header evidence listing the missing headers', () => {
      const { evidence } = checkSecurityHeadersWithEvidence(new Headers({ server: 'nginx' }));
      expect(evidence[0]?.kind).toBe('missing_header');
      expect(evidence[0]?.redactedSample?.headers?.length).toBeGreaterThan(0);
    });
  });

  describe('scanLiveUrl', () => {
    const plantedHtml = `
      <html><body>
        <script>window.__ENV = { NEXT_PUBLIC_SUPABASE_URL: "http://169.254.169.254", NEXT_PUBLIC_SUPABASE_ANON_KEY: "${makeJwt(
          { role: 'anon' },
        )}" };</script>
      </body></html>`;

    it('rejects a planted private Supabase URL when the active probe runs (SSRF guard)', async () => {
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        if (String(input) === 'https://myapp.example/') {
          return new Response(plantedHtml, {
            status: 200,
            headers: { 'content-type': 'text/html' },
          });
        }
        throw new Error(`unexpected fetch to ${String(input)}`);
      }) as typeof fetch;

      await expect(
        scanLiveUrl('https://myapp.example/', fetchMock, fakeLookup(), { activeProbe: true }),
      ).rejects.toThrow();
    });

    it('does NOT run the active Supabase probe by default (passive only)', async () => {
      const supabaseRequests: string[] = [];
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('supabase.co') || url.includes('169.254.169.254')) {
          supabaseRequests.push(url);
        }
        if (url === 'https://myapp.example/') {
          const html = `<html><body><script>window.__ENV = { NEXT_PUBLIC_SUPABASE_URL: "https://demo.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "${makeJwt(
            { role: 'anon' },
          )}" };</script></body></html>`;
          return new Response(html, { status: 200, headers: { 'content-type': 'text/html' } });
        }
        return new Response('', { status: 200 });
      }) as typeof fetch;

      const { findings } = await scanLiveUrlWithEvidence(
        'https://myapp.example/',
        fetchMock,
        fakeLookup(),
      );
      expect(supabaseRequests).toEqual([]);
      expect(findings.some((f) => f.ruleId === 'runtime-supabase-rls-open')).toBe(false);
      // But a passive scan still surfaces the honest "your DB key is public — verify
      // to test the lock" hook, without ever touching the database.
      expect(findings.some((f) => f.ruleId === 'runtime-supabase-key-exposed')).toBe(true);
    });

    it('flags a canary in the live bundle without fetching the callback', async () => {
      const canaryUrl = `https://assurly.dev/api/canary/ask_canary_${'a'.repeat(32)}`;
      const fetched: string[] = [];
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        fetched.push(url);
        if (url === 'https://myapp.example/') {
          const html = `<html><body><script src="${canaryUrl}"></script><script>window.CANARY="${canaryUrl}"</script></body></html>`;
          return new Response(html, { status: 200, headers: { 'content-type': 'text/html' } });
        }
        throw new Error(`unexpected fetch to ${url}`);
      }) as typeof fetch;

      const { findings } = await scanLiveUrlWithEvidence(
        'https://myapp.example/',
        fetchMock,
        fakeLookup(),
      );
      expect(fetched).toEqual(['https://myapp.example/']);
      expect(findings.some((f) => f.ruleId === 'assurly-canary-in-client')).toBe(true);
      expect(findings.find((f) => f.ruleId === 'assurly-canary-in-client')?.severity).toBe(
        'warning',
      );
    });

    it('suppresses the passive exposure hook when the active probe runs', async () => {
      vi.stubEnv('ANTHROPIC_API_KEY', ''); // planner falls back to the deterministic plan
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === 'https://myapp.example/') {
          const html = `<html><body><script>window.__ENV = { NEXT_PUBLIC_SUPABASE_URL: "https://demo.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "${makeJwt(
            { role: 'anon' },
          )}" };</script></body></html>`;
          return new Response(html, { status: 200, headers: { 'content-type': 'text/html' } });
        }
        // Every RLS probe returns no rows → no open-table finding.
        return new Response('[]', { status: 200, headers: { 'content-range': '0-0/0' } });
      }) as typeof fetch;

      const { findings } = await scanLiveUrlWithEvidence(
        'https://myapp.example/',
        fetchMock,
        fakeLookup(),
        { activeProbe: true },
      );
      // The real probe ran (and found nothing), so the preview hook is redundant.
      expect(findings.some((f) => f.ruleId === 'runtime-supabase-key-exposed')).toBe(false);
    });

    describe('unauthenticated endpoint probe', () => {
      const noSupabaseHtml = '<html><body><script>fetch("/api/ledger")</script></body></html>';

      /** Records every request the scanner makes so we can assert the probe scope. */
      function endpointFetchMock(apiRecorded: string[]) {
        return vi.fn(async (input: RequestInfo | URL) => {
          const url = String(input);
          if (url === 'https://myapp.example/') {
            return new Response(noSupabaseHtml, {
              status: 200,
              headers: { 'content-type': 'text/html' },
            });
          }
          if (url.includes('/api/')) {
            apiRecorded.push(url);
            return new Response(JSON.stringify([{ id: 1 }, { id: 2 }]), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            });
          }
          return new Response('', { status: 404 });
        }) as typeof fetch;
      }

      it('runs the endpoint plan with activeProbe and no Supabase config at all', async () => {
        vi.stubEnv('ANTHROPIC_API_KEY', '');
        const apiRecorded: string[] = [];

        const { findings, evidence } = await scanLiveUrlWithEvidence(
          'https://myapp.example/',
          endpointFetchMock(apiRecorded),
          fakeLookup(),
          { activeProbe: true },
        );

        expect(apiRecorded.length).toBeGreaterThan(0);
        // Discovered path leads, curated defaults follow — same origin only.
        expect(apiRecorded[0]).toBe('https://myapp.example/api/ledger');
        expect(apiRecorded.every((url) => url.startsWith('https://myapp.example/api/'))).toBe(true);
        expect(findings.some((f) => f.ruleId === 'runtime-api-endpoint-open')).toBe(true);
        expect(evidence.some((e) => e.kind === 'open_endpoint')).toBe(true);
      });

      it('never probes an endpoint without activeProbe', async () => {
        const apiRecorded: string[] = [];

        const { findings } = await scanLiveUrlWithEvidence(
          'https://myapp.example/',
          endpointFetchMock(apiRecorded),
          fakeLookup(),
        );

        expect(apiRecorded).toEqual([]);
        expect(findings.some((f) => f.ruleId === 'runtime-api-endpoint-open')).toBe(false);
      });

      it('never probes an endpoint without activeProbe even when the planner is wired', async () => {
        vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
        const apiRecorded: string[] = [];
        const claudeFetch = vi.fn(
          async () =>
            new Response(
              JSON.stringify({
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify([
                      {
                        primitive: 'app_endpoint_unauthenticated_read',
                        params: { path: '/api/invoices' },
                      },
                    ]),
                  },
                ],
              }),
              { status: 200 },
            ),
        ) as unknown as typeof fetch;

        const { findings } = await scanLiveUrlWithEvidence(
          'https://myapp.example/',
          endpointFetchMock(apiRecorded),
          fakeLookup(),
          { useAiPlanner: true, aiDeps: { fetchImpl: claudeFetch } },
        );

        expect(apiRecorded).toEqual([]);
        expect(claudeFetch).not.toHaveBeenCalled();
        expect(findings.some((f) => f.ruleId === 'runtime-api-endpoint-open')).toBe(false);
      });

      it('probes an AI-planned path first on a non-Supabase page, then discovered and default paths', async () => {
        vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
        const apiRecorded: string[] = [];
        const claudeFetch = vi.fn(
          async () =>
            new Response(
              JSON.stringify({
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify([
                      {
                        primitive: 'app_endpoint_unauthenticated_read',
                        params: { path: '/api/invoices' },
                      },
                    ]),
                  },
                ],
              }),
              { status: 200 },
            ),
        ) as unknown as typeof fetch;

        const { planSource } = await scanLiveUrlWithEvidence(
          'https://myapp.example/',
          endpointFetchMock(apiRecorded),
          fakeLookup(),
          { activeProbe: true, aiDeps: { fetchImpl: claudeFetch } },
        );

        expect(claudeFetch).toHaveBeenCalled();
        expect(planSource).toBe('ai');
        expect(apiRecorded[0]).toBe('https://myapp.example/api/invoices');
        expect(apiRecorded).toContain('https://myapp.example/api/ledger');
        for (const path of DEFAULT_SENSITIVE_API_PATHS) {
          expect(apiRecorded).toContain(`https://myapp.example${path}`);
        }
      });

      it('with AI off, a non-Supabase page keeps the deterministic request list', async () => {
        vi.stubEnv('ANTHROPIC_API_KEY', '');
        const apiRecorded: string[] = [];

        const { planSource } = await scanLiveUrlWithEvidence(
          'https://myapp.example/',
          endpointFetchMock(apiRecorded),
          fakeLookup(),
          { activeProbe: true, useAiPlanner: false },
        );

        expect(planSource).toBe('deterministic');
        expect(apiRecorded).toEqual([
          'https://myapp.example/api/ledger',
          ...DEFAULT_SENSITIVE_API_PATHS.map((path) => `https://myapp.example${path}`),
        ]);
      });

      // Both plans share one time budget. The Supabase probe is the older,
      // higher-signal one (a live data breach, not a warning), so a slow set of
      // /api routes must not starve it — it keeps the head of the queue it had
      // before endpoint probing existed.
      it('runs the Supabase plan ahead of the endpoint plan when both apply', async () => {
        vi.stubEnv('ANTHROPIC_API_KEY', '');
        const probeOrder: string[] = [];
        const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
          const url = String(input);
          if (url === 'https://myapp.example/') {
            const html = `<html><body><script>window.__ENV = { NEXT_PUBLIC_SUPABASE_URL: "https://demo.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "${makeJwt(
              { role: 'anon' },
            )}" }; fetch("/api/ledger")</script></body></html>`;
            return new Response(html, { status: 200, headers: { 'content-type': 'text/html' } });
          }
          if (url.includes('supabase.co')) {
            probeOrder.push('supabase');
            return new Response(JSON.stringify([{ id: 1 }]), {
              status: 200,
              headers: { 'content-type': 'application/json', 'content-range': '0-0/1' },
            });
          }
          if (url.includes('/api/')) {
            probeOrder.push('endpoint');
            return new Response(JSON.stringify([{ id: 1 }]), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            });
          }
          return new Response('', { status: 404 });
        }) as typeof fetch;

        const { findings } = await scanLiveUrlWithEvidence(
          'https://myapp.example/',
          fetchMock,
          fakeLookup(),
          { activeProbe: true },
        );

        expect(findings.some((f) => f.ruleId === 'runtime-supabase-rls-open')).toBe(true);
        expect(findings.some((f) => f.ruleId === 'runtime-api-endpoint-open')).toBe(true);
        const firstEndpoint = probeOrder.indexOf('endpoint');
        const lastSupabase = probeOrder.lastIndexOf('supabase');
        expect(firstEndpoint).toBeGreaterThan(-1);
        expect(lastSupabase).toBeLessThan(firstEndpoint);
      });
    });

    it('emits a high-confidence blocker when the live target returns 404', async () => {
      const fetchMock = vi.fn(async () => {
        return new Response('DEPLOYMENT_NOT_FOUND', {
          status: 404,
          headers: { 'content-type': 'text/html' },
        });
      }) as typeof fetch;

      const { findings } = await scanLiveUrlWithEvidence(
        'https://dead.example/',
        fetchMock,
        fakeLookup(),
      );
      expect(findings.some((f) => f.ruleId === 'runtime-target-unreachable')).toBe(true);
      const report = buildShipGateFromWebFindings(findings, {
        scannedFileCount: 1,
        cleanFileCount: 0,
      });
      expect(report.status).toBe('blocked');
      expect(report.headline).toBe('NOT READY TO SHIP');
      expect(report.shipScore).toBeLessThan(100);
    });

    // A WAF, deployment protection or a rate limit means the target refused US.
    // Calling that a dead deploy blocked apps for being well protected.
    describe('when the target refuses the scanner', () => {
      function refusingFetch(status: number, headers: Record<string, string> = {}) {
        return vi.fn(
          async () => new Response('<html>Access denied</html>', { status, headers }),
        ) as typeof fetch;
      }

      it('reports an honest unknown instead of a blocker, with no findings', async () => {
        const result = await scanLiveUrlWithEvidence(
          'https://protected.example/',
          refusingFetch(403, { server: 'cloudflare', 'cf-mitigated': 'challenge' }),
          fakeLookup(),
        );

        expect(result.blocked).toEqual({ status: 403, source: 'cloudflare' });
        expect(result.findings).toHaveLength(0);
        expect(result.evidence).toHaveLength(0);
      });

      it('attributes Vercel deployment protection so the fix is actionable', async () => {
        const result = await scanLiveUrlWithEvidence(
          'https://preview.example/',
          refusingFetch(401, { server: 'Vercel' }),
          fakeLookup(),
        );
        expect(result.blocked).toEqual({ status: 401, source: 'vercel' });
      });

      it('attributes a rate limit ahead of the host that issued it', async () => {
        const result = await scanLiveUrlWithEvidence(
          'https://busy.example/',
          refusingFetch(429, { server: 'cloudflare' }),
          fakeLookup(),
        );
        expect(result.blocked).toEqual({ status: 429, source: 'rate-limit' });
      });

      it('falls back to an unattributed refusal when nothing identifies the blocker', async () => {
        const result = await scanLiveUrlWithEvidence(
          'https://walled.example/',
          refusingFetch(403),
          fakeLookup(),
        );
        expect(result.blocked).toEqual({ status: 403, source: 'unknown' });
      });

      it('still treats a genuinely dead deploy as a blocker, not a refusal', async () => {
        for (const status of [404, 410, 500, 503]) {
          const result = await scanLiveUrlWithEvidence(
            'https://dead.example/',
            refusingFetch(status),
            fakeLookup(),
          );
          expect(result.blocked).toBeUndefined();
          expect(result.findings.map((finding) => finding.ruleId)).toContain(
            'runtime-target-unreachable',
          );
        }
      });
    });
  });

  describe('bundle fetch phase', () => {
    const ORIGIN = 'https://myapp.example';

    /** A page whose N `<script src>` tags each resolve to `/chunk-<i>.js`. */
    function pageWithScripts(count: number): string {
      const tags = Array.from(
        { length: count },
        (_, i) => `<script src="/chunk-${i}.js"></script>`,
      ).join('');
      return `<html><head>${tags}</head><body></body></html>`;
    }

    /**
     * Serves the page and each chunk. `chunkBody(i)` is the chunk's text;
     * `chunkResponse(i)` may override the whole Response for one index.
     */
    function bundleFetchMock(
      html: string,
      chunkBody: (index: number) => string,
      chunkResponse?: (index: number) => Response | Promise<Response> | undefined,
    ): { fetchMock: typeof fetch; fetched: number[] } {
      const fetched: number[] = [];
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === `${ORIGIN}/` || url === ORIGIN) {
          return new Response(html, { status: 200, headers: { 'content-type': 'text/html' } });
        }
        const chunk = url.match(/\/chunk-(\d+)\.js$/);
        if (chunk) {
          const index = Number(chunk[1]);
          fetched.push(index);
          const override = await chunkResponse?.(index);
          if (override) return override;
          return new Response(chunkBody(index), {
            status: 200,
            headers: { 'content-type': 'application/javascript' },
          });
        }
        return new Response('', { status: 404 });
      }) as typeof fetch;
      return { fetchMock, fetched };
    }

    it('reads every script the page loads, not only the first eight', async () => {
      // Turbopack/Next.js emit framework chunks first and the app's own code
      // last — on assurly.dev the `/api/…` literals sit in chunks #9–#11, so a
      // cap of 8 read nothing but polyfills.
      const html = pageWithScripts(12);
      const { fetchMock, fetched } = bundleFetchMock(html, (i) =>
        i === 9 ? 'const key = "sk_live_abc123def456";' : `// chunk ${i}`,
      );

      const result = await scanLiveUrlWithEvidence(`${ORIGIN}/`, fetchMock, fakeLookup());

      expect(fetched).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
      expect(result.findings.some((f) => f.ruleId === 'runtime-secret-in-bundle')).toBe(true);
      expect(result.pageText).toContain('// chunk 11');
      expect(result.bundleCoverage).toEqual({ scripts: 12, fetched: 12, failed: 0 });
    });

    it('accumulates chunk text in page order so config extraction stays deterministic', async () => {
      const html = pageWithScripts(3);
      const { fetchMock } = bundleFetchMock(html, (i) => `MARK_${i}`);

      const { pageText } = await scanLiveUrlWithEvidence(`${ORIGIN}/`, fetchMock, fakeLookup());

      expect(pageText.indexOf('MARK_0')).toBeLessThan(pageText.indexOf('MARK_1'));
      expect(pageText.indexOf('MARK_1')).toBeLessThan(pageText.indexOf('MARK_2'));
    });

    it('stops at BUNDLE_MAX_SCRIPTS and reports the truncation', async () => {
      const html = pageWithScripts(BUNDLE_MAX_SCRIPTS + 6);
      const { fetchMock, fetched } = bundleFetchMock(html, (i) => `// chunk ${i}`);

      const result = await scanLiveUrlWithEvidence(`${ORIGIN}/`, fetchMock, fakeLookup());

      expect(fetched).toHaveLength(BUNDLE_MAX_SCRIPTS);
      expect(result.bundleCoverage).toEqual({
        scripts: BUNDLE_MAX_SCRIPTS + 6,
        fetched: BUNDLE_MAX_SCRIPTS,
        failed: 0,
        truncatedBy: 'count',
      });
    });

    it('stops reading once the total byte budget is spent', async () => {
      const chunkBytes = 1024 * 1024;
      const chunksThatFit = Math.floor(BUNDLE_MAX_TOTAL_BYTES / chunkBytes);
      const html = pageWithScripts(chunksThatFit + 3);
      const { fetchMock, fetched } = bundleFetchMock(html, () => 'a'.repeat(chunkBytes));

      const result = await scanLiveUrlWithEvidence(`${ORIGIN}/`, fetchMock, fakeLookup());

      expect(fetched).toHaveLength(chunksThatFit);
      expect(result.bundleCoverage).toEqual({
        scripts: chunksThatFit + 3,
        fetched: chunksThatFit,
        failed: 0,
        truncatedBy: 'bytes',
      });
    });

    it('stops fetching once the wall-clock budget is spent', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        const html = pageWithScripts(6);
        const { fetchMock, fetched } = bundleFetchMock(
          html,
          (i) => `// chunk ${i}`,
          () => {
            // Each chunk "takes" more than half the budget: two fit, the rest do not.
            vi.setSystemTime(Date.now() + BUNDLE_FETCH_BUDGET_MS / 2 + 1);
            return undefined;
          },
        );

        const result = await scanLiveUrlWithEvidence(`${ORIGIN}/`, fetchMock, fakeLookup());

        expect(fetched).toEqual([0, 1]);
        expect(result.bundleCoverage).toEqual({
          scripts: 6,
          fetched: 2,
          failed: 0,
          truncatedBy: 'time',
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it('a script that fails to load is skipped and the scan still completes', async () => {
      const html = pageWithScripts(3);
      const { fetchMock, fetched } = bundleFetchMock(
        html,
        (i) => (i === 2 ? 'const key = "sk_live_abc123def456";' : `// chunk ${i}`),
        (i) => {
          if (i === 1) throw new Error('The operation was aborted due to timeout');
          return undefined;
        },
      );

      const result = await scanLiveUrlWithEvidence(`${ORIGIN}/`, fetchMock, fakeLookup());

      expect(fetched).toEqual([0, 1, 2]);
      expect(result.findings.some((f) => f.ruleId === 'runtime-secret-in-bundle')).toBe(true);
      expect(result.bundleCoverage).toEqual({ scripts: 3, fetched: 2, failed: 1 });
    });

    it('an oversized script is skipped without losing the ones after it', async () => {
      const html = pageWithScripts(2);
      const { fetchMock } = bundleFetchMock(
        html,
        (i) => (i === 1 ? 'const key = "sk_live_abc123def456";' : ''),
        (i) =>
          i === 0
            ? new Response('x', {
                status: 200,
                headers: { 'content-length': String(RUNTIME_MAX_RESPONSE_BYTES + 1) },
              })
            : undefined,
      );

      const result = await scanLiveUrlWithEvidence(`${ORIGIN}/`, fetchMock, fakeLookup());

      expect(result.findings.some((f) => f.ruleId === 'runtime-secret-in-bundle')).toBe(true);
      expect(result.bundleCoverage).toEqual({ scripts: 2, fetched: 1, failed: 1 });
    });

    it('reads modulepreload hrefs, including reversed attributes, token rel, and single quotes', async () => {
      const html = `<html><head>
        <link rel="modulepreload" href="/chunk-0.js">
        <link href="/chunk-1.js" rel="modulepreload">
        <link rel="preload modulepreload" href="/chunk-2.js">
        <link rel='modulepreload' href='/chunk-3.js'>
      </head><body></body></html>`;
      const { fetchMock, fetched } = bundleFetchMock(html, (i) => `// chunk ${i}`);

      const result = await scanLiveUrlWithEvidence(`${ORIGIN}/`, fetchMock, fakeLookup());

      expect(fetched).toEqual([0, 1, 2, 3]);
      expect(result.bundleCoverage).toEqual({ scripts: 4, fetched: 4, failed: 0 });
    });

    it('preserves page order across script and modulepreload tags', async () => {
      const html = `<html><head>
        <script src="/chunk-0.js"></script>
        <link rel="modulepreload" href="/chunk-1.js">
        <script src="/chunk-2.js"></script>
      </head><body></body></html>`;
      const { fetchMock, fetched } = bundleFetchMock(html, (i) => `MARK_${i}`);

      const { pageText } = await scanLiveUrlWithEvidence(`${ORIGIN}/`, fetchMock, fakeLookup());

      expect(fetched).toEqual([0, 1, 2]);
      expect(pageText.indexOf('MARK_0')).toBeLessThan(pageText.indexOf('MARK_1'));
      expect(pageText.indexOf('MARK_1')).toBeLessThan(pageText.indexOf('MARK_2'));
    });

    it('skips data: and canary modulepreload hrefs', async () => {
      const canaryUrl = `https://assurly.dev/api/canary/ask_canary_${'a'.repeat(32)}`;
      const html = `<html><head>
        <link rel="modulepreload" href="data:text/javascript,foo">
        <link rel="modulepreload" href="${canaryUrl}">
        <link rel="modulepreload" href="/chunk-0.js">
      </head><body></body></html>`;
      const { fetchMock, fetched } = bundleFetchMock(html, () => '// ok');

      await scanLiveUrlWithEvidence(`${ORIGIN}/`, fetchMock, fakeLookup());

      const requested = (fetchMock as ReturnType<typeof vi.fn>).mock.calls.map((call) =>
        String(call[0]),
      );
      expect(requested.some((url) => url.startsWith('data:'))).toBe(false);
      expect(requested.some((url) => url.includes('/api/canary/'))).toBe(false);
      expect(fetched).toEqual([0]);
    });

    it('reads twelve modulepreloads with no script tags and reports them as scripts', async () => {
      const tags = Array.from(
        { length: 12 },
        (_, i) => `<link rel="modulepreload" href="/chunk-${i}.js">`,
      ).join('');
      const html = `<html><head>${tags}</head><body></body></html>`;
      const { fetchMock, fetched } = bundleFetchMock(html, (i) => `// chunk ${i}`);

      const result = await scanLiveUrlWithEvidence(`${ORIGIN}/`, fetchMock, fakeLookup());

      expect(fetched).toHaveLength(12);
      expect(result.bundleCoverage).toEqual({ scripts: 12, fetched: 12, failed: 0 });
    });

    it('applies the count cap to the combined script and modulepreload list', async () => {
      const scripts = Array.from(
        { length: 10 },
        (_, i) => `<script src="/chunk-${i}.js"></script>`,
      ).join('');
      const preloads = Array.from(
        { length: BUNDLE_MAX_SCRIPTS },
        (_, i) => `<link rel="modulepreload" href="/chunk-${10 + i}.js">`,
      ).join('');
      const html = `<html><head>${scripts}${preloads}</head><body></body></html>`;
      const { fetchMock, fetched } = bundleFetchMock(html, (i) => `// chunk ${i}`);

      const result = await scanLiveUrlWithEvidence(`${ORIGIN}/`, fetchMock, fakeLookup());

      expect(fetched).toHaveLength(BUNDLE_MAX_SCRIPTS);
      expect(result.bundleCoverage).toEqual({
        scripts: 10 + BUNDLE_MAX_SCRIPTS,
        fetched: BUNDLE_MAX_SCRIPTS,
        failed: 0,
        truncatedBy: 'count',
      });
    });

    it('a script on a private host is never fetched and does not fail the scan', async () => {
      const html =
        '<html><head><script src="http://169.254.169.254/latest/meta-data.js"></script>' +
        '<script src="/chunk-0.js"></script></head><body></body></html>';
      const { fetchMock, fetched } = bundleFetchMock(
        html,
        () => 'const key = "sk_live_abc123def456";',
      );

      const result = await scanLiveUrlWithEvidence(`${ORIGIN}/`, fetchMock, fakeLookup());

      const requested = (fetchMock as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
      expect(requested.some((u) => u.includes('169.254.169.254'))).toBe(false);
      expect(fetched).toEqual([0]);
      expect(result.findings.some((f) => f.ruleId === 'runtime-secret-in-bundle')).toBe(true);
      expect(result.bundleCoverage).toEqual({ scripts: 2, fetched: 1, failed: 1 });
    });
  });

  describe('buildSupabaseExposureEvidence', () => {
    it('is a warning (never a blocker) that drives ownership verification', () => {
      const { findings, evidence } = buildSupabaseExposureEvidence(
        'https://demo.supabase.co',
        makeJwt({ role: 'anon' }),
      );
      expect(findings).toHaveLength(1);
      expect(findings[0]?.ruleId).toBe('runtime-supabase-key-exposed');
      // Honest severity: a correctly-configured app (RLS on) shipping the anon key
      // is safe, so this must NOT cry wolf as an error/blocker.
      expect(findings[0]?.severity).toBe('warning');
      expect(findings[0]?.message.toLowerCase()).toContain('verify');
      expect(evidence[0]?.kind).toBe('open_endpoint');
      expect(evidence[0]?.summary).toContain('demo.supabase.co');
    });

    it('masks the anon key in the evidence sample', () => {
      const key = makeJwt({ role: 'anon' });
      const { evidence } = buildSupabaseExposureEvidence('https://demo.supabase.co', key);
      const masked = evidence[0]?.redactedSample?.maskedSecret ?? '';
      expect(masked).not.toBe(key);
      expect(masked).toContain('…');
    });
  });

  describe('visibilityAudit wiring', () => {
    const SECURE_HEADERS = {
      'content-type': 'text/html',
      'strict-transport-security': 'max-age=63072000',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'self'",
    };

    /** Empty SPA shell — every SEO/GEO HTML check fails. */
    const INVISIBLE_HTML = '<html><head></head><body><div id="root"></div></body></html>';

    function pageFetchMock(overrides?: {
      robotsStatus?: number;
      delayMs?: number;
      throwOn?: string;
    }): typeof fetch {
      return vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (overrides?.throwOn && url.includes(overrides.throwOn)) {
          throw new Error('simulated network failure');
        }
        if (overrides?.delayMs && overrides.delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, overrides.delayMs));
        }
        if (url === 'https://myapp.example/' || url === 'https://myapp.example') {
          return new Response(INVISIBLE_HTML, { status: 200, headers: SECURE_HEADERS });
        }
        if (url.endsWith('/robots.txt')) {
          return new Response('User-agent: *\nDisallow:', {
            status: overrides?.robotsStatus ?? 200,
            headers: { 'content-type': 'text/plain' },
          });
        }
        if (url.endsWith('/llms.txt') || url.endsWith('/sitemap.xml')) {
          return new Response('not found', { status: 404 });
        }
        // HEAD / GET fallback
        return new Response('', { status: 404 });
      }) as typeof fetch;
    }

    it('CRITICAL: visibility failures never change Ship Gate score or status', async () => {
      const fetchMock = pageFetchMock();

      const without = await scanLiveUrlWithEvidence(
        'https://myapp.example/',
        fetchMock,
        fakeLookup(),
        { visibilityAudit: false },
      );
      const withAudit = await scanLiveUrlWithEvidence(
        'https://myapp.example/',
        fetchMock,
        fakeLookup(),
        { visibilityAudit: true },
      );

      expect(withAudit.visibility).toBeDefined();
      expect(withAudit.visibility!.checks.some((c) => c.status === 'fail')).toBe(true);

      const reportOff = buildShipGateFromWebFindings(without.findings, {
        scannedFileCount: 1,
        cleanFileCount: without.findings.length === 0 ? 1 : 0,
      });
      const reportOn = buildShipGateFromWebFindings(withAudit.findings, {
        scannedFileCount: 1,
        cleanFileCount: withAudit.findings.length === 0 ? 1 : 0,
      });

      expect(reportOn.shipScore).toBe(reportOff.shipScore);
      expect(reportOn.status).toBe(reportOff.status);
      expect(withAudit.findings).toEqual(without.findings);
      // Visibility must never leak into findings.
      expect(
        withAudit.findings.some((f) => f.ruleId.includes('seo') || f.ruleId.includes('visibility')),
      ).toBe(false);
    });

    it('option off → no supplementary requests and visibility undefined', async () => {
      const requested: string[] = [];
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        requested.push(url);
        if (url.startsWith('https://myapp.example')) {
          return new Response(INVISIBLE_HTML, { status: 200, headers: SECURE_HEADERS });
        }
        return new Response('', { status: 404 });
      }) as typeof fetch;

      const result = await scanLiveUrlWithEvidence(
        'https://myapp.example/',
        fetchMock,
        fakeLookup(),
        { visibilityAudit: false },
      );

      expect(result.visibility).toBeUndefined();
      expect(requested.some((u) => u.includes('/robots.txt'))).toBe(false);
      expect(requested.some((u) => u.includes('/llms.txt'))).toBe(false);
      expect(requested.some((u) => u.includes('/sitemap.xml'))).toBe(false);
    });

    it('404 on robots.txt → input is null (check is not skipped)', async () => {
      const fetchMock = pageFetchMock({ robotsStatus: 404 });
      const result = await scanLiveUrlWithEvidence(
        'https://myapp.example/',
        fetchMock,
        fakeLookup(),
        { visibilityAudit: true },
      );

      expect(result.visibility).toBeDefined();
      const crawler = result.visibility!.checks.find((c) => c.id === 'ai-crawler-access');
      expect(crawler?.status).not.toBe('skipped');
      // Absent robots.txt → Phase 1 treats crawlers as allowed (pass).
      expect(crawler?.status).toBe('pass');
    });

    it('fetch exceeding the budget → remaining inputs undefined / checks skipped', async () => {
      expect(VISIBILITY_AUDIT_BUDGET_MS).toBe(4_000);

      let robotsCalls = 0;
      const requested: string[] = [];
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        requested.push(url);
        if (url === 'https://myapp.example/' || url === 'https://myapp.example') {
          return new Response(INVISIBLE_HTML, { status: 200, headers: SECURE_HEADERS });
        }
        if (url.endsWith('/robots.txt')) {
          robotsCalls += 1;
          // Burn the whole visibility budget on the first supplementary fetch.
          await new Promise((resolve) => setTimeout(resolve, VISIBILITY_AUDIT_BUDGET_MS + 50));
          return new Response('User-agent: *\nDisallow:', {
            status: 200,
            headers: { 'content-type': 'text/plain' },
          });
        }
        // Must not be reached once the budget is exhausted.
        return new Response('should-not-fetch', { status: 200 });
      }) as typeof fetch;

      const result = await scanLiveUrlWithEvidence(
        'https://myapp.example/',
        fetchMock,
        fakeLookup(),
        { visibilityAudit: true },
      );

      expect(robotsCalls).toBe(1);
      expect(result.visibility).toBeDefined();
      const llms = result.visibility!.checks.find((c) => c.id === 'ai-llms-txt');
      expect(llms?.status).toBe('skipped');
      // sitemap is fetched after llms — also skipped when budget is spent.
      expect(requested.some((u) => u.includes('/llms.txt'))).toBe(false);
      expect(requested.some((u) => u.includes('/sitemap.xml'))).toBe(false);
    }, 15_000);

    it('throwing fetch → no exception escapes; scan still returns', async () => {
      const fetchMock = pageFetchMock({ throwOn: '/robots.txt' });

      await expect(
        scanLiveUrlWithEvidence('https://myapp.example/', fetchMock, fakeLookup(), {
          visibilityAudit: true,
        }),
      ).resolves.toMatchObject({
        findings: expect.any(Array),
        pageText: expect.any(String),
      });

      const result = await scanLiveUrlWithEvidence(
        'https://myapp.example/',
        pageFetchMock({ throwOn: '/llms.txt' }),
        fakeLookup(),
        { visibilityAudit: true },
      );
      expect(result.visibility).toBeDefined();
      // Thrown fetch on llms → null → fail (not skipped).
      const llms = result.visibility!.checks.find((c) => c.id === 'ai-llms-txt');
      expect(llms?.status).toBe('fail');
    });
  });
});
