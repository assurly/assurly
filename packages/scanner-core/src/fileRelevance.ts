import { isAssurlyEnvExamplePath, isGitIgnorePath } from './gitIgnore';
import {
  isAnalyzedCodeFile,
  summarizeUnanalyzedSource,
  unanalyzedLanguageCounts,
  unanalyzedLanguageForPath,
  type UnanalyzedLanguageCount,
} from './languageCoverage';

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

/**
 * Text files the ship-gate rules actually read. Browser pickers must not load
 * binaries (png/zip/vsix) or extensionless husky hooks just to match CLI
 * `listFiles` counts — those files never affect findings.
 */
const TEXT_SCAN_SURFACE =
  /(?:\.sql|\.env(?:\.[^/]+)?|\.[cm]?[jt]sx?|\.json|\.ya?ml|\.mdc?|\.npmrc|\.cursorrules|\.txt|\.toml|\.html)$/i;

/**
 * True when Manual Checker / ZIP load should keep this path (after noise
 * filtering). `.gitignore` and `.env.example` are always surface even if the
 * extension regex is tightened later.
 */
export function isTextScanSurface(filePath: string): boolean {
  const normalized = normalizePath(filePath);
  return (
    isGitIgnorePath(normalized) ||
    isAssurlyEnvExamplePath(normalized) ||
    TEXT_SCAN_SURFACE.test(normalized)
  );
}

/**
 * Returns false for test fixtures, vendored paths, and build output — shared by CLI and web.
 */
export function isScannableFile(filePath: string): boolean {
  const normalized = normalizePath(filePath);

  if (
    normalized.includes('/node_modules/') ||
    normalized.startsWith('node_modules/') ||
    normalized.includes('/dist/') ||
    normalized.startsWith('dist/') ||
    normalized.includes('/.next/') ||
    normalized.startsWith('.next/') ||
    normalized.includes('/coverage/') ||
    normalized.startsWith('coverage/')
  ) {
    return false;
  }

  // `test-project/` and `test-projects/` are both common names for a directory
  // of deliberately broken sample apps. Matching only the plural let the
  // singular through, and a fixture written to fail every rule then reads as
  // production code: Assurly's own repository reported two missing-RLS blockers
  // from a fixture and failed its own ship gate for it.
  //
  // `/testing/` and `__mocks__/` are app-local harness paths (e.g. e2e fixtures);
  // playwright configs are tooling, not ship-gate surface area.
  if (
    normalized.includes('/__tests__/') ||
    normalized.startsWith('__tests__/') ||
    normalized.includes('/__mocks__/') ||
    normalized.startsWith('__mocks__/') ||
    /(^|\/)test-projects?\//.test(normalized) ||
    normalized.includes('/fixtures/') ||
    normalized.startsWith('fixtures/') ||
    normalized.includes('/testing/') ||
    normalized.startsWith('testing/') ||
    normalized.includes('/vendor/') ||
    normalized.startsWith('vendor/') ||
    /(^|\/)playwright\.config\.ts$/i.test(normalized)
  ) {
    return false;
  }

  if (/\.(test|spec)\.[^/]+$/i.test(normalized)) {
    return false;
  }

  return true;
}

/** Higher scores are scanned first when a file cap applies. */
export function getFileRelevanceScore(filePath: string): number {
  const normalized = normalizePath(filePath).toLowerCase();
  let score = 0;

  if (/(?:^|\/)app\//.test(normalized)) score += 100;
  if (/(?:^|\/)api\//.test(normalized)) score += 90;
  if (/(?:^|\/)supabase\//.test(normalized)) score += 80;
  if (/(?:^|\/)db\//.test(normalized)) score += 70;
  if (normalized.includes('middleware')) score += 60;
  if (normalized.includes('route')) score += 50;
  if (normalized.endsWith('schema.sql')) score += 40;
  if (/stripe|webhook|billing/i.test(normalized)) score += 85;

  return score;
}

/**
 * Instant Gate (dashboard browser scan) file budget. The CLI scans the full
 * repository; this cap exists because GitHub content fetches run in the browser.
 */
export const INSTANT_GATE_MAX_FILES = 400;

/**
 * Files Instant Gate treats as the ship surface. When a monorepo has `apps/`,
 * only `apps/*` and `supabase/*` count toward completeness — CLI/editor packages
 * are tooling, not the Vercel+Supabase+Stripe deploy. Repos without `apps/`
 * keep every candidate (typical single-package vibe-coder layout).
 */
export function instantGateSurfaceFiles<T>(files: readonly T[], getPath: (item: T) => string): T[] {
  const hasApps = files.some((file) => normalizePath(getPath(file)).startsWith('apps/'));
  if (!hasApps) return [...files];
  return files.filter((file) => /^(apps|supabase)\//.test(normalizePath(getPath(file))));
}

/**
 * Stable sort: high-relevance paths first; ties preserve input order.
 */
export function rankFilesByRelevance<T>(files: readonly T[], getPath: (item: T) => string): T[] {
  return files
    .map((file, index) => ({ file, index, score: getFileRelevanceScore(getPath(file)) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({ file }) => file);
}

export type { UnanalyzedLanguageCount };

export interface ScanScopeGaps {
  notAnalysed: number;
  overLimit: number;
  outsideAppRoots: number;
}

export interface ScanScope {
  scanned: number;
  skipped: number;
  roots: string[];
  unanalyzed?: UnanalyzedLanguageCount[];
  sourceTotal?: number;
  limit?: number;
  gaps?: ScanScopeGaps;
}

export interface BuildScanScopeOptions {
  roots?: string[];
  treePaths?: readonly string[];
  unanalyzed?: readonly UnanalyzedLanguageCount[];
  limit?: number;
}

function isSourceFile(filePath: string): boolean {
  return isAnalyzedCodeFile(filePath) || unanalyzedLanguageForPath(filePath) !== null;
}

/** Derive monorepo app/package roots from scanned paths for the scope summary line. */
export function inferScanRoots(paths: readonly string[]): string[] {
  const roots = new Set<string>();

  for (const filePath of paths) {
    const normalized = normalizePath(filePath);
    const appMatch = normalized.match(/^(apps\/[^/]+)/);
    if (appMatch) {
      roots.add(appMatch[1]);
      continue;
    }
    const packageMatch = normalized.match(/^(packages\/[^/]+)/);
    if (packageMatch) {
      roots.add(packageMatch[1]);
    }
  }

  if (roots.size === 0) {
    return ['repository'];
  }

  return [...roots].sort();
}

function buildScanScopeFromTree(
  treePaths: readonly string[],
  selectedPaths: readonly string[],
  options: BuildScanScopeOptions,
): ScanScope {
  const scannable = treePaths.filter(isScannableFile);
  const allSource = scannable.filter(isSourceFile);
  const surfaceSource = instantGateSurfaceFiles(allSource, (path) => path);
  const analyzedOnSurface = surfaceSource.filter(isAnalyzedCodeFile);
  const selectedSet = new Set(selectedPaths.map(normalizePath));
  const scanned = analyzedOnSurface.filter((path) => selectedSet.has(normalizePath(path))).length;
  const overLimit = Math.max(0, analyzedOnSurface.length - scanned);
  const notAnalysed = surfaceSource.filter(
    (path) => unanalyzedLanguageForPath(path) !== null,
  ).length;
  const outsideAppRoots = Math.max(0, allSource.length - surfaceSource.length);
  const unanalyzed =
    options.unanalyzed && options.unanalyzed.length > 0
      ? [...options.unanalyzed]
      : unanalyzedLanguageCounts(summarizeUnanalyzedSource(surfaceSource));
  const analyzedSelected = selectedPaths.filter(isAnalyzedCodeFile);

  return {
    scanned,
    skipped: notAnalysed + overLimit + outsideAppRoots,
    roots:
      options.roots ??
      inferScanRoots(analyzedSelected.length > 0 ? analyzedSelected : selectedPaths),
    ...(unanalyzed ? { unanalyzed } : {}),
    sourceTotal: allSource.length,
    ...(options.limit !== undefined ? { limit: options.limit } : {}),
    gaps: { notAnalysed, overLimit, outsideAppRoots },
  };
}

export function buildScanScope(
  allCandidates: readonly string[],
  selectedPaths: readonly string[],
  options?: BuildScanScopeOptions,
): ScanScope {
  const scanned = selectedPaths.length;
  const unanalyzed =
    options?.unanalyzed && options.unanalyzed.length > 0 ? [...options.unanalyzed] : undefined;

  if (options?.treePaths) {
    return buildScanScopeFromTree(options.treePaths, selectedPaths, options);
  }

  const scannable = allCandidates.filter(isScannableFile);
  const skippedFromCap = Math.max(0, scannable.length - scanned);
  const skippedNonScannable = allCandidates.length - scannable.length;

  return {
    scanned,
    skipped: skippedNonScannable + skippedFromCap,
    roots: options?.roots ?? inferScanRoots(selectedPaths),
    ...(unanalyzed ? { unanalyzed } : {}),
  };
}

function formatUnanalyzedClause(items: readonly UnanalyzedLanguageCount[]): string {
  const parts = items.map((item, index, all) => {
    const last = index === all.length - 1;
    if (all.length === 1) {
      const noun = item.fileCount === 1 ? 'file' : 'files';
      return `${item.fileCount} ${item.language} ${noun}`;
    }
    if (last) {
      const noun = item.fileCount === 1 ? 'file' : 'files';
      return `${item.fileCount} ${item.language} ${noun}`;
    }
    return `${item.fileCount} ${item.language}`;
  });
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

export function formatScanScopeSummary(scope: ScanScope): string {
  const rootsLabel = scope.roots.join(', ');
  const scannedNoun = scope.scanned === 1 ? 'source file' : 'source files';

  if (scope.sourceTotal === undefined) {
    return `Scanned ${rootsLabel} · ${scope.scanned} ${scannedNoun} analysed`;
  }

  const totalNoun = scope.sourceTotal === 1 ? 'source file' : 'source files';
  const parts = [`Scanned ${rootsLabel} · ${scope.scanned} of ${scope.sourceTotal} ${totalNoun}`];

  if (scope.unanalyzed && scope.unanalyzed.length > 0) {
    parts.push(`${formatUnanalyzedClause(scope.unanalyzed)} not analysed`);
  }

  const overLimit = scope.gaps?.overLimit ?? 0;
  if (overLimit > 0) {
    const limit = scope.limit ?? INSTANT_GATE_MAX_FILES;
    parts.push(`${overLimit} over the ${limit}-file limit`);
  }

  const outsideAppRoots = scope.gaps?.outsideAppRoots ?? 0;
  if (outsideAppRoots > 0) {
    parts.push(`${outsideAppRoots} outside app roots`);
  }

  return parts.join(' · ');
}
