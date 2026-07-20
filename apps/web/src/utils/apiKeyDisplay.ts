/**
 * Locale-independent display helpers for API key metadata in the dashboard.
 *
 * Uses fixed English month abbreviations and UTC calendar fields so server and
 * client always agree (a `toLocaleDateString` / localeCompare mismatch previously
 * caused a hydration bug — see utils/repositories.ts). Relative "last used"
 * phrases still depend on "now"; render them inside `<time suppressHydrationWarning>`.
 */

const MONTHS = [
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

export interface ApiKeyDisplayTimestamps {
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

/** Fixed "18 Jul" form from a UTC ISO timestamp. */
export function formatApiKeyDay(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) {
    return isoTimestamp;
  }
  const day = date.getUTCDate();
  const month = MONTHS[date.getUTCMonth()];
  return `${day} ${month}`;
}

function formatLastUsedPhrase(lastUsedAt: string | null, nowMs: number): string {
  if (!lastUsedAt) {
    return 'Never used';
  }
  const usedMs = new Date(lastUsedAt).getTime();
  if (Number.isNaN(usedMs)) {
    return 'Never used';
  }

  const diffMs = Math.max(0, nowMs - usedMs);
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) {
    return 'Last used just now';
  }
  if (minutes < 60) {
    return `Last used ${minutes} min ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `Last used ${hours} hour${hours === 1 ? '' : 's'} ago`;
  }
  const days = Math.floor(hours / 24);
  if (days < 45) {
    return `Last used ${days} day${days === 1 ? '' : 's'} ago`;
  }
  return `Last used ${formatApiKeyDay(lastUsedAt)}`;
}

/**
 * Secondary line under a key label, e.g.
 * "Created 18 Jul · Last used 2 days ago" or "Created 18 Jul · Revoked 19 Jul".
 */
export function formatApiKeyMetadata(key: ApiKeyDisplayTimestamps, now: Date = new Date()): string {
  const created = `Created ${formatApiKeyDay(key.createdAt)}`;
  if (key.revokedAt) {
    return `${created} · Revoked ${formatApiKeyDay(key.revokedAt)}`;
  }
  return `${created} · ${formatLastUsedPhrase(key.lastUsedAt, now.getTime())}`;
}
