import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ requireUser: vi.fn() }));
vi.mock('./auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./auth')>()),
  requireUser: mocks.requireUser,
}));

import { AuthenticationError, COOKIE_NAME } from './auth';
import { emptyBodySchema, emptyObjectSchema, secureRoute } from './apiSecurity';
import { resetRateLimitsForTests } from './rateLimit';

const authenticated = {
  user: { id: 'user-a', name: 'A', email: 'a@example.com', avatar_url: '' },
  accessToken: 'token',
  db: {},
};

describe('shared API security layer', () => {
  beforeEach(() => {
    resetRateLimitsForTests();
    vi.clearAllMocks();
    process.env.APP_URL = 'https://app.shipready.example';
    mocks.requireUser.mockResolvedValue(authenticated);
  });

  it('validates query, params, and body before executing a handler', async () => {
    const handler = vi.fn(async () => Response.json({ ok: true }));
    const route = secureRoute(
      {
        routeId: 'test:validation',
        auth: 'none',
        query: emptyObjectSchema,
        params: emptyObjectSchema,
        body: emptyBodySchema,
        bodyMode: 'none',
        maxBodyBytes: 0,
        rateLimit: { limit: 10, windowSeconds: 60 },
      },
      handler,
    );
    const response = await route(
      new Request('https://app.shipready.example/api/test?unexpected=true'),
    );
    expect(response.status).toBe(400);
    expect(handler).not.toHaveBeenCalled();
  });

  it('rejects oversized payloads before JSON parsing', async () => {
    const route = secureRoute(
      {
        routeId: 'test:payload',
        auth: 'none',
        query: emptyObjectSchema,
        params: emptyObjectSchema,
        body: emptyObjectSchema,
        bodyMode: 'json',
        maxBodyBytes: 4,
        rateLimit: { limit: 10, windowSeconds: 60 },
      },
      async () => Response.json({ ok: true }),
    );
    const response = await route(
      new Request('https://app.shipready.example/api/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"too":"large"}',
      }),
    );
    expect(response.status).toBe(413);
  });

  it('enforces authentication for protected handlers', async () => {
    mocks.requireUser.mockRejectedValue(new AuthenticationError());
    const route = secureRoute(
      {
        routeId: 'test:auth',
        auth: 'required',
        query: emptyObjectSchema,
        params: emptyObjectSchema,
        body: emptyBodySchema,
        bodyMode: 'none',
        maxBodyBytes: 0,
        rateLimit: { limit: 10, windowSeconds: 60 },
      },
      async () => Response.json({ ok: true }),
    );
    expect((await route(new Request('https://app.shipready.example/api/test'))).status).toBe(401);
  });

  it('rate limits by IP and returns a safe request ID', async () => {
    const route = secureRoute(
      {
        routeId: 'test:rate',
        auth: 'none',
        query: emptyObjectSchema,
        params: emptyObjectSchema,
        body: emptyBodySchema,
        bodyMode: 'none',
        maxBodyBytes: 0,
        rateLimit: { limit: 2, windowSeconds: 60 },
      },
      async () => Response.json({ ok: true }),
    );
    const request = () =>
      new Request('https://app.shipready.example/api/test', {
        headers: { 'x-forwarded-for': '203.0.113.9' },
      });
    expect((await route(request())).status).toBe(200);
    expect((await route(request())).status).toBe(200);
    const limited = await route(request());
    expect(limited.status).toBe(429);
    expect(limited.headers.get('x-request-id')).toBeTruthy();
    expect((await limited.json()).error.code).toBe('rate_limited');
  });

  it('rate limits authenticated users across different IP addresses', async () => {
    const route = secureRoute(
      {
        routeId: 'test:user-rate',
        auth: 'required',
        query: emptyObjectSchema,
        params: emptyObjectSchema,
        body: emptyBodySchema,
        bodyMode: 'none',
        maxBodyBytes: 0,
        rateLimit: { limit: 1, windowSeconds: 60 },
      },
      async () => Response.json({ ok: true }),
    );
    const first = await route(
      new Request('https://app.shipready.example/api/test', {
        headers: { 'x-forwarded-for': '203.0.113.10' },
      }),
    );
    const second = await route(
      new Request('https://app.shipready.example/api/test', {
        headers: { 'x-forwarded-for': '203.0.113.11' },
      }),
    );
    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
  });

  it('blocks cookie-authenticated mutations without a trusted Origin', async () => {
    const route = secureRoute(
      {
        routeId: 'test:csrf',
        auth: 'required',
        query: emptyObjectSchema,
        params: emptyObjectSchema,
        body: emptyBodySchema,
        bodyMode: 'none',
        maxBodyBytes: 0,
        rateLimit: { limit: 10, windowSeconds: 60 },
        csrf: true,
      },
      async () => Response.json({ ok: true }),
    );
    const blocked = await route(
      new Request('https://app.shipready.example/api/test', {
        method: 'POST',
        headers: { cookie: `${COOKIE_NAME}=session` },
      }),
    );
    expect(blocked.status).toBe(403);

    const allowed = await route(
      new Request('https://app.shipready.example/api/test', {
        method: 'POST',
        headers: {
          cookie: `${COOKIE_NAME}=session`,
          origin: 'https://app.shipready.example',
          'sec-fetch-site': 'same-origin',
        },
      }),
    );
    expect(allowed.status).toBe(200);
  });

  it('never returns internal exception details', async () => {
    const route = secureRoute(
      {
        routeId: 'test:error',
        auth: 'none',
        query: emptyObjectSchema,
        params: emptyObjectSchema,
        body: emptyBodySchema,
        bodyMode: 'none',
        maxBodyBytes: 0,
        rateLimit: { limit: 10, windowSeconds: 60 },
      },
      async () => {
        throw new Error('database-password=secret');
      },
    );
    const response = await route(new Request('https://app.shipready.example/api/test'));
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain('database-password');
  });
});
