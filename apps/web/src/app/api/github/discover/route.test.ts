import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as authModule from '../../../../utils/auth';
import { GET } from './route';

const mockFetch = vi.fn();

describe('GitHub discover proxy (GET /api/github/discover)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', mockFetch);
    delete process.env.GITHUB_PAT;
    delete process.env.GITHUB_TOKEN;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists public repositories for a GitHub user', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          {
            id: 1,
            name: 'app',
            full_name: 'yablko/app',
            description: null,
            stargazers_count: 0,
            language: 'TypeScript',
          },
        ]),
        { status: 200 },
      ),
    );

    const response = await GET(
      new Request('http://localhost/api/github/discover?type=user-repos&owner=yablko'),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toHaveLength(1);
    expect(String(mockFetch.mock.calls[0]?.[0])).toContain('/users/yablko/repos');
  });

  it('falls back to organization repositories when the user endpoint returns 404', async () => {
    mockFetch.mockResolvedValueOnce(new Response('{}', { status: 404 })).mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          {
            id: 2,
            name: 'repo',
            full_name: 'acme/repo',
            description: null,
            stargazers_count: 0,
            language: null,
          },
        ]),
        { status: 200 },
      ),
    );

    const response = await GET(
      new Request('http://localhost/api/github/discover?type=user-repos&owner=acme'),
    );
    expect(response.status).toBe(200);
    expect(String(mockFetch.mock.calls[1]?.[0])).toContain('/orgs/acme/repos');
  });

  it('returns repository metadata for owner/repo lookups', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 99,
          name: 'tailwind-trulo',
          full_name: 'yablko/tailwind-trulo',
          description: null,
          stargazers_count: 3,
          language: 'HTML',
        }),
        { status: 200 },
      ),
    );

    const response = await GET(
      new Request(
        'http://localhost/api/github/discover?type=repository&repo=yablko%2Ftailwind-trulo',
      ),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).full_name).toBe('yablko/tailwind-trulo');
  });

  it('uses the signed-in user GitHub token when available', async () => {
    vi.spyOn(authModule, 'requireUser').mockResolvedValue({
      user: { id: 'user-1', name: 'Dev', email: 'dev@example.com', avatar_url: '' },
      accessToken: 'verified-session',
      githubAccessToken: 'gho_user-token',
      db: {} as never,
    });

    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }));

    await GET(
      new Request('http://localhost/api/github/discover?type=user-repos&owner=yablko', {
        headers: {
          cookie: `${authModule.COOKIE_NAME}=${encodeURIComponent(JSON.stringify({ accessToken: 'verified-session' }))}`,
        },
      }),
    );

    expect((mockFetch.mock.calls[0]?.[1] as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer gho_user-token',
    });
  });
});
