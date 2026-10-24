import { generateKeyPairSync } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearInstallationTokenCache,
  fetchGitHubFilesBatch,
  forgetInstallationTokens,
  getInstallationAccessToken,
  getGitHubServerPat,
  githubHeaders,
  listGitHubBranchNames,
  readLimitedResponseText,
} from './githubApp';

describe('readLimitedResponseText', () => {
  /**
   * Builds an oversized response whose underlying source never settles `cancel()`.
   * This is how the body behaves in production: Next.js patches `fetch` and `tee()`s
   * the response, and cancelling one branch of a tee never releases the source.
   */
  function neverCancellingResponse(): Response {
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(1024));
      },
      cancel() {
        return new Promise<never>(() => {});
      },
    });
    return new Response(stream);
  }

  it('rejects over the size limit even when the stream cancel never settles', async () => {
    const outcome = await Promise.race([
      readLimitedResponseText(neverCancellingResponse(), 2048).then(
        () => 'resolved',
        (error: Error) => `rejected: ${error.message}`,
      ),
      new Promise<string>((resolve) => setTimeout(() => resolve('HUNG'), 1000)),
    ]);

    expect(outcome).toBe('rejected: GitHub response exceeds the configured size limit.');
  });

  it('returns the body when it stays under the limit', async () => {
    const response = new Response('{"tree":[]}');
    await expect(readLimitedResponseText(response, 2048)).resolves.toBe('{"tree":[]}');
  });
});

describe('fetchGitHubFilesBatch', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('fetches each unique path once and returns them in order', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input).match(/\/contents\/(.+)\?ref=/)?.[1] ?? '';
      return new Response(`content:${decodeURIComponent(path)}`, { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    // A duplicate path must not be fetched twice.
    const files = await fetchGitHubFilesBatch(
      'tok',
      'owner/repo',
      ['a.ts', 'b.ts', 'a.ts'],
      'main',
    );

    expect(files).toEqual([
      { path: 'a.ts', content: 'content:a.ts' },
      { path: 'b.ts', content: 'content:b.ts' },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns null for a file that fails to fetch without failing the batch', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).includes('/contents/ok.ts?ref=')
          ? new Response('ok', { status: 200 })
          : new Response('nope', { status: 404 }),
      ),
    );

    const files = await fetchGitHubFilesBatch('tok', 'owner/repo', ['ok.ts', 'missing.ts'], 'main');
    expect(files).toEqual([
      { path: 'ok.ts', content: 'ok' },
      { path: 'missing.ts', content: null },
    ]);
  });

  it('never runs more than `concurrency` fetches at once', async () => {
    let inFlight = 0;
    let peak = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return new Response('x', { status: 200 });
      }),
    );

    const paths = Array.from({ length: 20 }, (_, i) => `f${i}.ts`);
    await fetchGitHubFilesBatch('tok', 'owner/repo', paths, 'main', { concurrency: 4 });
    expect(peak).toBeLessThanOrEqual(4);
  });
});

describe('getGitHubServerPat', () => {
  afterEach(() => {
    delete process.env.GITHUB_PAT;
    delete process.env.GITHUB_TOKEN;
  });

  it('prefers GITHUB_PAT over GITHUB_TOKEN', () => {
    process.env.GITHUB_PAT = 'ghp_primary';
    process.env.GITHUB_TOKEN = 'ghp_secondary';
    expect(getGitHubServerPat()).toBe('ghp_primary');
  });

  it('falls back to GITHUB_TOKEN when GITHUB_PAT is unset', () => {
    process.env.GITHUB_TOKEN = 'ghp_fallback';
    expect(getGitHubServerPat()).toBe('ghp_fallback');
  });

  it('returns undefined when no server token is configured', () => {
    expect(getGitHubServerPat()).toBeUndefined();
  });
});

describe('listGitHubBranchNames', () => {
  it('returns branch names from the first page', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify([{ name: 'src' }, { name: 'main' }]), { status: 200 }),
      );
    await expect(
      listGitHubBranchNames('owner/repo', githubHeaders('tok'), fetchImpl),
    ).resolves.toEqual(['src', 'main']);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
      'https://api.github.com/repos/owner/repo/branches?per_page=100',
    );
  });
});

describe('getInstallationAccessToken', () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const MINUTE = 60_000;
  let minted = 0;

  /** GitHub's token endpoint: a fresh token per call, valid for an hour. */
  function stubTokenEndpoint(status = 201): ReturnType<typeof vi.fn> {
    const fetchMock = vi.fn(async () => {
      if (status !== 201) return new Response('{}', { status });
      minted += 1;
      return Response.json(
        {
          token: `ghs_token_${minted}`,
          expires_at: new Date(Date.now() + 60 * MINUTE).toISOString(),
        },
        { status: 201 },
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  beforeEach(() => {
    minted = 0;
    clearInstallationTokenCache();
    vi.stubEnv('GITHUB_APP_ID', '12345');
    vi.stubEnv('GITHUB_PRIVATE_KEY', privateKey.export({ type: 'pkcs1', format: 'pem' }) as string);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('reuses a token for the same installation and repository', async () => {
    const fetchMock = stubTokenEndpoint();
    const first = await getInstallationAccessToken('42', 7);
    const second = await getInstallationAccessToken('42', 7);
    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never hands a token scoped to one repository to another', async () => {
    const fetchMock = stubTokenEndpoint();
    const repoSeven = await getInstallationAccessToken('42', 7);
    const repoEight = await getInstallationAccessToken('42', 8);
    const wholeInstallation = await getInstallationAccessToken('42');
    expect(new Set([repoSeven, repoEight, wholeInstallation]).size).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(JSON.parse(String(fetchMock.mock.calls[1][1].body))).toEqual({ repository_ids: [8] });
  });

  it('mints once for concurrent requests', async () => {
    const fetchMock = stubTokenEndpoint();
    const tokens = await Promise.all([1, 2, 3].map(() => getInstallationAccessToken('42', 7)));
    expect(new Set(tokens).size).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('mints a new token after ten minutes, so changed permissions apply soon', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const fetchMock = stubTokenEndpoint();
    await getInstallationAccessToken('42', 7);
    vi.setSystemTime(Date.now() + 9 * MINUTE);
    await getInstallationAccessToken('42', 7);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 2 * MINUTE);
    await getInstallationAccessToken('42', 7);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('forgets only the installation GitHub reported a change for', async () => {
    const fetchMock = stubTokenEndpoint();
    await getInstallationAccessToken('42', 7);
    await getInstallationAccessToken('99', 7);
    forgetInstallationTokens('42');
    await getInstallationAccessToken('42', 7);
    await getInstallationAccessToken('99', 7);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not remember a failure', async () => {
    stubTokenEndpoint(404);
    await expect(getInstallationAccessToken('42', 7)).rejects.toThrow(/404/);
    const fetchMock = stubTokenEndpoint();
    await expect(getInstallationAccessToken('42', 7)).resolves.toBe('ghs_token_1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
