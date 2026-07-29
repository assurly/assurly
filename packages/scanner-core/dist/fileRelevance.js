"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isScannableFile = isScannableFile;
exports.getFileRelevanceScore = getFileRelevanceScore;
exports.rankFilesByRelevance = rankFilesByRelevance;
exports.inferScanRoots = inferScanRoots;
exports.buildScanScope = buildScanScope;
exports.formatScanScopeSummary = formatScanScopeSummary;
function normalizePath(filePath) {
    return filePath.replace(/\\/g, '/');
}
/**
 * Returns false for test fixtures, vendored paths, and build output — shared by CLI and web.
 */
function isScannableFile(filePath) {
    const normalized = normalizePath(filePath);
    if (normalized.includes('/node_modules/') ||
        normalized.startsWith('node_modules/') ||
        normalized.includes('/dist/') ||
        normalized.startsWith('dist/') ||
        normalized.includes('/.next/') ||
        normalized.startsWith('.next/')) {
        return false;
    }
    // `test-project/` and `test-projects/` are both common names for a directory
    // of deliberately broken sample apps. Matching only the plural let the
    // singular through, and a fixture written to fail every rule then reads as
    // production code: Assurly's own repository reported two missing-RLS blockers
    // from a fixture and failed its own ship gate for it.
    if (normalized.includes('/__tests__/') ||
        normalized.startsWith('__tests__/') ||
        /(^|\/)test-projects?\//.test(normalized) ||
        normalized.includes('/fixtures/') ||
        normalized.startsWith('fixtures/') ||
        normalized.includes('/vendor/') ||
        normalized.startsWith('vendor/')) {
        return false;
    }
    if (/\.(test|spec)\.[^/]+$/i.test(normalized)) {
        return false;
    }
    return true;
}
/** Higher scores are scanned first when a file cap applies. */
function getFileRelevanceScore(filePath) {
    const normalized = normalizePath(filePath).toLowerCase();
    let score = 0;
    if (/(?:^|\/)app\//.test(normalized))
        score += 100;
    if (/(?:^|\/)api\//.test(normalized))
        score += 90;
    if (/(?:^|\/)supabase\//.test(normalized))
        score += 80;
    if (/(?:^|\/)db\//.test(normalized))
        score += 70;
    if (normalized.includes('middleware'))
        score += 60;
    if (normalized.includes('route'))
        score += 50;
    if (normalized.endsWith('schema.sql'))
        score += 40;
    return score;
}
/**
 * Stable sort: high-relevance paths first; ties preserve input order.
 */
function rankFilesByRelevance(files, getPath) {
    return files
        .map((file, index) => ({ file, index, score: getFileRelevanceScore(getPath(file)) }))
        .sort((left, right) => right.score - left.score || left.index - right.index)
        .map(({ file }) => file);
}
/** Derive monorepo app/package roots from scanned paths for the scope summary line. */
function inferScanRoots(paths) {
    const roots = new Set();
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
function buildScanScope(allCandidates, selectedPaths, roots) {
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
function formatScanScopeSummary(scope) {
    const rootsLabel = scope.roots.join(', ');
    return `Scanned ${rootsLabel}, ${scope.scanned} files, skipped tests & fixtures`;
}
