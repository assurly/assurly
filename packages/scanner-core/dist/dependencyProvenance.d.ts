/**
 * Dependency provenance guard — typosquat + slopsquat + young-unvetted.
 *
 * Evaluates *newly added* dependencies against registry signals. Pure: callers
 * supply metadata. Network I/O and caching live in the web app (webhook path).
 *
 * Blocking policy (near-certainty only):
 *   - dep-nonexistent-package → blocker (404 / never published)
 *   - dep-typosquat-suspect   → blocker (age < 30d AND downloads < 100 AND
 *                                edit distance ≤ 2 from a top-corpus name)
 *   - dep-slopsquat-suspect   → blocker (borrows a corpus name AND abandoned
 *                                shape AND low downloads). Age is NOT a factor.
 *   - dep-new-unvetted        → warning (young + low downloads, no other hit)
 *   - dep-registry-unavailable → warning (lookup failed; never blocks)
 *
 * Slopsquat ≠ typosquat. LLMs invent plausible compounds (`react-codeshift`,
 * `jscodeshift-utils`); edit distance cannot find those without drowning in
 * false positives. The abandoned registry shape (one version, no repository)
 * plus borrowed naming is what carries precision.
 */
import type { ScannerFinding } from './index';
export declare const DEP_NONEXISTENT_PACKAGE = "dep-nonexistent-package";
/** Edit-distance lookalike (was mislabelled dep-slopsquat-suspect). */
export declare const DEP_TYPOSQUAT_SUSPECT = "dep-typosquat-suspect";
/** Borrowed name + abandoned registry shape + low downloads. */
export declare const DEP_SLOPSQUAT_SUSPECT = "dep-slopsquat-suspect";
export declare const DEP_NEW_UNVETTED = "dep-new-unvetted";
export declare const DEP_REGISTRY_UNAVAILABLE = "dep-registry-unavailable";
export declare const DEP_SCAN_CAPPED = "dep-scan-capped";
/** Age threshold for "young" packages (days) — typosquat + new-unvetted only. */
export declare const DEP_YOUNG_AGE_DAYS = 30;
/** Weekly download floor below which adoption is "low". */
export declare const DEP_LOW_DOWNLOADS = 100;
/** Max Damerau-Levenshtein distance for typosquat proximity. */
export declare const DEP_PROXIMITY_MAX_DISTANCE = 2;
/** Default cap on new dependencies evaluated per PR. */
export declare const DEP_DEFAULT_EVAL_CAP = 40;
export interface DependencyProvenanceSignals {
    /** Package name as declared in the manifest (unscoped or scoped). */
    packageName: string;
    /** Manifest path the dependency was added in (e.g. package.json). */
    file?: string;
    /**
     * Registry existence. `true` = published, `false` = 404 / never published,
     * `null` = lookup failed / timed out / unavailable.
     */
    exists: boolean | null;
    /** Days since `time.created` on the registry document; null when unknown. */
    ageDays: number | null;
    /** Weekly download count; null when unknown. */
    weeklyDownloads: number | null;
    /**
     * Number of published versions on the registry document; null when unknown.
     * Used for the slopsquat "abandoned shape" signal.
     */
    versionCount?: number | null;
    /**
     * Whether the registry document has a `repository` field; null when unknown.
     * Used for the slopsquat "abandoned shape" signal.
     */
    hasRepository?: boolean | null;
    /**
     * Optional precomputed nearest corpus match (typosquat). When omitted, the
     * evaluator runs proximity against the bundled top-package corpus.
     */
    nearestMatch?: {
        name: string;
        distance: number;
    } | null;
    /**
     * Optional precomputed borrowed corpus name (slopsquat). When omitted, the
     * evaluator runs token/run matching against the corpus. `null` means
     * "computed — no borrow"; `undefined` means "compute it".
     */
    borrowedName?: string | null;
}
export interface DependencyProvenanceScanResult {
    errorCount: number;
    warningCount: number;
    findings: ScannerFinding[];
}
export interface BorrowedNameMatch {
    /** The corpus entry that was borrowed (token or contiguous run). */
    name: string;
}
type ScanResult = DependencyProvenanceScanResult;
/**
 * Splits an unscoped package name into tokens on `-`, `_`, and `.`.
 * Empty tokens are dropped.
 */
export declare function tokenizePackageName(unscopedName: string): string[];
/**
 * Contiguous token runs of length ≥ 1, joined with `-` (npm's dominant
 * separator). Longer runs are preferred by the caller when matching.
 */
export declare function contiguousTokenRuns(tokens: readonly string[]): string[];
/**
 * True when a scoped package's scope "owns" the borrowed corpus name —
 * e.g. `@babel/plugin-x` borrowing `babel`. Unscoped packages never own.
 */
export declare function scopeOwnsBorrowedName(scope: string | null, borrowed: string): boolean;
/**
 * Finds a borrowed corpus name inside `packageName` via exact token or
 * contiguous-run match. Returns null when the full name is itself a corpus
 * entry, or when the only borrows are owned by the package's own scope.
 */
export declare function findBorrowedCorpusName(packageName: string, corpusSet?: ReadonlySet<string>): BorrowedNameMatch | null;
/** Abandoned shape: exactly one published version and no repository field. */
export declare function isAbandonedShape(versionCount: number | null | undefined, hasRepository: boolean | null | undefined): boolean;
/**
 * Evaluates one newly added dependency against registry signals.
 * Returns zero or one finding — never invents a signal that wasn't supplied.
 */
export declare function evaluateDependencyProvenance(signals: DependencyProvenanceSignals, options?: {
    corpus?: readonly string[];
}): ScannerFinding | null;
/**
 * Evaluates a list of newly added dependencies. Caps evaluation count; when
 * more packages are added than the cap, emits a single warning naming the
 * overflow count and still evaluates the first `cap` entries.
 */
export declare function evaluateNewDependencies(signalsList: readonly DependencyProvenanceSignals[], options?: {
    corpus?: readonly string[];
    cap?: number;
}): ScanResult;
export interface PackageJsonDependencies {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
}
/** Merges production + dev dependency names from a package.json shape. */
export declare function collectDependencyNames(manifest: PackageJsonDependencies): Set<string>;
/**
 * Returns package names present in `head` but absent from `base`.
 * Peer dependencies are ignored — they are not installed by the consumer.
 */
export declare function diffAddedDependencies(baseManifest: PackageJsonDependencies | null, headManifest: PackageJsonDependencies): string[];
/**
 * Parses package.json text into a dependency shape. Returns null on malformed
 * JSON or a non-object root — callers treat that as "no manifest".
 */
export declare function parsePackageJsonDependencies(content: string): PackageJsonDependencies | null;
/** Bundled corpus accessor for callers that need proximity without importing data. */
export declare function getTopNpmPackageCorpus(): readonly string[];
export {};
