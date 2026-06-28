import { afterEach, describe, expect, it, vi } from 'vitest';
import { clientApi, githubApi } from './clientApi';

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

    await expect(clientApi.portal()).rejects.toMatchObject({
      name: 'ClientApiError',
      message: 'Billing account is unavailable.',
      status: 409,
      code: 'billing_account_unavailable',
      requestId: 'request_12345678',
    });
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
});
