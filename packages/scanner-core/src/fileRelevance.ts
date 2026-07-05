function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
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
    normalized.startsWith('.next/')
  ) {
    return false;
  }

  if (
    normalized.includes('/__tests__/') ||
    normalized.startsWith('__tests__/') ||
    normalized.includes('/test-projects/') ||
    normalized.startsWith('test-projects/') ||
    normalized.includes('/fixtures/') ||
    normalized.startsWith('fixtures/') ||
    normalized.includes('/vendor/') ||
    normalized.startsWith('vendor/')
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

  return score;
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

export interface ScanScope {
  scanned: number;
  skipped: number;
  roots: string[];
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

export function buildScanScope(
  allCandidates: readonly string[],
  selectedPaths: readonly string[],
  roots?: string[],
): ScanScope {
  const scannable = allCandidates.filter(isScannableFile);
  const scanned = selectedPaths.length;
  const skippedFromCap = Math.max(0, scannable.length - scanned);
  const skippedNonScannable = allCandidates.length - scannable.length;

  return {
    scanned,
    skipped: skippedNonScannable + skippedFromCap,
    roots: roots ?? inferScanRoots(selectedPaths),
  };
}

export function formatScanScopeSummary(scope: ScanScope): string {
  const rootsLabel = scope.roots.join(', ');
  return `Scanned ${rootsLabel}, ${scope.scanned} files, skipped tests & fixtures`;
}
