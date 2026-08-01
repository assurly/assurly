import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  __resetScansQueryCacheForTests,
  invalidateRepoScansCache,
  loadRepoScans,
} from './scansQueryCache';
import type { Scan } from './dbAdapter';

afterEach(() => {
  __resetScansQueryCacheForTests();
});

function scan(id: string): Scan {
  return {
    id,
    repository_id: 'repo-1',
    commit_sha: 'abc',
    branch: 'main',
    status: 'success',
    error_count: 0,
    warning_count: 0,
    created_at: '2026-07-30T00:00:00.000Z',
  };
}

describe('loadRepoScans', () => {
  it('dedupes concurrent callers for the same repoId into one fetch', async () => {
    let resolveFetch!: (value: { scans: Scan[] }) => void;
    const fetcher = vi.fn(
      () =>
        new Promise<{ scans: Scan[] }>((resolve) => {
          resolveFetch = resolve;
        }),
    );

    const a = loadRepoScans('repo-1', { fetcher });
    const b = loadRepoScans('repo-1', { fetcher });
    expect(fetcher).toHaveBeenCalledTimes(1);

    resolveFetch({ scans: [scan('s1')] });
    await expect(a).resolves.toEqual({ scans: [scan('s1')] });
    await expect(b).resolves.toEqual({ scans: [scan('s1')] });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('serves a short TTL cache hit without refetching', async () => {
    const fetcher = vi.fn(async () => ({ scans: [scan('s1')] }));
    await loadRepoScans('repo-1', { fetcher });
    await loadRepoScans('repo-1', { fetcher });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('force bypasses the cache', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ scans: [scan('s1')] })
      .mockResolvedValueOnce({ scans: [scan('s2')] });

    await loadRepoScans('repo-1', { fetcher });
    const second = await loadRepoScans('repo-1', { fetcher, force: true });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(second.scans[0]?.id).toBe('s2');
  });

  it('invalidateRepoScansCache clears the TTL entry', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ scans: [scan('s1')] })
      .mockResolvedValueOnce({ scans: [scan('s2')] });

    await loadRepoScans('repo-1', { fetcher });
    invalidateRepoScansCache('repo-1');
    const again = await loadRepoScans('repo-1', { fetcher });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(again.scans[0]?.id).toBe('s2');
  });
});
