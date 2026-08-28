import type { Scan } from './dbAdapter';

/** Git commit SHAs we collapse on. Placeholders like `unknown` stay unique. */
const HEX_COMMIT_SHA = /^[0-9a-f]{7,40}$/i;

/** English abbreviations — iOS `toLocaleString('en-US')` inserts "at" and
 * stretched history chips across a phone width. */
const SHORT_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

function padTwoDigits(value: number): string {
  return value.toString().padStart(2, '0');
}

export function formatCommitShaShort(commitSha: string): string {
  if (commitSha.length > 8 && /^[0-9a-f]+$/i.test(commitSha)) {
    return commitSha.substring(0, 7);
  }
  return commitSha;
}

export function formatScanDateTime(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) {
    return isoTimestamp;
  }
  const month = SHORT_MONTHS[date.getMonth()] ?? 'Jan';
  return `${month} ${date.getDate()}, ${date.getFullYear()} · ${padTwoDigits(date.getHours())}:${padTwoDigits(date.getMinutes())}`;
}

function commitIdentityKey(scan: Scan): string {
  const sha = scan.commit_sha ?? '';
  return HEX_COMMIT_SHA.test(sha) ? sha.toLowerCase() : `id:${scan.id}`;
}

/** Failed Instant Gate size checks are not real scans — hide them from the history rail. */
export function excludeTooLargeFailedScans(scans: readonly Scan[]): Scan[] {
  return scans.filter((scan) => scan.failure_reason !== 'too_large');
}

/** Newest scan first so the history rail and counts share one order. */
export function sortScansNewestFirst(scans: readonly Scan[]): Scan[] {
  return [...scans].sort((left, right) => {
    if (left.created_at !== right.created_at) {
      return left.created_at < right.created_at ? 1 : -1;
    }
    return left.id < right.id ? 1 : -1;
  });
}

/**
 * History rail: every saved run, newest first. Too-large Instant Gate failures stay hidden.
 * Trend charts still collapse by commit via `selectLatestScanPerCommit`.
 */
export function visibleScanHistory(scans: readonly Scan[]): Scan[] {
  return sortScansNewestFirst(excludeTooLargeFailedScans(scans));
}

/**
 * One point per commit for Ship Score trend: keep the newest scan for each hex SHA.
 * Non-hex placeholders (`unknown`) are not collapsed — each row stays visible.
 */
export function selectLatestScanPerCommit(scans: readonly Scan[]): Scan[] {
  const latestByKey = new Map<string, Scan>();
  for (const scan of scans) {
    const key = commitIdentityKey(scan);
    const existing = latestByKey.get(key);
    if (!existing || existing.created_at < scan.created_at) {
      latestByKey.set(key, scan);
    }
  }
  const kept = new Set(latestByKey.values());
  return scans.filter((scan) => kept.has(scan));
}

/** Header / list counts must match the history rail (one chip per saved scan). */
export function countVisibleScanHistory(scans: readonly Scan[]): number {
  return excludeTooLargeFailedScans(scans).length;
}

export function formatScanHistoryChipLabel(scan: Scan): string {
  return `commit ${formatCommitShaShort(scan.commit_sha)} · ${formatScanDateTime(scan.created_at)}`;
}
