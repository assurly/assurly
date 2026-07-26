/**
 * PR dependency provenance orchestration for the GitHub App webhook path.
 *
 * Diffs package.json against the PR base ref, looks up only *newly added*
 * dependencies, and evaluates them via scanner-core. Degrades to warnings when
 * the registry is unreachable — never fails the surrounding PR scan.
 */
import {
  DEP_DEFAULT_EVAL_CAP,
  diffAddedDependencies,
  evaluateNewDependencies,
  parsePackageJsonDependencies,
  type DependencyProvenanceSignals,
  type ScannerFinding,
} from '@assurly/scanner-core';
import {
  lookupNpmPackages,
  type NpmRegistryCacheStore,
  type NpmRegistryClientOptions,
} from './npmRegistry';

export interface PrDependencyScanInput {
  /** package.json text at the PR head (required to evaluate). */
  headPackageJson: string | null;
  /** package.json text at the PR base; null when the file is new. */
  basePackageJson: string | null;
  /** Manifest path used in finding.file (default package.json). */
  manifestPath?: string;
  /** Cap on new deps evaluated per PR. */
  cap?: number;
  registry?: NpmRegistryClientOptions;
  cache?: NpmRegistryCacheStore;
}

export interface PrDependencyScanResult {
  addedDependencies: string[];
  findings: ScannerFinding[];
}

/**
 * Scans newly added dependencies on a PR. Safe to call when manifests are
 * missing — returns empty findings.
 */
export async function scanPrNewDependencies(
  input: PrDependencyScanInput,
): Promise<PrDependencyScanResult> {
  if (!input.headPackageJson) {
    return { addedDependencies: [], findings: [] };
  }

  const head = parsePackageJsonDependencies(input.headPackageJson);
  if (!head) {
    return { addedDependencies: [], findings: [] };
  }

  const base = input.basePackageJson ? parsePackageJsonDependencies(input.basePackageJson) : null;
  const added = diffAddedDependencies(base, head);
  if (added.length === 0) {
    return { addedDependencies: [], findings: [] };
  }

  const manifestPath = input.manifestPath ?? 'package.json';
  const cap = input.cap ?? DEP_DEFAULT_EVAL_CAP;
  const toLookup = added.slice(0, cap);

  let metadata;
  try {
    metadata = await lookupNpmPackages(toLookup, {
      ...input.registry,
      cache: input.cache ?? input.registry?.cache,
    });
  } catch {
    // Absolute last resort: every lookup unavailable, still finish the PR.
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
  const overflowSignals: DependencyProvenanceSignals[] = added.slice(cap).map((name) => ({
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
    addedDependencies: added,
    findings: evaluated.findings,
  };
}
