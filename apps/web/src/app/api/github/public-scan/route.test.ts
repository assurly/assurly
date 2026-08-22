import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import * as authModule from '../../../../utils/auth';
import { GET, POST } from './route';
import { clearInstantGateTreeCacheForTests } from '../../../../utils/instantGateTree';
import { INSTANT_GATE_MAX_FILES } from '@assurly/scanner-core';

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

function mockTreeResponse(tree: { tree: unknown[] } = MOCK_TREE) {
  return new Response(JSON.stringify(tree), { status: 200 });
}

function mockCommitResponse(sha = MOCK_COMMIT_SHA) {
  return {
    ok: true,
    json: () => Promise.resolve({ sha }),
  };
}

function hrefOf(input: RequestInfo | URL): string {
  return String(input);
}

function mockPublicGitHub(
  options: {
    repo?: string;
    branch?: string;
    isPrivate?: boolean;
    commitSha?: string | false;
    tree?: { tree: unknown[] };
    treeResponse?: (href: string) => Response | ReturnType<typeof mockMetadata>;
    inspect?: (href: string, init?: RequestInit) => void;
  } = {},
): void {
  const repo = options.repo ?? 'vercel/next.js';
  const branch = options.branch ?? 'main';
  mockFetch.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const href = hrefOf(input);
    options.inspect?.(href, init);
    if (href === `https://api.github.com/repos/${repo}`) {
      return Promise.resolve(mockMetadata(branch, options.isPrivate ?? false));
    }
    if (href.includes('/commits/')) {
      if (options.commitSha === false) {
        return Promise.resolve(new Response(null, { status: 403 }));
      }
      return Promise.resolve(mockCommitResponse(options.commitSha || MOCK_COMMIT_SHA));
    }
    if (href.includes('/git/trees/')) {
      if (options.treeResponse) {
        return Promise.resolve(options.treeResponse(href));
      }
      return Promise.resolve(mockTreeResponse(options.tree ?? MOCK_TREE));
    }
    return Promise.resolve({ ok: false, status: 404 });
  });
}

describe('GitHub Public Scan Proxy (GET /api/github/public-scan)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    process.env = { ...originalEnv };
    clearInstantGateTreeCacheForTests();
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
    mockPublicGitHub({ branch: 'canary' });

    const req = new Request(
      'http://localhost/api/github/public-scan?repo=vercel/next.js&type=tree',
    );
    const res = await GET(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.default_branch).toBe('canary');
    expect(data.tree.map((entry: { path: string }) => entry.path).sort()).toEqual([
      'package.json',
      'schema.sql',
    ]);
    expect(data.tree[0].sha).toBeUndefined();
    expect(data.tree[0].url).toBeUndefined();
    expect(data.commit_sha).toBe(MOCK_COMMIT_SHA);
    expect(res.headers.get('cache-control')).toContain('max-age=60');
  });

  it('should include commit_sha when an explicit branch is provided', async () => {
    const sha = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
    mockPublicGitHub({ commitSha: sha });

    const req = new Request(
      'http://localhost/api/github/public-scan?repo=vercel/next.js&type=tree&branch=stable',
    );
    const res = await GET(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.commit_sha).toBe(sha);
    expect(data.default_branch).toBe('stable');
  });

  it('returns branch names for type=branches', async () => {
    mockFetch.mockImplementation((input: RequestInfo | URL) => {
      const href = hrefOf(input);
      if (href === 'https://api.github.com/repos/vercel/next.js') {
        return Promise.resolve(mockMetadata('canary'));
      }
      if (href.includes('/repos/vercel/next.js/branches')) {
        return Promise.resolve(
          new Response(JSON.stringify([{ name: 'canary' }, { name: 'main' }]), { status: 200 }),
        );
      }
      return Promise.resolve({ ok: false, status: 404 });
    });

    const req = new Request(
      'http://localhost/api/github/public-scan?repo=vercel/next.js&type=branches',
    );
    const res = await GET(req);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      default_branch: 'canary',
      branches: ['canary', 'main'],
    });
  });

  it('should omit commit_sha (undefined) when commit fetch fails — scan still succeeds', async () => {
    mockPublicGitHub({ commitSha: false });

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
    mockFetch.mockImplementation((input: RequestInfo | URL) => {
      const href = String(input);
      if (href === 'https://api.github.com/repos/vercel/next.js') {
        return Promise.resolve(mockMetadata());
      }
      if (href.includes('/commits/')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ not_sha: 'something_else' }),
        });
      }
      if (href.includes('/git/trees/')) {
        return Promise.resolve(mockTreeResponse());
      }
      return Promise.resolve({ ok: false, status: 404 });
    });

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
    mockPublicGitHub({
      inspect: (_href, init) => {
        expect((init?.headers as Record<string, string>).Authorization).toBe(
          'Bearer ghp_secretpat123',
        );
      },
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

    mockPublicGitHub({
      inspect: (_href, init) => {
        expect((init?.headers as Record<string, string>).Authorization).toBeUndefined();
      },
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

  // A repository the browser scan cannot ingest is an expected outcome, not a server
  // fault. Reporting it as a 500 "Internal server error" told the user nothing and hid
  // a known limit behind an opaque failure.
  it('returns 413 repository_too_large when the tree body exceeds the size limit', async () => {
    const oversized = 'x'.repeat(2 * 1024 * 1024 + 1);
    mockPublicGitHub({
      repo: 'vercel/ai',
      treeResponse: () => new Response(oversized, { status: 200 }),
    });

    const req = new Request('http://localhost/api/github/public-scan?repo=vercel/ai&type=tree');
    const res = await GET(req);

    expect(res.status).toBe(413);
    const data = await res.json();
    expect(data.error.code).toBe('repository_too_large');
    expect(data.error.message).toMatch(/too large/i);
  });

  it('returns 413 repository_too_large when the tree has more entries than the schema allows', async () => {
    const tree = {
      tree: Array.from({ length: 5001 }, (_, index) => ({
        path: `src/file-${index}.ts`,
        type: 'blob',
      })),
    };
    mockPublicGitHub({ repo: 'vercel/ai', tree });

    const req = new Request('http://localhost/api/github/public-scan?repo=vercel/ai&type=tree');
    const res = await GET(req);

    expect(res.status).toBe(413);
    const data = await res.json();
    expect(data.error.code).toBe('repository_too_large');
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
    mockPublicGitHub({
      treeResponse: () => new Response(null, { status: 429 }),
    });

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

    mockPublicGitHub({
      inspect: (_href, init) => {
        expect((init?.headers as Record<string, string>).Authorization).toBe(
          'Bearer gho_user-token',
        );
      },
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

  it('does not recurse the whole repository when apps/ is at the root', async () => {
    const recursiveUrls: string[] = [];
    mockPublicGitHub({
      treeResponse: (href) => {
        if (href.includes('recursive=1')) {
          recursiveUrls.push(href);
          if (href.includes('apps-sha')) {
            return mockTreeResponse({
              tree: [
                {
                  path: 'web/src/app/page.tsx',
                  type: 'blob',
                  sha: 'x',
                  url: 'https://api.github.com/repos/vercel/next.js/git/blobs/x',
                },
              ],
            });
          }
          throw new Error(`unexpected recursive tree: ${href}`);
        }
        return mockTreeResponse({
          tree: [{ path: 'apps', type: 'tree', sha: 'apps-sha' }],
        });
      },
    });

    const res = await GET(
      new Request('http://localhost/api/github/public-scan?repo=vercel/next.js&type=tree'),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.tree.map((entry: { path: string }) => entry.path)).toEqual([
      'apps/web/src/app/page.tsx',
    ]);
    expect(data.tree[0].sha).toBeUndefined();
    expect(recursiveUrls.some((url) => url.includes('/git/trees/main?recursive=1'))).toBe(false);
    expect(recursiveUrls.some((url) => url.includes('apps-sha'))).toBe(true);
  });

  it('serves a repeated tree request from memory without a second GitHub tree fetch', async () => {
    mockPublicGitHub({ branch: 'canary' });
    const treeRequest = (): Request =>
      new Request('http://localhost/api/github/public-scan?repo=vercel/next.js&type=tree');

    const first = await GET(treeRequest());
    expect(first.status).toBe(200);
    const treeFetchesAfterFirst = mockFetch.mock.calls.filter((call) =>
      String(call[0]).includes('/git/trees/'),
    ).length;
    expect(treeFetchesAfterFirst).toBeGreaterThan(0);

    const second = await GET(treeRequest());
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(await first.json());
    const treeFetchesAfterSecond = mockFetch.mock.calls.filter((call) =>
      String(call[0]).includes('/git/trees/'),
    ).length;
    expect(treeFetchesAfterSecond).toBe(treeFetchesAfterFirst);
  });
});

describe('GitHub Public Scan batch read (POST /api/github/public-scan)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  function batchRequest(body: unknown): Request {
    return new Request('http://localhost/api/github/public-scan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('fetches every requested file in one response', async () => {
    const contents: Record<string, string> = {
      'package.json': '{"name":"app"}',
      'schema.sql': 'CREATE TABLE users (id uuid);',
    };
    // URL-routed mock so it is robust to the batch's concurrent fetch order.
    mockFetch.mockImplementation((url: string | URL) => {
      const href = String(url);
      if (href === 'https://api.github.com/repos/owner/app') {
        return Promise.resolve(mockMetadata('main'));
      }
      const match = href.match(/\/contents\/(.+)\?ref=main$/);
      if (match) {
        const path = decodeURIComponent(match[1]);
        return Promise.resolve({ ok: true, text: () => Promise.resolve(contents[path] ?? '') });
      }
      return Promise.resolve({ ok: false, status: 404 });
    });

    const res = await POST(batchRequest({ repo: 'owner/app', paths: Object.keys(contents) }));
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
    expect(byPath['schema.sql']).toBe('CREATE TABLE users (id uuid);');
  });

  it('returns null for an unreadable file instead of failing the batch', async () => {
    mockFetch.mockImplementation((url: string | URL) => {
      const href = String(url);
      if (href === 'https://api.github.com/repos/owner/app') {
        return Promise.resolve(mockMetadata('main'));
      }
      if (href.includes('/contents/ok.ts?ref=main')) {
        return Promise.resolve({ ok: true, text: () => Promise.resolve('export const ok = 1;') });
      }
      // gone.ts fails the GitHub fetch.
      return Promise.resolve({ ok: false, status: 404 });
    });

    const res = await POST(batchRequest({ repo: 'owner/app', paths: ['ok.ts', 'gone.ts'] }));
    expect(res.status).toBe(200);
    const data = await res.json();
    const byPath = Object.fromEntries(
      (data.files as Array<{ path: string; content: string | null }>).map((f) => [
        f.path,
        f.content,
      ]),
    );
    expect(byPath['ok.ts']).toBe('export const ok = 1;');
    expect(byPath['gone.ts']).toBeNull();
  });

  it('rejects a private repository', async () => {
    mockFetch.mockImplementation(() => Promise.resolve(mockMetadata('main', true)));
    const res = await POST(batchRequest({ repo: 'owner/private', paths: ['a.ts'] }));
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error.code).toBe('private_repository');
  });

  it('rejects a malformed body', async () => {
    const res = await POST(batchRequest({ repo: 'owner/app' }));
    expect(res.status).toBe(400);
  });

  it('accepts Instant Gate file budgets up to INSTANT_GATE_MAX_FILES', async () => {
    const paths = Array.from({ length: INSTANT_GATE_MAX_FILES }, (_, index) => `src/f-${index}.ts`);
    mockFetch.mockImplementation((url: string | URL) => {
      const href = String(url);
      if (href === 'https://api.github.com/repos/owner/app') {
        return Promise.resolve(mockMetadata('main'));
      }
      if (href.includes('/contents/')) {
        return Promise.resolve({ ok: true, text: () => Promise.resolve('export {};') });
      }
      return Promise.resolve({ ok: false, status: 404 });
    });

    const res = await POST(batchRequest({ repo: 'owner/app', paths }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.files).toHaveLength(INSTANT_GATE_MAX_FILES);
  });
});
