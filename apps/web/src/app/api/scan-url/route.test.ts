import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import { RATE_LIMITS } from '../../../utils/apiSecurity';
import { resetRateLimitsForTests } from '../../../utils/rateLimit';
import { POST } from './route';

const scanLiveUrlMock = vi.hoisted(() => vi.fn());

vi.mock('../../../utils/runtimeScanner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/runtimeScanner')>();
  return {
    ...actual,
    scanLiveUrl: scanLiveUrlMock,
  };
});

describe('POST /api/scan-url', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    resetRateLimitsForTests();
    scanLiveUrlMock.mockReset();
    scanLiveUrlMock.mockResolvedValue([]);
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.unstubAllGlobals();
  });

  it('returns report and findings for a valid public URL', async () => {
    scanLiveUrlMock.mockResolvedValue([
      {
        ruleId: 'runtime-missing-security-headers',
        severity: 'warning',
        message: 'Missing security headers: Strict-Transport-Security.',
        file: 'HTTP response',
      },
    ]);

    const response = await POST(
      new Request('http://localhost/api/scan-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'https://myapp.lovable.app' }),
      }),
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.report).toMatchObject({
      status: 'review',
      headline: 'REVIEW RECOMMENDED',
      shipScore: expect.any(Number),
    });
    expect(json.findings).toHaveLength(1);
    expect(scanLiveUrlMock).toHaveBeenCalledWith('https://myapp.lovable.app/');
  });

  it('returns NOT READY TO SHIP when runtime RLS is open', async () => {
    scanLiveUrlMock.mockResolvedValue([
      {
        ruleId: 'runtime-supabase-rls-open',
        severity: 'error',
        message: "Supabase table 'profiles' returned rows via anon key without RLS protection.",
        file: 'Supabase REST API',
      },
    ]);

    const response = await POST(
      new Request('http://localhost/api/scan-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'https://myapp.lovable.app' }),
      }),
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.report).toMatchObject({
      status: 'blocked',
      headline: 'NOT READY TO SHIP',
    });
  });

  it('rejects localhost URLs with 400', async () => {
    const response = await POST(
      new Request('http://localhost/api/scan-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'http://localhost:3000' }),
      }),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('invalid_url');
    expect(scanLiveUrlMock).not.toHaveBeenCalled();
  });

  it('rejects private IP URLs with 400', async () => {
    const response = await POST(
      new Request('http://localhost/api/scan-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'http://192.168.0.10' }),
      }),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('invalid_url');
  });

  it('rejects non-http(s) URLs with 400', async () => {
    const response = await POST(
      new Request('http://localhost/api/scan-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'file:///tmp/app' }),
      }),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('invalid_url');
  });

  it('rejects malformed URLs with 400', async () => {
    const response = await POST(
      new Request('http://localhost/api/scan-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: '::::' }),
      }),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('invalid_url');
  });

  it('uses the expensive rate limit policy', () => {
    expect(POST.security.rateLimit).toEqual(RATE_LIMITS.expensive);
  });

  it('returns 429 when the expensive rate limit is exceeded', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const allowed = await POST(
        new Request('http://localhost/api/scan-url', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-forwarded-for': '203.0.113.44',
          },
          body: JSON.stringify({ url: 'https://example.com' }),
        }),
      );
      expect(allowed.status).toBe(200);
    }

    const limited = await POST(
      new Request('http://localhost/api/scan-url', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': '203.0.113.44',
        },
        body: JSON.stringify({ url: 'https://example.com' }),
      }),
    );
    expect(limited.status).toBe(429);
    expect((await limited.json()).error.code).toBe('rate_limited');
  });

  it('never allows mutating HTTP methods through runtimeFetch', async () => {
    const { runtimeFetch } = await import('../../../utils/runtimeScanner');
    const fetchMock = vi.fn();
    await expect(runtimeFetch('https://example.com', { method: 'PUT' }, fetchMock)).rejects.toThrow(
      'Mutating HTTP method',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
