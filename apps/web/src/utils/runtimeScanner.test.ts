import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
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
  scanBundleForSecrets,
  scanBundleForSecretsWithEvidence,
  type LookupImpl,
} from './runtimeScanner';

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
    });
  });
});
