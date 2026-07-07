import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { COOKIE_NAME } from '../../../utils/auth';
import { resetRateLimitsForTests } from '../../../utils/rateLimit';
import { POST } from './route';

describe('Contact API Route Handler', () => {
  const originalEnv = process.env;
  const validContactBody = {
    name: 'Jane Doe',
    email: 'jane@example.com',
    subject: 'technical',
    message: 'Hello, I need help configuring Assurly on my Vercel project.',
  } as const;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    resetRateLimitsForTests();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.unstubAllGlobals();
  });

  it('successfully processes a valid contact form submission in simulated mode', async () => {
    delete process.env.RESEND_API_KEY; // Ensure we are in simulated mode
    process.env.CONTACT_SIMULATION_ENABLED = 'true';

    const mockRequest = new Request('http://localhost/api/contact', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(validContactBody),
    });

    const response = await POST(mockRequest);
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.success).toBe(true);
    expect(json.simulated).toBe(true);
  });

  it('declares CSRF protection for cookie-authenticated submissions', () => {
    expect(POST.security.csrf).toBe(true);
  });

  it('blocks cookie-authenticated submissions without a trusted Origin before sending email', async () => {
    process.env.APP_URL = 'https://app.assurly.example';
    process.env.RESEND_API_KEY = 'resend-test-key';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(
      new Request('https://app.assurly.example/api/contact', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: `${COOKIE_NAME}=session`,
        },
        body: JSON.stringify(validContactBody),
      }),
    );

    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe('invalid_origin');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('allows cookie-authenticated same-origin contact submissions', async () => {
    process.env.APP_URL = 'https://app.assurly.example';
    delete process.env.RESEND_API_KEY;
    process.env.CONTACT_SIMULATION_ENABLED = 'true';

    const response = await POST(
      new Request('https://app.assurly.example/api/contact', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: `${COOKIE_NAME}=session`,
          origin: 'https://app.assurly.example',
          'sec-fetch-site': 'same-origin',
        },
        body: JSON.stringify(validContactBody),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, simulated: true });
  });

  it('returns a 400 error when required fields are missing', async () => {
    const mockRequest = new Request('http://localhost/api/contact', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: '',
        email: 'invalid-email',
        subject: 'unknown-subject',
        message: 'short',
      }),
    });

    const response = await POST(mockRequest);
    expect(response.status).toBe(400);

    const json = await response.json();
    expect(json.error.code).toBe('invalid_request');
    expect(json.error.requestId).toBeTypeOf('string');
  });

  it('escapes user-controlled HTML before dispatching email', async () => {
    process.env.RESEND_API_KEY = 'resend-test-key';
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const response = await POST(
      new Request('http://localhost/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: '<img src=x onerror=alert(1)>',
          email: 'safe@example.com',
          subject: 'technical',
          message: '<script>alert(1)</script> This must never execute.',
        }),
      }),
    );
    expect(response.status).toBe(200);
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(payload.html).toContain('&lt;script&gt;');
    expect(payload.html).not.toContain('<script>');
  });
});
