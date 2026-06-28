import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import * as authModule from '../../../../utils/auth';
import { GET } from './route';

// Setup mock fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const MOCK_TREE = {
  tree: [
    { path: 'package.json', type: 'blob' },
    { path: 'schema.sql', type: 'blob' },
  ],
};
const MOCK_COMMIT_SHA = 'a3f2b91c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a';

function mockMetadata(branch = 'main', isPrivate = false) {
  return {
    ok: true,
    json: () => Promise.resolve({ default_branch: branch, private: isPrivate }),
  };
}

function mockTreeResponse(tree = MOCK_TREE) {
  return new Response(JSON.stringify(tree), { status: 200 });
}

function mockCommitResponse(sha = MOCK_COMMIT_SHA) {
  return {
    ok: true,
    json: () => Promise.resolve({ sha }),
  };
}

describe('GitHub Public Scan Proxy (GET /api/github/public-scan)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should return 400 when required parameters are missing', async () => {
    const req = new Request('http://localhost/api/github/public-scan?repo=vercel/next.js');
    const res = await GET(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.code).toBe('invalid_request');
  });

  it('should resolve default branch and return tree data with real commit_sha', async () => {
    mockFetch
      .mockImplementationOnce((url: string) => {
        expect(url).toBe('https://api.github.com/repos/vercel/next.js');
        return Promise.resolve(mockMetadata('canary'));
      })
      .mockImplementationOnce((url: URL) => {
        expect(String(url)).toBe(
          'https://api.github.com/repos/vercel/next.js/git/trees/canary?recursive=1',
        );
        return Promise.resolve(mockTreeResponse());
      })
      .mockImplementationOnce((url: string) => {
        expect(url).toBe('https://api.github.com/repos/vercel/next.js/commits/canary');
        return Promise.resolve(mockCommitResponse());
      });

    const req = new Request(
      'http://localhost/api/github/public-scan?repo=vercel/next.js&type=tree',
    );
    const res = await GET(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.default_branch).toBe('canary');
    expect(data.tree).toHaveLength(2);
    expect(data.tree[0].path).toBe('package.json');
    expect(data.commit_sha).toBe(MOCK_COMMIT_SHA);
  });

  it('should include commit_sha when an explicit branch is provided', async () => {
    const sha = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
    mockFetch
      .mockImplementationOnce(() => Promise.resolve(mockMetadata('main')))
      .mockImplementationOnce(() => Promise.resolve(mockTreeResponse()))
      .mockImplementationOnce(() => Promise.resolve(mockCommitResponse(sha)));

    const req = new Request(
      'http://localhost/api/github/public-scan?repo=vercel/next.js&type=tree&branch=stable',
    );
    const res = await GET(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.commit_sha).toBe(sha);
    expect(data.default_branch).toBe('stable');
  });

  it('should omit commit_sha (undefined) when commit fetch fails — scan still succeeds', async () => {
    mockFetch
      .mockImplementationOnce(() => Promise.resolve(mockMetadata()))
      .mockImplementationOnce(() => Promise.resolve(mockTreeResponse()))
      .mockImplementationOnce(() => Promise.resolve(new Response(null, { status: 403 })));

    const req = new Request(
      'http://localhost/api/github/public-scan?repo=vercel/next.js&type=tree',
    );
    const res = await GET(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.commit_sha).toBeUndefined();
    expect(data.tree).toBeDefined();
  });

  it('should omit commit_sha when commit response body is malformed — scan still succeeds', async () => {
    mockFetch
      .mockImplementationOnce(() => Promise.resolve(mockMetadata()))
      .mockImplementationOnce(() => Promise.resolve(mockTreeResponse()))
      .mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ not_sha: 'something_else' }),
        }),
      );

    const req = new Request(
      'http://localhost/api/github/public-scan?repo=vercel/next.js&type=tree',
    );
    const res = await GET(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.commit_sha).toBeUndefined();
  });

  it('should resolve file content correctly', async () => {
    mockFetch
      .mockImplementationOnce((url: string) => {
        expect(url).toBe('https://api.github.com/repos/vercel/next.js');
        return Promise.resolve(mockMetadata('canary'));
      })
      .mockImplementationOnce((url: string, options: RequestInit) => {
        expect(url).toBe(
          'https://api.github.com/repos/vercel/next.js/contents/package.json?ref=canary',
        );
        expect((options.headers as Record<string, string>).Accept).toBe(
          'application/vnd.github.raw+json',
        );
        return Promise.resolve({
          ok: true,
          text: () => Promise.resolve('{\n  "name": "next"\n}'),
        });
      });

    const req = new Request(
      'http://localhost/api/github/public-scan?repo=vercel/next.js&type=file&path=package.json',
    );
    const res = await GET(req);
    expect(res.status).toBe(200);

    const text = await res.text();
    expect(text).toBe('{\n  "name": "next"\n}');
  });

  it('should use GITHUB_PAT token in headers for both tree and commit requests', async () => {
    process.env.GITHUB_PAT = 'ghp_secretpat123';

    mockFetch
      .mockImplementationOnce((_url: string, options: RequestInit) => {
        expect((options.headers as Record<string, string>).Authorization).toBe(
          'Bearer ghp_secretpat123',
        );
        return Promise.resolve(mockMetadata());
      })
      .mockImplementationOnce((_url: URL, options: RequestInit) => {
        expect((options.headers as Record<string, string>).Authorization).toBe(
          'Bearer ghp_secretpat123',
        );
        return Promise.resolve(mockTreeResponse());
      })
      .mockImplementationOnce((_url: string, options: RequestInit) => {
        expect((options.headers as Record<string, string>).Authorization).toBe(
          'Bearer ghp_secretpat123',
        );
        return Promise.resolve(mockCommitResponse());
      });

    const req = new Request(
      'http://localhost/api/github/public-scan?repo=vercel/next.js&type=tree',
    );
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.commit_sha).toBe(MOCK_COMMIT_SHA);
  });

  it('should fall back to anonymous requests if no token is available', async () => {
    delete process.env.GITHUB_PAT;
    delete process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_APP_ID;

    mockFetch
      .mockImplementationOnce((_url: string, options: RequestInit) => {
        expect((options.headers as Record<string, string>).Authorization).toBeUndefined();
        return Promise.resolve(mockMetadata());
      })
      .mockImplementationOnce((_url: URL, options: RequestInit) => {
        expect((options.headers as Record<string, string>).Authorization).toBeUndefined();
        return Promise.resolve(mockTreeResponse({ tree: [] }));
      })
      .mockImplementationOnce((_url: string, options: RequestInit) => {
        expect((options.headers as Record<string, string>).Authorization).toBeUndefined();
        return Promise.resolve(mockCommitResponse());
      });

    const req = new Request(
      'http://localhost/api/github/public-scan?repo=vercel/next.js&type=tree',
    );
    const res = await GET(req);
    expect(res.status).toBe(200);
  });

  it('never exposes a private repository through the public endpoint', async () => {
    process.env.GITHUB_PAT = 'token-that-can-see-private-repositories';
    mockFetch.mockResolvedValueOnce(mockMetadata('main', true));

    const req = new Request(
      'http://localhost/api/github/public-scan?repo=owner/private&type=file&branch=main&path=secret.txt',
    );
    const res = await GET(req);
    expect(res.status).toBe(403);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('returns 404 with repo_not_found when GitHub returns 404', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

    const req = new Request(
      'http://localhost/api/github/public-scan?repo=nonexistent/repo&type=tree',
    );
    const res = await GET(req);
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error.code).toBe('repo_not_found');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('returns 429 with rate_limit_exceeded when GitHub returns 403 (unauthenticated rate limit)', async () => {
    delete process.env.GITHUB_PAT;
    delete process.env.GITHUB_TOKEN;

    mockFetch.mockResolvedValueOnce({ ok: false, status: 403 });

    const req = new Request(
      'http://localhost/api/github/public-scan?repo=vercel/next.js&type=tree',
    );
    const res = await GET(req);
    expect(res.status).toBe(429);
    const data = await res.json();
    expect(data.error.code).toBe('rate_limit_exceeded');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('returns 429 with rate_limit_exceeded when GitHub returns 429 (secondary rate limit)', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 429 });

    const req = new Request(
      'http://localhost/api/github/public-scan?repo=vercel/next.js&type=tree',
    );
    const res = await GET(req);
    expect(res.status).toBe(429);
    const data = await res.json();
    expect(data.error.code).toBe('rate_limit_exceeded');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('returns 502 with github_unavailable for unexpected GitHub errors', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

    const req = new Request(
      'http://localhost/api/github/public-scan?repo=vercel/next.js&type=tree',
    );
    const res = await GET(req);
    expect(res.status).toBe(502);
    const data = await res.json();
    expect(data.error.code).toBe('github_unavailable');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('returns 429 when the tree fetch itself hits a rate limit', async () => {
    mockFetch
      .mockResolvedValueOnce(mockMetadata())
      // tree and commit run in parallel; both need to resolve
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockResolvedValueOnce(mockCommitResponse());

    const req = new Request(
      'http://localhost/api/github/public-scan?repo=vercel/next.js&type=tree',
    );
    const res = await GET(req);
    expect(res.status).toBe(429);
    const data = await res.json();
    expect(data.error.code).toBe('rate_limit_exceeded');
  });

  it('uses the signed-in user GitHub token when the dashboard session is authenticated', async () => {
    const requireUserSpy = vi.spyOn(authModule, 'requireUser').mockResolvedValue({
      user: { id: 'user-1', name: 'Dev', email: 'dev@example.com', avatar_url: '' },
      accessToken: 'verified-session',
      githubAccessToken: 'gho_user-token',
      db: {} as never,
    });

    mockFetch
      .mockImplementationOnce((_url: string, options: RequestInit) => {
        expect((options.headers as Record<string, string>).Authorization).toBe(
          'Bearer gho_user-token',
        );
        return Promise.resolve(mockMetadata());
      })
      .mockImplementationOnce((_url: URL, options: RequestInit) => {
        expect((options.headers as Record<string, string>).Authorization).toBe(
          'Bearer gho_user-token',
        );
        return Promise.resolve(mockTreeResponse());
      })
      .mockImplementationOnce((_url: string, options: RequestInit) => {
        expect((options.headers as Record<string, string>).Authorization).toBe(
          'Bearer gho_user-token',
        );
        return Promise.resolve(mockCommitResponse());
      });

    const req = new Request(
      'http://localhost/api/github/public-scan?repo=vercel/next.js&type=tree',
      {
        headers: {
          cookie: `${authModule.COOKIE_NAME}=${encodeURIComponent(JSON.stringify({ accessToken: 'verified-session' }))}`,
        },
      },
    );
    const res = await GET(req);
    expect(res.status).toBe(200);
    requireUserSpy.mockRestore();
  });
});
