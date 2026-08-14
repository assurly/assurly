import type { TargetCard } from '../../../utils/clientApi';

/**
 * After this many days without a check, Guardian cards look abandoned.
 * Daily guardian cron covers verified URLs; repos still need a manual rescan.
 */
export const STALE_SCAN_DAYS = 7;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** True when the app was never checked, or the last check is older than the stale window. */
export function isScanStale(lastCheckedAt: string | null, now: number = Date.now()): boolean {
  if (!lastCheckedAt) return true;
  const then = new Date(lastCheckedAt).getTime();
  if (Number.isNaN(then)) return true;
  return now - then >= STALE_SCAN_DAYS * MS_PER_DAY;
}

/**
 * Whether this card can start a rescan from the Your apps grid.
 * - Repos: kick off the existing GitHub static scan for `repositoryId`.
 * - URLs: ownership-gated live reprobe (requires a real target UUID).
 */
export function canRescanVerdictCard(card: TargetCard): boolean {
  if (card.kind === 'repo') {
    // Invalid names and CLI-only repos must not offer a doomed "Scan now".
    if ((card.scanCapability ?? 'browser') !== 'browser') return false;
    return Boolean(card.repositoryId);
  }
  if (card.kind === 'url') {
    return card.ownershipVerified && isUuidTargetId(card.id);
  }
  const _exhaustive: never = card.kind;
  return _exhaustive;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuidTargetId(id: string): boolean {
  return UUID_RE.test(id);
}

/** Button copy: first check vs refresh of a stale verdict. */
export function rescanActionLabel(lastCheckedAt: string | null): string {
  return lastCheckedAt ? 'Rescan' : 'Scan now';
}
