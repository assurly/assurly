import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  NPM_CACHE_TTL_MS,
  lookupNpmPackage,
  lookupNpmPackages,
  npmDownloadsUrlForPackage,
  npmRegistryUrlForPackage,
  type NpmRegistryCacheStore,
} from './npmRegistry';

function memoryCache(
  seed: Map<string, Awaited<ReturnType<NpmRegistryCacheStore['get']>>> = new Map(),
): NpmRegistryCacheStore & { store: typeof seed } {
  const store = seed;
  return {
    store,
    async get(packageName) {
      return store.get(packageName) ?? null;
    },
    async upsert(entry) {
      store.set(entry.packageName, {
        packageName: entry.packageName,
        existsOnRegistry: entry.existsOnRegistry,
        createdAtRegistry: entry.createdAtRegistry,
        weeklyDownloads: entry.weeklyDownloads,
        versionCount: entry.versionCount,
        hasRepository: entry.hasRepository,
        metadataFetchedAt: entry.metadataFetchedAt ?? new Date().toISOString(),
        downloadsFetchedAt: entry.downloadsFetchedAt ?? null,
      });
    },
  };
}

describe('npmRegistry URL discipline', () => {
  it('only builds URLs on the fixed npm hosts', () => {
    expect(npmRegistryUrlForPackage('lodash')).toBe('https://registry.npmjs.org/lodash');
    expect(npmRegistryUrlForPackage('@scope/pkg')).toBe(
      'https://registry.npmjs.org/%40scope%2Fpkg',
    );
    expect(npmDownloadsUrlForPackage('lodash')).toBe(
      'https://api.npmjs.org/downloads/point/last-week/lodash',
    );
  });
});

describe('lookupNpmPackage', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('maps registry 404 to exists=false', async () => {
    const fetchImpl = vi.fn(async () => new Response('Not Found', { status: 404 }));
    const result = await lookupNpmPackage('react-codeshift', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      totalBudgetMs: 10_000,
    });
    expect(result.exists).toBe(false);
    expect(result.unavailable).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('parses created time, version shape, repository presence, and weekly downloads', async () => {
    const created = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('registry.npmjs.org')) {
        return new Response(
          JSON.stringify({
            time: { created },
            versions: { '1.0.0': {} },
            repository: null,
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ downloads: 42 }), { status: 200 });
    });
    const result = await lookupNpmPackage('some-pkg', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.exists).toBe(true);
    expect(result.ageDays).toBe(5);
    expect(result.weeklyDownloads).toBe(42);
    expect(result.versionCount).toBe(1);
    expect(result.hasRepository).toBe(false);
  });

  it('treats malformed registry JSON as unavailable', async () => {
    const fetchImpl = vi.fn(async () => new Response('not-json', { status: 200 }));
    const result = await lookupNpmPackage('weird', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    // response.json() throws → unavailable
    expect(result.exists).toBeNull();
    expect(result.unavailable).toBe(true);
  });

  it('returns unavailable on timeout/abort', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      return await new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) {
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          return;
        }
        signal?.addEventListener('abort', () => {
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        });
      });
    });
    const result = await lookupNpmPackage('slow-pkg', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      requestTimeoutMs: 20,
      totalBudgetMs: 50,
    });
    expect(result.exists).toBeNull();
    expect(result.unavailable).toBe(true);
  });

  it('serves a fresh cache hit without network', async () => {
    const now = Date.now();
    const cache = memoryCache(
      new Map([
        [
          'lodash',
          {
            packageName: 'lodash',
            existsOnRegistry: true,
            createdAtRegistry: new Date(now - 400 * 24 * 60 * 60 * 1000).toISOString(),
            weeklyDownloads: 50_000_000,
            versionCount: 100,
            hasRepository: true,
            metadataFetchedAt: new Date(now - 1000).toISOString(),
            downloadsFetchedAt: new Date(now - 1000).toISOString(),
          },
        ],
      ]),
    );
    const fetchImpl = vi.fn();
    const result = await lookupNpmPackage('lodash', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      cache,
      now: () => now,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.exists).toBe(true);
    expect(result.weeklyDownloads).toBe(50_000_000);
  });

  it('refetches after cache TTL expiry', async () => {
    const now = Date.now();
    const cache = memoryCache(
      new Map([
        [
          'axios',
          {
            packageName: 'axios',
            existsOnRegistry: true,
            createdAtRegistry: new Date(now - 1000 * 24 * 60 * 60 * 1000).toISOString(),
            weeklyDownloads: 1,
            versionCount: 50,
            hasRepository: true,
            metadataFetchedAt: new Date(now - NPM_CACHE_TTL_MS - 1).toISOString(),
            downloadsFetchedAt: new Date(now - NPM_CACHE_TTL_MS - 1).toISOString(),
          },
        ],
      ]),
    );
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('registry.npmjs.org')) {
        return new Response(JSON.stringify({ time: { created: '2014-01-01T00:00:00.000Z' } }), {
          status: 200,
        });
      }
      return new Response(JSON.stringify({ downloads: 99 }), { status: 200 });
    });
    const result = await lookupNpmPackage('axios', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      cache,
      now: () => now,
    });
    expect(fetchImpl).toHaveBeenCalled();
    expect(result.weeklyDownloads).toBe(99);
  });
});

describe('lookupNpmPackages budget', () => {
  it('marks remaining packages unavailable when the total budget is exhausted', async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 30));
      return new Response('Not Found', { status: 404 });
    });
    const results = await lookupNpmPackages(['a', 'b', 'c'], {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      requestTimeoutMs: 100,
      totalBudgetMs: 40,
    });
    expect(results).toHaveLength(3);
    expect(results.some((r) => r.unavailable)).toBe(true);
    expect(calls).toBeLessThan(3);
  });
});
