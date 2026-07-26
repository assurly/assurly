/**
 * Damerau-Levenshtein edit distance (insertions, deletions, substitutions,
 * and adjacent transpositions). Used for typosquat name-proximity checks.
 */
/**
 * Returns the Damerau-Levenshtein distance between two strings.
 * Complexity is O(|a| * |b|); callers should pre-filter by length delta.
 */
export declare function damerauLevenshtein(a: string, b: string): number;
export interface NearestCorpusMatch {
    name: string;
    distance: number;
}
/**
 * Finds the nearest corpus name within `maxDistance` (inclusive).
 * Returns null when nothing is within the budget. Length-delta pruning
 * keeps the scan cheap against a ~5k corpus.
 */
export declare function findNearestCorpusMatch(candidate: string, corpus: readonly string[], maxDistance?: number): NearestCorpusMatch | null;
