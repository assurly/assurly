import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildGitHubAutoFix } from './githubAutoFix';
import { executeGitHubFixPullRequest } from './githubFixPipeline';

const mocks = vi.hoisted(() => ({
  resolveGitHubWriteTarget: vi.fn(),
}));

vi.mock('./githubApp', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./githubApp')>();
  return {
    ...actual,
    resolveGitHubWriteTarget: mocks.resolveGitHubWriteTarget,
  };
});

describe('executeGitHubFixPullRequest', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    mocks.resolveGitHubWriteTarget.mockResolvedValue({
      token: 'user-token',
      commitRepositoryName: 'acme/app',
      pullRequestRepositoryName: 'acme/app',
      pullRequestHeadOwner: 'acme',
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates a new RLS migration when the target file does not exist yet (append + 404)', async () => {
    const fix = buildGitHubAutoFix(
      'db/migrations/003_create_auth_schema.up.sql',
      "Database table 'organizations' is created but Row-Level Security (RLS) is not enabled.",
    );
    expect(fix).toBeTruthy();
    if (!fix) return;

    // Single-fix previously treated a missing append target as "repo unavailable".
    // New RLS migrations intentionally do not exist on the base branch yet.
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();

      if (url.includes('/git/ref/heads/main') && method === 'GET') {
        return new Response(JSON.stringify({ object: { sha: 'a'.repeat(40) } }), { status: 200 });
      }
      if (url.endsWith('/git/refs') && method === 'POST') {
        return new Response('{}', { status: 201 });
      }
      if (url.includes('/contents/') && method === 'GET') {
        return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
      }
      if (url.includes('/contents/') && method === 'PUT') {
        return new Response('{}', { status: 201 });
      }
      if (url.endsWith('/pulls') && method === 'POST') {
        return new Response(JSON.stringify({ html_url: 'https://github.com/acme/app/pull/42' }), {
          status: 201,
        });
      }
      return new Response(`unexpected ${method} ${url}`, { status: 500 });
    });

    const prUrl = await executeGitHubFixPullRequest({
      repositoryName: 'acme/app',
      baseBranch: 'main',
      filePath: 'db/migrations/003_create_auth_schema.up.sql',
      fix,
      branchSeed: 'finding-1',
      userGitHubToken: 'user-token',
      installationId: '140302856',
      repositoryId: 123,
    });

    expect(prUrl).toBe('https://github.com/acme/app/pull/42');

    const putCall = fetchMock.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === 'PUT',
    );
    expect(putCall).toBeDefined();
    const putUrl = String(putCall?.[0]);
    expect(putUrl).toContain('99999999999999_assurly_enable_rls.up.sql');

    const putBody = JSON.parse(String((putCall?.[1] as RequestInit).body));
    const committed = Buffer.from(putBody.content, 'base64').toString('utf8');
    expect(committed).toContain('ALTER TABLE "organizations" ENABLE ROW LEVEL SECURITY;');
    expect(putBody.sha).toBeUndefined();
  });
});
