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
  parsePackageJsonDependencies,
  type ScannerFinding,
} from '@assurly/scanner-core';
import {
  evaluateNamedDependencies,
  type EvaluateNamedDependenciesInput,
} from './dependencyProvenanceLookup';

export interface PrDependencyScanInput {
  /** package.json text at the PR head (required to evaluate). */
  headPackageJson: string | null;
  /** package.json text at the PR base; null when the file is new. */
  basePackageJson: string | null;
  /** Manifest path used in finding.file (default package.json). */
  manifestPath?: string;
  /** Cap on new deps evaluated per PR. */
  cap?: number;
  registry?: EvaluateNamedDependenciesInput['registry'];
  cache?: EvaluateNamedDependenciesInput['cache'];
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

  const result = await evaluateNamedDependencies({
    packageNames: added,
    manifestPath: input.manifestPath ?? 'package.json',
    cap: input.cap ?? DEP_DEFAULT_EVAL_CAP,
    registry: input.registry,
    cache: input.cache,
  });

  return {
    addedDependencies: added,
    findings: result.findings,
  };
}
