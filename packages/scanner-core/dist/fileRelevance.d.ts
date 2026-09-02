import { type UnanalyzedLanguageCount } from './languageCoverage';
/**
 * True when Manual Checker / ZIP load should keep this path (after noise
 * filtering). `.gitignore` and `.env.example` are always surface even if the
 * extension regex is tightened later.
 */
export declare function isTextScanSurface(filePath: string): boolean;
/**
 * Returns false for test fixtures, vendored paths, and build output — shared by CLI and web.
 */
export declare function isScannableFile(filePath: string): boolean;
/** Higher scores are scanned first when a file cap applies. */
export declare function getFileRelevanceScore(filePath: string): number;
/**
 * Instant Gate (dashboard browser scan) file budget. The CLI scans the full
 * repository; this cap exists because GitHub content fetches run in the browser.
 */
export declare const INSTANT_GATE_MAX_FILES = 400;
/**
 * Files Instant Gate treats as the ship surface. When a monorepo has `apps/`,
 * only `apps/*` and `supabase/*` count toward completeness — CLI/editor packages
 * are tooling, not the Vercel+Supabase+Stripe deploy. Repos without `apps/`
 * keep every candidate (typical single-package vibe-coder layout).
 */
export declare function instantGateSurfaceFiles<T>(files: readonly T[], getPath: (item: T) => string): T[];
/**
 * Stable sort: high-relevance paths first; ties preserve input order.
 */
export declare function rankFilesByRelevance<T>(files: readonly T[], getPath: (item: T) => string): T[];
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
    /** `sourceTotal` counts only what GitHub returned; the repository holds more. */
    sourceTotalIsLowerBound?: boolean;
    limit?: number;
    gaps?: ScanScopeGaps;
}
/**
 * Repository-wide counts measured on the complete tree.
 *
 * The Instant Gate ranks and caps the tree server-side, so the browser only ever
 * holds a sample. A sample cannot describe the repository it came from: deriving
 * coverage from it reported "100 of 111 source files" for a repository holding
 * thousands. Whoever still has the full tree measures these and sends them with
 * the sample.
 */
export interface ScanScopeTotals {
    /** Scannable source files in the repository — analysed plus unread languages. */
    sourceTotal: number;
    /** Of those, the ones inside the Instant Gate app roots. */
    surfaceSource: number;
    /** Of the surface, the ones Assurly rules can actually read. */
    surfaceAnalyzable: number;
    /** GitHub truncated its own tree, so every count here is a floor, not a total. */
    partial?: boolean;
}
export interface BuildScanScopeOptions {
    roots?: string[];
    treePaths?: readonly string[];
    unanalyzed?: readonly UnanalyzedLanguageCount[];
    /** Counts measured on the full tree. Without them the sample describes itself. */
    totals?: ScanScopeTotals;
    limit?: number;
}
/** Measures {@link ScanScopeTotals} over a complete tree, before any cap applies. */
export declare function measureScanScopeTotals(paths: readonly string[], options?: {
    partial?: boolean;
}): ScanScopeTotals;
/** Derive monorepo app/package roots from scanned paths for the scope summary line. */
export declare function inferScanRoots(paths: readonly string[]): string[];
export declare function buildScanScope(allCandidates: readonly string[], selectedPaths: readonly string[], options?: BuildScanScopeOptions): ScanScope;
export declare function formatScanScopeSummary(scope: ScanScope): string;
