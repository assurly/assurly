import type { Scan } from './dbAdapter';

/** Git commit SHAs we collapse on. Placeholders like `unknown` stay unique. */
const HEX_COMMIT_SHA = /^[0-9a-f]{7,40}$/i;

/** Pinned so Node SSR and the browser render the same chip label. */
const SCAN_DATE_TIME_FORMAT: Intl.DateTimeFormatOptions = {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
};

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
  // Pin en-US so Node SSR and the browser agree. Leaving the locale ambient
  // makes the string follow the runtime default (en-US on the server, the
  // visitor's locale in Chromium) and React reports a hydration mismatch.
  return date.toLocaleString('en-US', SCAN_DATE_TIME_FORMAT);
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
