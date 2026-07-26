/**
 * Dashboard repo-scan dependency provenance.
 *
 * Unlike the PR path (newly added deps vs base ref), a dashboard scan has no
 * base — evaluate declared dependencies, capped, and degrade silently when npm
 * is unreachable so the rest of the scan still completes.
 */
import {
  DEP_DEFAULT_EVAL_CAP,
  collectDependencyNames,
  parsePackageJsonDependencies,
  type ScannerFinding,
} from '@assurly/scanner-core';
import {
  evaluateNamedDependencies,
  type EvaluateNamedDependenciesInput,
} from './dependencyProvenanceLookup';

export interface DashboardDependencyScanInput {
  packageJson: string | null;
  manifestPath?: string;
  cap?: number;
  registry?: EvaluateNamedDependenciesInput['registry'];
  cache?: EvaluateNamedDependenciesInput['cache'];
}

export interface DashboardDependencyScanResult {
  declaredDependencies: string[];
  findings: ScannerFinding[];
}

/**
 * Scans declared dependencies from a package.json for the dashboard path.
 * Safe when the manifest is missing — returns empty findings.
 */
export async function scanDashboardDependencies(
  input: DashboardDependencyScanInput,
): Promise<DashboardDependencyScanResult> {
  if (!input.packageJson) {
    return { declaredDependencies: [], findings: [] };
  }

  const parsed = parsePackageJsonDependencies(input.packageJson);
  if (!parsed) {
    return { declaredDependencies: [], findings: [] };
  }

  const declared = [...collectDependencyNames(parsed)].sort();
  if (declared.length === 0) {
    return { declaredDependencies: [], findings: [] };
  }

  const result = await evaluateNamedDependencies({
    packageNames: declared,
    manifestPath: input.manifestPath ?? 'package.json',
    cap: input.cap ?? DEP_DEFAULT_EVAL_CAP,
    registry: input.registry,
    cache: input.cache,
  });

  return {
    declaredDependencies: declared,
    findings: result.findings,
  };
}
