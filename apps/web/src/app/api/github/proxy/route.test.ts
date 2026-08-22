import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from './route';
import { GitHubApiError } from '../../../../utils/githubApp';
import { clearInstantGateTreeCacheForTests } from '../../../../utils/instantGateTree';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  getInstallationAccessToken: vi.fn(),
}));

vi.mock('../../../../utils/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../utils/auth')>()),
  requireUser: mocks.requireUser,
}));

// Keep every real helper (GitHubApiError, name validation, URL builders) and
// only replace the single network call that mints an installation token.
vi.mock('../../../../utils/githubApp', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../utils/githubApp')>()),
  getInstallationAccessToken: mocks.getInstallationAccessToken,
}));

const REPO_ID = '11000000-0000-4000-8000-000000000001';

const db = {
  getRepository: vi.fn(),
  getOrganization: vi.fn(),
  getMembership: vi.fn(),
};

function treeRequest(): Request {
  return new Request(`http://localhost/api/github/proxy?repoId=${REPO_ID}&type=tree`);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  clearInstantGateTreeCacheForTests();

  mocks.requireUser.mockResolvedValue({
    user: { id: 'user-1', name: 'Tester', email: '', avatar_url: '' },
    accessToken: 'verified',
    db,
  });
  db.getOrganization.mockResolvedValue({ id: 'org-1', github_installation_id: '140302856' });
  db.getMembership.mockResolvedValue({ id: 'mem-1', role: 'owner' });
  db.getRepository.mockResolvedValue({
    id: REPO_ID,
    organization_id: 'org-1',
    name: 'owner/repo',
    github_repo_id: 123,
  });
});

describe('GitHub installation proxy error classification (GET /api/github/proxy)', () => {
  it('returns 422 invalid_repository for a malformed stored repository name (no opaque 500)', async () => {
    db.getRepository.mockResolvedValue({
      id: REPO_ID,
      organization_id: 'org-1',
      name: 'serverless-heavy-api', // seed fixture missing the "owner/" prefix
      github_repo_id: 223344,
    });

    const res = await GET(treeRequest());

    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe('invalid_repository');
    // The token request must never run for a name we already know is invalid.
    expect(mocks.getInstallationAccessToken).not.toHaveBeenCalled();
  });

  it('maps a 422 from GitHub (repo not in installation) to a clear 404 repository_unavailable', async () => {
    mocks.getInstallationAccessToken.mockRejectedValue(
      new GitHubApiError(422, 'GitHub installation token request failed (422).'),
    );

    const res = await GET(treeRequest());

    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('repository_unavailable');
  });

  it('maps a 404 from GitHub to a clear 404 repository_unavailable', async () => {
    mocks.getInstallationAccessToken.mockRejectedValue(
      new GitHubApiError(404, 'GitHub installation token request failed (404).'),
    );

    const res = await GET(treeRequest());

    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('repository_unavailable');
  });

  it('maps a 401 (app auth failure) to 503 github_not_configured', async () => {
    mocks.getInstallationAccessToken.mockRejectedValue(
      new GitHubApiError(401, 'GitHub installation token request failed (401).'),
    );

    const res = await GET(treeRequest());

    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe('github_not_configured');
  });

  it('maps unexpected GitHub failures to 502 github_unavailable', async () => {
    mocks.getInstallationAccessToken.mockRejectedValue(
      new GitHubApiError(500, 'GitHub installation token request failed (500).'),
    );

    const res = await GET(treeRequest());

    expect(res.status).toBe(502);
    expect((await res.json()).error.code).toBe('github_unavailable');
  });

  it('returns 503 github_not_configured when the organization has no installation', async () => {
    db.getOrganization.mockResolvedValue({ id: 'org-1', github_installation_id: null });

    const res = await GET(treeRequest());

    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe('github_not_configured');
  });

  it('returns the resolved tree (with commit SHA) on the happy path', async () => {
    mocks.getInstallationAccessToken.mockResolvedValue('installation-token');

    const sha = 'a3f2b91c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.endsWith('/repos/owner/repo')) {
          return new Response(JSON.stringify({ default_branch: 'main' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        if (url.includes('/git/trees/')) {
          return new Response(JSON.stringify({ tree: [{ path: 'package.json', type: 'blob' }] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        if (url.includes('/commits/')) {
          return new Response(JSON.stringify({ sha }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response('not found', { status: 404 });
      }),
    );

    const res = await GET(treeRequest());

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.default_branch).toBe('main');
    expect(data.tree).toHaveLength(1);
    expect(data.tree[0].path).toBe('package.json');
    expect(data.tree[0].sha).toBeUndefined();
    expect(data.commit_sha).toBe(sha);
    expect(res.headers.get('cache-control')).toContain('max-age=60');
  });

  it('returns branch names for type=branches', async () => {
    mocks.getInstallationAccessToken.mockResolvedValue('installation-token');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.endsWith('/repos/owner/repo')) {
          return new Response(JSON.stringify({ default_branch: 'src' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        if (url.includes('/branches?per_page=100')) {
          return new Response(JSON.stringify([{ name: 'src' }, { name: 'main' }]), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response('not found', { status: 404 });
      }),
    );

    const res = await GET(
      new Request(`http://localhost/api/github/proxy?repoId=${REPO_ID}&type=branches`),
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      default_branch: 'src',
      branches: ['src', 'main'],
    });
  });
});

describe('GitHub installation proxy batch read (POST /api/github/proxy)', () => {
  function batchRequest(body: unknown): Request {
    return new Request('http://localhost/api/github/proxy', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('fetches every requested file in one response using the installation token', async () => {
    mocks.getInstallationAccessToken.mockResolvedValue('installation-token');
    const contents: Record<string, string> = {
      'package.json': '{"name":"app"}',
      'db/schema.sql': 'create table users();',
    };
    // URL-routed mock, robust to the batch's concurrent fetch order.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        const match = url.match(/\/contents\/(.+)\?ref=main$/);
        if (match) {
          // The installation token must be used for the file reads.
          expect((options?.headers as Record<string, string>).Authorization).toBe(
            'Bearer installation-token',
          );
          return new Response(contents[decodeURIComponent(match[1])] ?? '', { status: 200 });
        }
        return new Response('not found', { status: 404 });
      }),
    );

    const res = await POST(
      batchRequest({ repoId: REPO_ID, branch: 'main', paths: Object.keys(contents) }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.default_branch).toBe('main');
    const byPath = Object.fromEntries(
      (data.files as Array<{ path: string; content: string | null }>).map((f) => [
        f.path,
        f.content,
      ]),
    );
    expect(byPath['package.json']).toBe('{"name":"app"}');
    expect(byPath['db/schema.sql']).toBe('create table users();');
  });

  it('returns null for an unreadable file instead of failing the batch', async () => {
    mocks.getInstallationAccessToken.mockResolvedValue('installation-token');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/contents/ok.ts?ref=main')) {
          return new Response('export const ok = 1;', { status: 200 });
        }
        return new Response('not found', { status: 404 });
      }),
    );

    const res = await POST(
      batchRequest({ repoId: REPO_ID, branch: 'main', paths: ['ok.ts', 'gone.ts'] }),
    );
    expect(res.status).toBe(200);
    const byPath = Object.fromEntries(
      ((await res.json()).files as Array<{ path: string; content: string | null }>).map((f) => [
        f.path,
        f.content,
      ]),
    );
    expect(byPath['ok.ts']).toBe('export const ok = 1;');
    expect(byPath['gone.ts']).toBeNull();
  });

  it('rejects a malformed body (no paths)', async () => {
    const res = await POST(batchRequest({ repoId: REPO_ID, branch: 'main' }));
    expect(res.status).toBe(400);
  });
});
