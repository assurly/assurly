import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GitHubApiError,
  GitHubWriteAccessError,
  resolveGitHubWriteTarget,
  resolveGitHubWriteToken,
  tokenCanPushToRepository,
} from './githubApp';

describe('tokenCanPushToRepository', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns true when GitHub reports push permissions', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ permissions: { push: true } }), { status: 200 }),
    );

    await expect(tokenCanPushToRepository('token', 'acme/app')).resolves.toBe(true);
  });

  it('returns false when GitHub reports read-only permissions', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ permissions: { push: false, pull: true } }), { status: 200 }),
    );

    await expect(tokenCanPushToRepository('token', 'acme/app')).resolves.toBe(false);
  });
});

describe('resolveGitHubWriteToken', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    delete process.env.GITHUB_PAT;
    delete process.env.GITHUB_TOKEN;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the user token without requesting an installation token', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ permissions: { push: true } }), { status: 200 }),
    );

    await expect(
      resolveGitHubWriteToken({
        userGitHubToken: 'gho_user-token',
        repositoryName: 'acme/app',
        installationId: '140302856',
        repositoryId: 123,
      }),
    ).resolves.toBe('gho_user-token');

    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/app/installations/'))).toBe(
      false,
    );
  });

  it('throws GitHubWriteAccessError when the user token lacks repo scope and cannot push', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes('/repos/acme/app')) {
        return new Response(JSON.stringify({ permissions: { push: false, pull: true } }), {
          status: 200,
        });
      }
      return new Response(JSON.stringify({ login: 'dev-user' }), {
        status: 200,
        headers: { 'x-oauth-scopes': 'read:user' },
      });
    });

    await expect(
      resolveGitHubWriteToken({
        userGitHubToken: 'gho_readonly',
        repositoryName: 'acme/app',
      }),
    ).rejects.toBeInstanceOf(GitHubWriteAccessError);
  });

  it('returns a fork write target when the user cannot push to upstream', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (String(url).includes('/repos/acme/app/forks') && method === 'POST') {
        return new Response(JSON.stringify({ full_name: 'dev-user/app' }), { status: 201 });
      }
      if (String(url).includes('/repos/dev-user/app')) {
        return new Response(JSON.stringify({ permissions: { push: true } }), { status: 200 });
      }
      if (String(url).includes('/repos/acme/app')) {
        return new Response(JSON.stringify({ permissions: { push: false, pull: true } }), {
          status: 200,
        });
      }
      return new Response(JSON.stringify({ login: 'dev-user' }), {
        status: 200,
        headers: { 'x-oauth-scopes': 'repo' },
      });
    });

    await expect(
      resolveGitHubWriteTarget({
        userGitHubToken: 'gho_user-token',
        repositoryName: 'acme/app',
      }),
    ).resolves.toEqual({
      token: 'gho_user-token',
      commitRepositoryName: 'dev-user/app',
      pullRequestRepositoryName: 'acme/app',
      pullRequestHeadOwner: 'dev-user',
    });
  });

  it('falls back to the server PAT when no user token is available', async () => {
    process.env.GITHUB_PAT = 'ghp_serverpat';
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ permissions: { push: true } }), { status: 200 }),
    );

    await expect(
      resolveGitHubWriteToken({
        repositoryName: 'acme/app',
      }),
    ).resolves.toBe('ghp_serverpat');
  });
});
