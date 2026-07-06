/**
 * Returns `singular` when `count` is exactly 1, otherwise `plural`.
 * `plural` defaults to `singular + 's'` for the common regular case.
 */
export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return count === 1 ? singular : plural;
}

/**
 * Formats a labeled count with correct singular/plural agreement, e.g.
 * `formatCount(1, 'Error') === '1 Error'`, `formatCount(2, 'Error') === '2 Errors'`.
 * Pass an explicit `plural` for irregular nouns or noun phrases
 * (e.g. `formatCount(n, 'file affected', 'files affected')`).
 */
export function formatCount(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${pluralize(count, singular, plural)}`;
}
