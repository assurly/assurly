/**
 * npm registry client for dependency provenance checks.
 *
 * Hard constraints (do not weaken):
 *   - Fixed hosts only: registry.npmjs.org and api.npmjs.org.
 *     Never take a registry URL from repo content (SSRF wearing a config file).
 *   - Per-request timeout (~3s) and a shared total budget for the PR.
 *   - Degrade, never throw for "npm is down" — callers emit
 *     dep-registry-unavailable and continue.
 *   - Outbound URLs are asserted via assertScannableUrl before fetch.
 */
import { assertScannableUrl, UrlSafetyError } from './urlSafety';

export const NPM_REGISTRY_HOST = 'registry.npmjs.org';
export const NPM_DOWNLOADS_HOST = 'api.npmjs.org';

/** Per-request timeout for a single registry/downloads call. */
export const NPM_REQUEST_TIMEOUT_MS = 3_000;
/** Default total wall-clock budget for all registry work on one PR. */
export const NPM_TOTAL_BUDGET_MS = 12_000;
/** Cache TTL for registry metadata and download counts. */
export const NPM_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export interface NpmPackageMetadata {
  packageName: string;
  /** true = published, false = 404, null = lookup failed. */
  exists: boolean | null;
  /** Days since registry `time.created`; null when unknown. */
  ageDays: number | null;
  /** Weekly downloads; null when unknown. */
  weeklyDownloads: number | null;
  /** Published version count from the registry document; null when unknown. */
  versionCount: number | null;
  /** Whether the registry document has a `repository` field; null when unknown. */
  hasRepository: boolean | null;
  /** Whether either signal came from a failed/unavailable lookup. */
  unavailable: boolean;
}

export interface NpmRegistryCacheEntry {
  packageName: string;
  existsOnRegistry: boolean | null;
  createdAtRegistry: string | null;
  weeklyDownloads: number | null;
  versionCount: number | null;
  hasRepository: boolean | null;
  metadataFetchedAt: string;
  downloadsFetchedAt: string | null;
}

export interface NpmRegistryCacheStore {
  get(packageName: string): Promise<NpmRegistryCacheEntry | null>;
  upsert(
    entry: Omit<NpmRegistryCacheEntry, 'metadataFetchedAt' | 'downloadsFetchedAt'> & {
      metadataFetchedAt?: string;
      downloadsFetchedAt?: string | null;
    },
  ): Promise<void>;
}

export interface NpmRegistryClientOptions {
  fetchImpl?: typeof fetch;
  cache?: NpmRegistryCacheStore;
  requestTimeoutMs?: number;
  totalBudgetMs?: number;
  cacheTtlMs?: number;
  /** Injectable clock for tests. */
  now?: () => number;
}

class BudgetExhaustedError extends Error {
  constructor() {
    super('npm registry total budget exhausted');
    this.name = 'BudgetExhaustedError';
  }
}

function encodePackagePath(packageName: string): string {
  // Scoped packages: @scope/name → @scope%2Fname for the registry URL path.
  if (packageName.startsWith('@')) {
    const slash = packageName.indexOf('/');
    if (slash === -1) return encodeURIComponent(packageName);
    return `${encodeURIComponent(packageName.slice(0, slash))}%2F${encodeURIComponent(packageName.slice(slash + 1))}`;
  }
  return encodeURIComponent(packageName);
}

function ageDaysFromCreated(createdAt: string | null, nowMs: number): number | null {
  if (!createdAt) return null;
  const createdMs = Date.parse(createdAt);
  if (!Number.isFinite(createdMs)) return null;
  return Math.max(0, Math.floor((nowMs - createdMs) / (24 * 60 * 60 * 1000)));
}

function isFresh(fetchedAt: string | null | undefined, ttlMs: number, nowMs: number): boolean {
  if (!fetchedAt) return false;
  const fetchedMs = Date.parse(fetchedAt);
  if (!Number.isFinite(fetchedMs)) return false;
  return nowMs - fetchedMs < ttlMs;
}

function buildRegistryUrl(packageName: string): string {
  return `https://${NPM_REGISTRY_HOST}/${encodePackagePath(packageName)}`;
}

function buildDownloadsUrl(packageName: string): string {
  return `https://${NPM_DOWNLOADS_HOST}/downloads/point/last-week/${encodePackagePath(packageName)}`;
}

/** Extracts version count + repository presence from a registry document body. */
export function parseRegistryDocumentShape(body: unknown): {
  createdAt: string | null;
  versionCount: number | null;
  hasRepository: boolean | null;
} {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { createdAt: null, versionCount: null, hasRepository: null };
  }
  const record = body as {
    time?: { created?: unknown };
    versions?: unknown;
    repository?: unknown;
  };
  const created =
    record.time && typeof record.time.created === 'string' ? record.time.created : null;
  const versions = record.versions;
  const versionCount =
    versions && typeof versions === 'object' && !Array.isArray(versions)
      ? Object.keys(versions).length
      : null;
  // Absent / null / empty-string repository ⇒ not present. Any object or URL string counts.
  const hasRepository =
    record.repository !== undefined && record.repository !== null && record.repository !== '';
  return { createdAt: created, versionCount, hasRepository };
}

/**
 * Looks up one package. Uses cache when fresh; otherwise hits the fixed npm
 * hosts under the shared budget. Never throws for network/registry failures —
 * returns `exists: null` / `unavailable: true` instead.
 */
export async function lookupNpmPackage(
  packageName: string,
  options: NpmRegistryClientOptions = {},
  budgetState?: { remainingMs: number },
): Promise<NpmPackageMetadata> {
  const name = packageName.trim();
  const emptyUnavailable: NpmPackageMetadata = {
    packageName: name,
    exists: null,
    ageDays: null,
    weeklyDownloads: null,
    versionCount: null,
    hasRepository: null,
    unavailable: true,
  };
  if (!name) return emptyUnavailable;

  const fetchImpl = options.fetchImpl ?? fetch;
  const requestTimeoutMs = options.requestTimeoutMs ?? NPM_REQUEST_TIMEOUT_MS;
  const cacheTtlMs = options.cacheTtlMs ?? NPM_CACHE_TTL_MS;
  const nowMs = (options.now ?? Date.now)();
  const budget = budgetState ?? {
    remainingMs: options.totalBudgetMs ?? NPM_TOTAL_BUDGET_MS,
  };

  const cached = options.cache ? await options.cache.get(name) : null;
  const metadataFresh = cached ? isFresh(cached.metadataFetchedAt, cacheTtlMs, nowMs) : false;
  const downloadsFresh = cached ? isFresh(cached.downloadsFetchedAt, cacheTtlMs, nowMs) : false;

  let exists: boolean | null = metadataFresh ? cached!.existsOnRegistry : null;
  let createdAt: string | null = metadataFresh ? cached!.createdAtRegistry : null;
  let versionCount: number | null = metadataFresh ? cached!.versionCount : null;
  let hasRepository: boolean | null = metadataFresh ? cached!.hasRepository : null;
  let weeklyDownloads: number | null = downloadsFresh ? cached!.weeklyDownloads : null;
  let unavailable = false;

  const timedFetch = async (url: string): Promise<Response> => {
    if (budget.remainingMs <= 0) throw new BudgetExhaustedError();
    assertScannableUrl(url);
    const started = (options.now ?? Date.now)();
    const timeout = Math.min(requestTimeoutMs, budget.remainingMs);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetchImpl(url, {
        method: 'GET',
        headers: { Accept: 'application/json', 'User-Agent': 'Assurly-DependencyGuard/1.0' },
        signal: controller.signal,
        redirect: 'error',
      });
      return response;
    } finally {
      clearTimeout(timer);
      const elapsed = (options.now ?? Date.now)() - started;
      budget.remainingMs = Math.max(0, budget.remainingMs - elapsed);
    }
  };

  if (!metadataFresh) {
    try {
      const response = await timedFetch(buildRegistryUrl(name));
      if (response.status === 404) {
        exists = false;
        createdAt = null;
        versionCount = null;
        hasRepository = null;
      } else if (!response.ok) {
        exists = null;
        unavailable = true;
      } else {
        const body: unknown = await response.json();
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
          exists = null;
          unavailable = true;
        } else {
          const shape = parseRegistryDocumentShape(body);
          exists = true;
          createdAt = shape.createdAt;
          versionCount = shape.versionCount;
          hasRepository = shape.hasRepository;
        }
      }
    } catch (error) {
      if (error instanceof BudgetExhaustedError) {
        return emptyUnavailable;
      }
      // UrlSafetyError should never fire for our hardcoded hosts — treat as unavailable.
      if (!(error instanceof UrlSafetyError)) {
        unavailable = true;
      } else {
        unavailable = true;
      }
      exists = null;
    }
  }

  // Downloads are only meaningful for packages that exist.
  if (exists === true && !downloadsFresh) {
    try {
      const response = await timedFetch(buildDownloadsUrl(name));
      if (!response.ok) {
        weeklyDownloads = null;
        unavailable = unavailable || response.status >= 500;
      } else {
        const body: unknown = await response.json();
        const downloads =
          body && typeof body === 'object' && !Array.isArray(body)
            ? (body as { downloads?: unknown }).downloads
            : undefined;
        weeklyDownloads =
          typeof downloads === 'number' && Number.isFinite(downloads)
            ? Math.max(0, Math.floor(downloads))
            : null;
        if (weeklyDownloads === null) unavailable = true;
      }
    } catch (error) {
      if (error instanceof BudgetExhaustedError) {
        // Keep metadata we already have; mark downloads unavailable.
        weeklyDownloads = null;
        unavailable = true;
      } else {
        weeklyDownloads = null;
        unavailable = true;
      }
    }
  }

  if (exists === false) {
    weeklyDownloads = null;
    versionCount = null;
    hasRepository = null;
  }

  if (options.cache && (exists !== null || cached)) {
    const nowIso = new Date(nowMs).toISOString();
    await options.cache
      .upsert({
        packageName: name,
        existsOnRegistry: exists,
        createdAtRegistry: createdAt,
        weeklyDownloads,
        versionCount,
        hasRepository,
        metadataFetchedAt: metadataFresh ? cached!.metadataFetchedAt : nowIso,
        downloadsFetchedAt:
          exists === true
            ? downloadsFresh
              ? cached!.downloadsFetchedAt
              : nowIso
            : (cached?.downloadsFetchedAt ?? null),
      })
      .catch(() => {
        // Cache write failures must never fail the PR check.
      });
  }

  if (exists === null) {
    return emptyUnavailable;
  }

  return {
    packageName: name,
    exists,
    ageDays: ageDaysFromCreated(createdAt, nowMs),
    weeklyDownloads,
    versionCount,
    hasRepository,
    unavailable,
  };
}

/**
 * Looks up many packages under one shared budget. On budget exhaustion, remaining
 * packages are returned as unavailable without further network calls.
 */
export async function lookupNpmPackages(
  packageNames: readonly string[],
  options: NpmRegistryClientOptions = {},
): Promise<NpmPackageMetadata[]> {
  const budget = { remainingMs: options.totalBudgetMs ?? NPM_TOTAL_BUDGET_MS };
  const results: NpmPackageMetadata[] = [];
  for (const name of packageNames) {
    if (budget.remainingMs <= 0) {
      results.push({
        packageName: name,
        exists: null,
        ageDays: null,
        weeklyDownloads: null,
        versionCount: null,
        hasRepository: null,
        unavailable: true,
      });
      continue;
    }
    results.push(await lookupNpmPackage(name, options, budget));
  }
  return results;
}

/** Exported for security tests — builds the exact URL we would fetch. */
export function npmRegistryUrlForPackage(packageName: string): string {
  const url = buildRegistryUrl(packageName);
  assertScannableUrl(url);
  return url;
}

export function npmDownloadsUrlForPackage(packageName: string): string {
  const url = buildDownloadsUrl(packageName);
  assertScannableUrl(url);
  return url;
}
