import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AutoFixAlreadyAppliedError } from './githubApp';
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

  it('commits using the blob SHA from an existing fix branch, not main', async () => {
    const fix = {
      statement: 'ASSURLY_CANARY_URL=https://assurly.dev/api/canary/token',
      description: 'Plant the silent alarm.',
      title: 'Plant Assurly silent alarm',
      targetFilePath: '.env.example',
      applyMode: 'append' as const,
    };
    const branchFileSha = 'b'.repeat(40);
    const mainFileSha = 'c'.repeat(40);

    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();

      if (url.includes('/git/ref/heads/main') && method === 'GET') {
        return new Response(JSON.stringify({ object: { sha: 'a'.repeat(40) } }), { status: 200 });
      }
      if (url.endsWith('/git/refs') && method === 'POST') {
        return new Response(JSON.stringify({ message: 'Reference already exists' }), {
          status: 422,
        });
      }
      if (url.includes('/git/ref/heads/') && method === 'GET') {
        return new Response(JSON.stringify({ object: { sha: 'd'.repeat(40) } }), { status: 200 });
      }
      if (url.includes('/contents/') && method === 'GET') {
        const ref = new URL(url).searchParams.get('ref');
        const sha = ref === 'main' ? mainFileSha : branchFileSha;
        const content = ref === 'main' ? 'FROM_MAIN=1\n' : 'FROM_BRANCH=1\n';
        return new Response(
          JSON.stringify({
            sha,
            content: Buffer.from(content).toString('base64'),
            encoding: 'base64',
          }),
          { status: 200 },
        );
      }
      if (url.includes('/contents/') && method === 'PUT') {
        const putBody = JSON.parse(String(init?.body));
        if (putBody.sha !== branchFileSha) {
          return new Response(
            JSON.stringify({ message: `.env.example does not match ${String(putBody.sha)}` }),
            { status: 409 },
          );
        }
        return new Response('{}', { status: 201 });
      }
      if (url.endsWith('/pulls') && method === 'POST') {
        return new Response(JSON.stringify({ html_url: 'https://github.com/acme/app/pull/7' }), {
          status: 201,
        });
      }
      return new Response(`unexpected ${method} ${url}`, { status: 500 });
    });

    const prUrl = await executeGitHubFixPullRequest({
      repositoryName: 'acme/app',
      baseBranch: 'main',
      filePath: '.env.example',
      fix,
      branchSeed: 'canary-plant:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      userGitHubToken: 'user-token',
      installationId: '140302856',
      repositoryId: 123,
    });

    expect(prUrl).toBe('https://github.com/acme/app/pull/7');

    const contentsGets = fetchMock.mock.calls.filter(([requestUrl, requestInit]) => {
      const requestMethod = (
        (requestInit as RequestInit | undefined)?.method ?? 'GET'
      ).toUpperCase();
      return String(requestUrl).includes('/contents/') && requestMethod === 'GET';
    });
    expect(contentsGets.length).toBeGreaterThan(0);
    expect(String(contentsGets[0]?.[0])).toContain('ref=');
    expect(String(contentsGets[0]?.[0])).not.toMatch(/ref=main(?:&|$)/);

    const putCall = fetchMock.mock.calls.find(
      ([, requestInit]) => (requestInit as RequestInit | undefined)?.method === 'PUT',
    );
    expect(putCall).toBeDefined();
    const putBody = JSON.parse(String((putCall?.[1] as RequestInit).body));
    expect(putBody.sha).toBe(branchFileSha);
    const committed = Buffer.from(putBody.content, 'base64').toString('utf8');
    expect(committed).toContain('FROM_BRANCH=1');
    expect(committed).toContain('ASSURLY_CANARY_URL=https://assurly.dev/api/canary/token');
  });

  it('upsert-env replaces a leftover canary on the fix branch when main does not have the key', async () => {
    const fix = {
      statement: 'ASSURLY_CANARY_URL=https://assurly.dev/api/canary/new',
      description: 'Plant the silent alarm.',
      title: 'Plant Assurly silent alarm',
      targetFilePath: '.env.example',
      applyMode: 'upsert-env' as const,
    };
    const branchFileSha = 'b'.repeat(40);

    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();

      if (url.includes('/git/ref/heads/main') && method === 'GET') {
        return new Response(JSON.stringify({ object: { sha: 'a'.repeat(40) } }), { status: 200 });
      }
      if (url.endsWith('/git/refs') && method === 'POST') {
        return new Response(JSON.stringify({ message: 'Reference already exists' }), {
          status: 422,
        });
      }
      if (url.includes('/git/ref/heads/') && method === 'GET') {
        return new Response(JSON.stringify({ object: { sha: 'd'.repeat(40) } }), { status: 200 });
      }
      if (url.includes('/contents/') && method === 'GET') {
        const ref = new URL(url).searchParams.get('ref');
        const content =
          ref === 'main'
            ? 'PORT=3000\n'
            : 'ASSURLY_CANARY_URL=https://assurly.dev/api/canary/old\n';
        const sha = ref === 'main' ? 'c'.repeat(40) : branchFileSha;
        return new Response(
          JSON.stringify({
            sha,
            content: Buffer.from(content).toString('base64'),
            encoding: 'base64',
          }),
          { status: 200 },
        );
      }
      if (url.includes('/contents/') && method === 'PUT') {
        return new Response('{}', { status: 201 });
      }
      if (url.endsWith('/pulls') && method === 'POST') {
        return new Response(JSON.stringify({ html_url: 'https://github.com/acme/app/pull/8' }), {
          status: 201,
        });
      }
      return new Response(`unexpected ${method} ${url}`, { status: 500 });
    });

    const prUrl = await executeGitHubFixPullRequest({
      repositoryName: 'acme/app',
      baseBranch: 'main',
      filePath: '.env.example',
      fix,
      branchSeed: 'canary-plant:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      userGitHubToken: 'user-token',
      installationId: '140302856',
      repositoryId: 123,
    });

    expect(prUrl).toBe('https://github.com/acme/app/pull/8');
    const putCall = fetchMock.mock.calls.find(
      ([, requestInit]) => (requestInit as RequestInit | undefined)?.method === 'PUT',
    );
    const putBody = JSON.parse(String((putCall?.[1] as RequestInit).body));
    const committed = Buffer.from(putBody.content, 'base64').toString('utf8');
    expect(committed).toContain('ASSURLY_CANARY_URL=https://assurly.dev/api/canary/new');
    expect(committed).not.toContain('/old');
  });

  it('upsert-env is a no-op when main already documents the env key', async () => {
    const fix = {
      statement: 'ASSURLY_CANARY_URL=https://assurly.dev/api/canary/new',
      description: 'Plant the silent alarm.',
      title: 'Plant Assurly silent alarm',
      targetFilePath: '.env.example',
      applyMode: 'upsert-env' as const,
    };

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
        return new Response(
          JSON.stringify({
            sha: 'b'.repeat(40),
            content: Buffer.from(
              'ASSURLY_CANARY_URL=https://assurly.dev/api/canary/live\n',
            ).toString('base64'),
            encoding: 'base64',
          }),
          { status: 200 },
        );
      }
      return new Response(`unexpected ${method} ${url}`, { status: 500 });
    });

    await expect(
      executeGitHubFixPullRequest({
        repositoryName: 'acme/app',
        baseBranch: 'main',
        filePath: '.env.example',
        fix,
        branchSeed: 'canary-plant:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        userGitHubToken: 'user-token',
        installationId: '140302856',
        repositoryId: 123,
      }),
    ).rejects.toBeInstanceOf(AutoFixAlreadyAppliedError);

    const putCall = fetchMock.mock.calls.find(
      ([, requestInit]) => (requestInit as RequestInit | undefined)?.method === 'PUT',
    );
    expect(putCall).toBeUndefined();
  });
});
