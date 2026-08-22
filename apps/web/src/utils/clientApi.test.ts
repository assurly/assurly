import { afterEach, describe, expect, it, vi } from 'vitest';
import { clientApi, githubApi } from './clientApi';
import {
  __resetUnauthorizedSessionForTests,
  subscribeToUnauthorizedSession,
} from './unauthorizedSession';

function unauthorizedResponse(): Response {
  return Response.json(
    { error: { code: 'unauthorized', message: 'Authentication is required.' } },
    { status: 401 },
  );
}

describe('githubApi', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('encodes URL segments and validates the response shape', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            id: 42,
            name: 'app',
            full_name: 'acme space/app',
            description: null,
            stargazers_count: 1,
            language: 'TypeScript',
          },
        ]),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(githubApi.repositories('acme space')).resolves.toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/github/discover?type=user-repos&owner=acme%20space'),
      expect.objectContaining({ credentials: 'same-origin' }),
    );
  });

  it('rejects malformed external API data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify([{ id: 'wrong' }]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    await expect(githubApi.repositories('acme')).rejects.toThrow();
  });
});

describe('clientApi error handling', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    __resetUnauthorizedSessionForTests();
  });

  it('preserves structured API error details without stringifying the object', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json(
          {
            error: {
              code: 'billing_account_unavailable',
              message: 'Billing account is unavailable.',
              requestId: 'request_12345678',
            },
          },
          { status: 409 },
        ),
      ),
    );

    const unauthorized = vi.fn();
    subscribeToUnauthorizedSession(unauthorized);

    await expect(clientApi.portal()).rejects.toMatchObject({
      name: 'ClientApiError',
      message: 'Billing account is unavailable.',
      status: 409,
      code: 'billing_account_unavailable',
      requestId: 'request_12345678',
    });
    expect(unauthorized).not.toHaveBeenCalled();
  });

  it('uses a safe fallback for malformed error responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ error: { unexpected: true } }, { status: 500 })),
    );

    await expect(clientApi.portal()).rejects.toMatchObject({
      message: 'The request could not be completed.',
      status: 500,
    });
  });

  it('retries a 401 once and does not notify when the retry succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(unauthorizedResponse())
      .mockResolvedValueOnce(Response.json({ scans: [] }, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const unauthorized = vi.fn();
    subscribeToUnauthorizedSession(unauthorized);

    await expect(clientApi.scans('11000000-0000-4000-8000-000000000001')).resolves.toEqual({
      scans: [],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(unauthorized).not.toHaveBeenCalled();
  });

  it('notifies subscribers and throws after a 401 retry still fails', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(unauthorizedResponse()));
    vi.stubGlobal('fetch', fetchMock);
    const unauthorized = vi.fn();
    subscribeToUnauthorizedSession(unauthorized);

    await expect(clientApi.scans('11000000-0000-4000-8000-000000000001')).rejects.toMatchObject({
      name: 'ClientApiError',
      status: 401,
      code: 'unauthorized',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(unauthorized).toHaveBeenCalledTimes(1);
  });

  it('does not treat /api/auth/session 401 as a zombie dashboard session', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(unauthorizedResponse()));
    vi.stubGlobal('fetch', fetchMock);
    const unauthorized = vi.fn();
    subscribeToUnauthorizedSession(unauthorized);

    await expect(clientApi.session()).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(unauthorized).not.toHaveBeenCalled();
  });
});
