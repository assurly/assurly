import { describe, expect, it, vi } from 'vitest';
import { appEndpointLocation, executeAppEndpointUnauthenticatedRead } from './appEndpoint';
import { sanitizeProbePlan } from './executor';
import { appEndpointUnauthenticatedReadParamsSchema } from './types';
import type { ProbeExecutionContext } from './types';

/**
 * The unauthenticated-endpoint primitive. Every fetch here is injected — no
 * test may touch a real host. The classification table is the contract: only a
 * JSON 200/206 with records counts as an exposure; refusals, redirects, pages
 * and server errors are silence.
 */

const TARGET_ORIGIN = 'https://myapp.example';

interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  hasBody: boolean;
  credentials?: RequestCredentials;
}

function ctxFor(
  responder: () => Response,
  recorded: RecordedRequest[] = [],
): ProbeExecutionContext {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    recorded.push({
      url: String(input),
      method: (init?.method ?? 'GET').toUpperCase(),
      headers: { ...((init?.headers as Record<string, string>) ?? {}) },
      hasBody: init?.body !== undefined && init?.body !== null,
      ...(init?.credentials ? { credentials: init.credentials } : {}),
    });
    return responder();
  }) as unknown as typeof fetch;

  return {
    targetOrigin: TARGET_ORIGIN,
    fetchImpl,
    lookupImpl: async () => [{ address: '203.0.113.10', family: 4 }],
    safeFetch: async (rawUrl, init, impl = fetchImpl) => {
      const response = await (impl ?? fetchImpl)(rawUrl, {
        ...init,
        method: init?.method ?? 'GET',
      });
      return { response, finalUrl: new URL(rawUrl) };
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

describe('executeAppEndpointUnauthenticatedRead — exposure', () => {
  it('reports a warning with record evidence when a JSON array comes back without a session', async () => {
    const recorded: RecordedRequest[] = [];
    const ctx = ctxFor(
      () =>
        jsonResponse([
          { id: 1, title: 'Alpha' },
          { id: 2, title: 'Beta' },
          { id: 3, title: 'Gamma' },
        ]),
      recorded,
    );

    const result = await executeAppEndpointUnauthenticatedRead({ path: '/api/orders' }, ctx);

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.ruleId).toBe('runtime-api-endpoint-open');
    expect(result.findings[0]?.severity).toBe('warning');
    expect(result.findings[0]?.file).toBe(appEndpointLocation(TARGET_ORIGIN, '/api/orders'));

    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]?.kind).toBe('open_endpoint');
    expect(result.evidence[0]?.summary).toBe(
      'GET /api/orders answered with 3 record(s) without a session.',
    );
    expect(result.evidence[0]?.redactedSample?.rowCount).toBe(3);
    expect(result.evidence[0]?.redactedSample?.columns).toEqual(['id', 'title']);
    // Sample values are redacted — raw body content never leaves the executor.
    expect(JSON.stringify(result.evidence[0])).not.toContain('Alpha');
  });

  it('escalates to error when the body carries PII-shaped values', async () => {
    const ctx = ctxFor(() => jsonResponse([{ id: 1, email: 'alice@example.com' }]));

    const result = await executeAppEndpointUnauthenticatedRead({ path: '/api/users' }, ctx);

    expect(result.findings[0]?.severity).toBe('error');
    expect(JSON.stringify(result.evidence)).not.toContain('alice@example.com');
  });

  it('issues exactly one GET with no query string, no body, no credentials and only Accept', async () => {
    const recorded: RecordedRequest[] = [];
    const ctx = ctxFor(() => jsonResponse([{ id: 1 }]), recorded);

    await executeAppEndpointUnauthenticatedRead({ path: '/api/customers' }, ctx);

    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.method).toBe('GET');
    expect(recorded[0]?.url).toBe('https://myapp.example/api/customers');
    expect(recorded[0]?.url).not.toContain('?');
    expect(recorded[0]?.headers).toEqual({ Accept: 'application/json' });
    expect(recorded[0]?.hasBody).toBe(false);
    expect(recorded[0]?.credentials).toBeUndefined();
  });
});

describe('executeAppEndpointUnauthenticatedRead — classification table', () => {
  const silent: Array<[string, () => Response]> = [
    ['401 (endpoint is protected)', () => jsonResponse({ error: 'unauthorized' }, 401)],
    ['403 (endpoint is protected)', () => jsonResponse({ error: 'forbidden' }, 403)],
    [
      '302 (redirect to a login)',
      () => new Response('', { status: 302, headers: { location: '/login' } }),
    ],
    ['404 (no such endpoint)', () => jsonResponse({ error: 'not found' }, 404)],
    ['405 (method not allowed)', () => jsonResponse({ error: 'method' }, 405)],
    [
      '500 (a bug, never a security finding)',
      () => jsonResponse({ error: 'boom', email: 'a@b.com' }, 500),
    ],
    [
      'HTML 200 (a page, not an API)',
      () =>
        new Response('<html><body>dashboard</body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        }),
    ],
    ['empty JSON array', () => jsonResponse([])],
    ['empty JSON object', () => jsonResponse({})],
    ['JSON null', () => jsonResponse(null)],
  ];

  for (const [label, responder] of silent) {
    it(`reports nothing for ${label}`, async () => {
      const ctx = ctxFor(responder);
      const result = await executeAppEndpointUnauthenticatedRead({ path: '/api/users' }, ctx);
      expect(result.findings).toEqual([]);
      expect(result.evidence).toEqual([]);
    });
  }

  it('accepts 206 partial content as an exposure', async () => {
    const ctx = ctxFor(() => jsonResponse([{ id: 1 }], 206));
    const result = await executeAppEndpointUnauthenticatedRead({ path: '/api/export' }, ctx);
    expect(result.findings).toHaveLength(1);
  });

  // AI-built apps often write `NextResponse.json({ error: 'Unauthorized' })` and
  // forget the status — a 200 that carries a refusal, not a record. Reporting it
  // as "handed back real records" would be false, and it costs the app 4 points.
  const envelopes: Array<[string, unknown]> = [
    ['{ error }', { error: 'Unauthorized' }],
    ['{ message, status }', { message: 'Unauthorized', status: 401 }],
    ['{ ok }', { ok: true }],
    ['{ success, code }', { success: false, code: 'UNAUTHENTICATED' }],
  ];
  for (const [label, body] of envelopes) {
    it(`reports nothing for a 200 whose body is only a status envelope ${label}`, async () => {
      const ctx = ctxFor(() => jsonResponse(body));
      const result = await executeAppEndpointUnauthenticatedRead({ path: '/api/me' }, ctx);
      expect(result.findings).toEqual([]);
      expect(result.evidence).toEqual([]);
    });
  }

  it('still reports an envelope that carries a record alongside its status', async () => {
    const ctx = ctxFor(() => jsonResponse({ ok: true, user: { id: 7, name: 'Ada' } }));
    const result = await executeAppEndpointUnauthenticatedRead({ path: '/api/me' }, ctx);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.severity).toBe('warning');
  });

  it('still escalates an envelope-shaped object that leaks PII', async () => {
    const ctx = ctxFor(() => jsonResponse({ message: 'hello', email: 'ada@example.com' }));
    const result = await executeAppEndpointUnauthenticatedRead({ path: '/api/me' }, ctx);
    expect(result.findings[0]?.severity).toBe('error');
  });
});

describe('executeAppEndpointUnauthenticatedRead — same-origin rail', () => {
  it('refuses a path that resolves off-origin before issuing any fetch', async () => {
    const recorded: RecordedRequest[] = [];
    const ctx = ctxFor(() => jsonResponse([{ id: 1 }]), recorded);

    // The schema rejects this shape; the executor must refuse it anyway.
    const result = await executeAppEndpointUnauthenticatedRead(
      { path: '//evil.example/api/users' },
      ctx,
    );

    expect(recorded).toEqual([]);
    expect(result.findings).toEqual([]);
    expect(ctx.fetchImpl).not.toHaveBeenCalled();
  });

  it('reports nothing when a redirect lands the request on another origin', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse([{ id: 1, email: 'a@b.com' }]),
    ) as unknown as typeof fetch;
    const ctx: ProbeExecutionContext = {
      targetOrigin: TARGET_ORIGIN,
      fetchImpl,
      safeFetch: async (rawUrl, init, impl = fetchImpl) => ({
        response: await (impl ?? fetchImpl)(rawUrl, { ...init, method: init?.method ?? 'GET' }),
        // safeFetch follows redirects; the body may come from a different origin.
        finalUrl: new URL('https://cdn.other.example/api/users'),
      }),
    };

    const result = await executeAppEndpointUnauthenticatedRead({ path: '/api/users' }, ctx);
    expect(result.findings).toEqual([]);
  });
});

describe('app_endpoint_unauthenticated_read params schema', () => {
  it('accepts a plain /api path and strips unknown keys', () => {
    const parsed = appEndpointUnauthenticatedReadParamsSchema.parse({
      path: '/api/orders/list',
      method: 'DELETE',
      url: 'https://evil.example',
    });
    expect(parsed).toEqual({ path: '/api/orders/list' });
  });

  it('rejects traversal, off-origin, query strings and non-/api paths', () => {
    const rejected = [
      '/api/../../etc/passwd',
      '/api/users/..',
      '//evil.example/api/users',
      'https://evil.example/api/users',
      '/admin/users',
      '/api/users?role=admin',
      '/api/',
    ];
    for (const path of rejected) {
      expect(appEndpointUnauthenticatedReadParamsSchema.safeParse({ path }).success).toBe(false);
    }
  });

  it('is dropped by the plan sanitiser under an unknown primitive name', () => {
    const plan = sanitizeProbePlan([
      { primitive: 'app_endpoint_raw_read', params: { path: '/api/users' } },
      { primitive: 'app_endpoint_unauthenticated_read', params: { path: '/api/../secrets' } },
      { primitive: 'app_endpoint_unauthenticated_read', params: { path: '/api/users' } },
      { primitive: 'app_endpoint_unauthenticated_read', params: { path: '/api/users' } },
    ]);
    expect(plan).toEqual([
      { primitive: 'app_endpoint_unauthenticated_read', params: { path: '/api/users' } },
    ]);
  });
});
