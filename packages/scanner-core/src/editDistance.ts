/**
 * Damerau-Levenshtein edit distance (insertions, deletions, substitutions,
 * and adjacent transpositions). Used for typosquat name-proximity checks.
 */

/**
 * Returns the Damerau-Levenshtein distance between two strings.
 * Complexity is O(|a| * |b|); callers should pre-filter by length delta.
 */
export function damerauLevenshtein(a: string, b: string): number {
  const aLen = a.length;
  const bLen = b.length;
  if (aLen === 0) return bLen;
  if (bLen === 0) return aLen;

  const dist: number[][] = Array.from({ length: aLen + 1 }, () => Array(bLen + 1).fill(0));
  for (let i = 0; i <= aLen; i += 1) dist[i]![0] = i;
  for (let j = 0; j <= bLen; j += 1) dist[0]![j] = j;

  for (let i = 1; i <= aLen; i += 1) {
    for (let j = 1; j <= bLen; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const row = dist[i]!;
      row[j] = Math.min(dist[i - 1]![j]! + 1, row[j - 1]! + 1, dist[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        row[j] = Math.min(row[j]!, dist[i - 2]![j - 2]! + cost);
      }
    }
  }
  return dist[aLen]![bLen]!;
}

export interface NearestCorpusMatch {
  name: string;
  distance: number;
}

/**
 * Finds the nearest corpus name within `maxDistance` (inclusive).
 * Returns null when nothing is within the budget. Length-delta pruning
 * keeps the scan cheap against a ~5k corpus.
 */
export function findNearestCorpusMatch(
  candidate: string,
  corpus: readonly string[],
  maxDistance = 2,
): NearestCorpusMatch | null {
  const normalized = candidate.trim().toLowerCase();
  if (!normalized) return null;

  let best: NearestCorpusMatch | null = null;
  for (const entry of corpus) {
    const lengthDelta = Math.abs(entry.length - normalized.length);
    if (lengthDelta > maxDistance) continue;
    if (entry === normalized) continue;
    const distance = damerauLevenshtein(normalized, entry);
    if (distance > maxDistance) continue;
    if (!best || distance < best.distance) {
      best = { name: entry, distance };
      if (distance === 0) break;
    }
  }
  return best;
}
