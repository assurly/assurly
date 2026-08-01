import { clientApi } from './clientApi';
import type { Scan } from './dbAdapter';

type ScansPayload = { scans: Scan[] };

type CacheEntry = {
  at: number;
  data: ScansPayload;
};

/** Short TTL absorbs React Strict Mode remounts and burst re-renders. */
const CACHE_TTL_MS = 2_000;

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<ScansPayload>>();

export type LoadRepoScansOptions = {
  /** Bypass the short TTL cache (visibility regain, post-mutation). */
  force?: boolean;
  /** Injectable fetcher for tests. */
  fetcher?: (repositoryId: string) => Promise<ScansPayload>;
};

/**
 * Deduped `/api/scans?repoId=` loader for the dashboard.
 *
 * Concurrent callers for the same repo share one in-flight promise. A short
 * positive cache prevents Strict Mode double-mount and effect thrash from
 * hammering Supabase. Mutations must call `invalidateRepoScansCache`.
 */
export async function loadRepoScans(
  repositoryId: string,
  options: LoadRepoScansOptions = {},
): Promise<ScansPayload> {
  const force = options.force === true;
  const fetcher = options.fetcher ?? ((id: string) => clientApi.scans(id));

  if (!force) {
    const hit = cache.get(repositoryId);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
      return hit.data;
    }
  }

  // Concurrent callers (Strict Mode remount, prefetch + select) share one trip.
  const pending = inflight.get(repositoryId);
  if (pending) return pending;

  const request = fetcher(repositoryId)
    .then((data) => {
      cache.set(repositoryId, { at: Date.now(), data });
      return data;
    })
    .finally(() => {
      if (inflight.get(repositoryId) === request) {
        inflight.delete(repositoryId);
      }
    });

  inflight.set(repositoryId, request);
  return request;
}

export function invalidateRepoScansCache(repositoryId?: string): void {
  if (repositoryId) {
    cache.delete(repositoryId);
    inflight.delete(repositoryId);
    return;
  }
  cache.clear();
  inflight.clear();
}

/** Test-only: wipe cache + inflight without importing vitest here. */
export function __resetScansQueryCacheForTests(): void {
  invalidateRepoScansCache();
}
