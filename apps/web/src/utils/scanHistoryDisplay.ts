import type { Scan } from './dbAdapter';

/** Git commit SHAs we collapse on. Placeholders like `unknown` stay unique. */
const HEX_COMMIT_SHA = /^[0-9a-f]{7,40}$/i;

export function formatCommitShaShort(commitSha: string): string {
  if (commitSha.length > 8 && /^[0-9a-f]+$/i.test(commitSha)) {
    return commitSha.substring(0, 7);
  }
  return commitSha;
}

export function formatScanTime(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) {
    return isoTimestamp;
  }
  // Pin en-US so Node SSR and the browser agree. Leaving the locale ambient
  // makes the string follow the runtime default (en-US on the server, the
  // visitor's locale in Chromium) and React reports a hydration mismatch.
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function commitIdentityKey(scan: Scan): string {
  const sha = scan.commit_sha ?? '';
  return HEX_COMMIT_SHA.test(sha) ? sha.toLowerCase() : `id:${scan.id}`;
}

/** Failed Instant Gate size checks are not real scans — hide them from the history rail. */
export function excludeTooLargeFailedScans(scans: readonly Scan[]): Scan[] {
  return scans.filter((scan) => scan.failure_reason !== 'too_large');
}

/**
 * One chip per commit: keep the newest scan for each hex SHA.
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

/** Header / list counts must match the history rail (one chip per commit). */
export function countVisibleScanHistory(scans: readonly Scan[]): number {
  return excludeTooLargeFailedScans(selectLatestScanPerCommit(scans)).length;
}

export function formatScanHistoryChipLabel(scan: Scan): string {
  return `commit ${formatCommitShaShort(scan.commit_sha)} · ${formatScanTime(scan.created_at)}`;
}
