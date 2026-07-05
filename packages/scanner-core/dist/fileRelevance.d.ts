/**
 * Returns false for test fixtures, vendored paths, and build output — shared by CLI and web.
 */
export declare function isScannableFile(filePath: string): boolean;
/** Higher scores are scanned first when a file cap applies. */
export declare function getFileRelevanceScore(filePath: string): number;
/**
 * Stable sort: high-relevance paths first; ties preserve input order.
 */
export declare function rankFilesByRelevance<T>(files: readonly T[], getPath: (item: T) => string): T[];
export interface ScanScope {
    scanned: number;
    skipped: number;
    roots: string[];
}
/** Derive monorepo app/package roots from scanned paths for the scope summary line. */
export declare function inferScanRoots(paths: readonly string[]): string[];
export declare function buildScanScope(allCandidates: readonly string[], selectedPaths: readonly string[], roots?: string[]): ScanScope;
export declare function formatScanScopeSummary(scope: ScanScope): string;
