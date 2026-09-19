/**
 * Redaction helpers shared by the probe executors. Local to `probes/` — avoids
 * importing runtimeScanner (circular with the planner path).
 *
 * Probe evidence must prove access without carrying the data it proves access
 * to: every value that reaches a user, a report, or the database goes through
 * here first.
 */

export function redactCell(value: unknown): string {
  if (value === null || value === undefined) return '(empty)';
  if (typeof value === 'number' || typeof value === 'boolean') return '***';
  const str = String(value);
  const email = str.match(/^([^@\s]+)@([^@\s]+\.[^@\s]+)$/);
  if (email) {
    const local = email[1];
    const tld = email[2].split('.').pop() ?? '';
    return `${local[0] ?? ''}***@***.${tld}`;
  }
  if (str.length <= 1) return '***';
  return `${str[0]}***`;
}

export function pickRedactedSampleCell(row: Record<string, unknown>): string | undefined {
  const stringEntry = Object.values(row).find(
    (value) => typeof value === 'string' && value.length > 0,
  );
  if (stringEntry !== undefined) return redactCell(stringEntry);
  const anyEntry = Object.values(row)[0];
  return anyEntry === undefined ? undefined : redactCell(anyEntry);
}
