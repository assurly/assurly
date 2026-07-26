/**
 * Shared npm lookup + provenance evaluation for PR and dashboard scan paths.
 *
 * Callers decide *which* package names to evaluate (newly added on a PR, or
 * all declared deps on a dashboard scan). This module owns the registry
 * lookup, cache wiring shape, evaluation cap, and degrade-never-throw contract.
 */
import {
  DEP_DEFAULT_EVAL_CAP,
  evaluateNewDependencies,
  type DependencyProvenanceSignals,
  type ScannerFinding,
} from '@assurly/scanner-core';
import {
  lookupNpmPackages,
  type NpmRegistryCacheStore,
  type NpmRegistryClientOptions,
} from './npmRegistry';
import type { DbAdapter } from './dbAdapter';

export interface EvaluateNamedDependenciesInput {
  packageNames: readonly string[];
  /** Manifest path used in finding.file (default package.json). */
  manifestPath?: string;
  /** Cap on packages looked up / evaluated. */
  cap?: number;
  registry?: NpmRegistryClientOptions;
  cache?: NpmRegistryCacheStore;
}

export interface EvaluateNamedDependenciesResult {
  evaluatedDependencies: string[];
  findings: ScannerFinding[];
}

/** Postgres-backed npm cache store (service-role adapter required by RLS). */
export function createDbNpmCacheStore(db: DbAdapter): NpmRegistryCacheStore {
  return {
    async get(packageName) {
      const row = await db.getNpmPackageCache(packageName);
      if (!row) return null;
      return {
        packageName: row.package_name,
        existsOnRegistry: row.exists_on_registry,
        createdAtRegistry: row.created_at_registry,
        weeklyDownloads: row.weekly_downloads,
        versionCount: row.version_count,
        hasRepository: row.has_repository,
        metadataFetchedAt: row.metadata_fetched_at,
        downloadsFetchedAt: row.downloads_fetched_at,
      };
    },
    async upsert(entry) {
      await db.upsertNpmPackageCache({
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

/**
 * Looks up the given package names against npm (via cache when provided) and
 * evaluates provenance. Degrades to registry-unavailable warnings when the
 * registry is unreachable — never throws for npm outages.
 */
export async function evaluateNamedDependencies(
  input: EvaluateNamedDependenciesInput,
): Promise<EvaluateNamedDependenciesResult> {
  const packageNames = [...input.packageNames];
  if (packageNames.length === 0) {
    return { evaluatedDependencies: [], findings: [] };
  }

  const manifestPath = input.manifestPath ?? 'package.json';
  const cap = input.cap ?? DEP_DEFAULT_EVAL_CAP;
  const toLookup = packageNames.slice(0, cap);

  let metadata;
  try {
    metadata = await lookupNpmPackages(toLookup, {
      ...input.registry,
      cache: input.cache ?? input.registry?.cache,
    });
  } catch {
    // Absolute last resort: every lookup unavailable, still finish the scan.
    metadata = toLookup.map((packageName) => ({
      packageName,
      exists: null,
      ageDays: null,
      weeklyDownloads: null,
      versionCount: null,
      hasRepository: null,
      unavailable: true,
    }));
  }

  const signals: DependencyProvenanceSignals[] = metadata.map((entry) => ({
    packageName: entry.packageName,
    file: manifestPath,
    // When metadata says unavailable, force exists=null so we emit the warning
    // rule rather than silently skipping.
    exists: entry.unavailable && entry.exists !== false ? null : entry.exists,
    ageDays: entry.ageDays,
    weeklyDownloads: entry.weeklyDownloads,
    versionCount: entry.versionCount,
    hasRepository: entry.hasRepository,
  }));

  // Preserve overflow packages in the signals list so evaluateNewDependencies
  // can emit the cap warning with the full count.
  const overflowSignals: DependencyProvenanceSignals[] = packageNames.slice(cap).map((name) => ({
    packageName: name,
    file: manifestPath,
    exists: null,
    ageDays: null,
    weeklyDownloads: null,
    versionCount: null,
    hasRepository: null,
  }));

  const evaluated = evaluateNewDependencies([...signals, ...overflowSignals], {
    cap,
  });

  return {
    evaluatedDependencies: packageNames,
    findings: evaluated.findings,
  };
}
