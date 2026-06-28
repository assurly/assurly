import type { Scan } from './dbAdapter';

export interface DuplicateShaBadge {
  index: number;
  total: number;
}

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
  return date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function buildDuplicateShaBadges(scans: Scan[]): Map<string, DuplicateShaBadge> {
  const bySha = new Map<string, Scan[]>();

  for (const scan of scans) {
    const key = scan.commit_sha.toLowerCase();
    const group = bySha.get(key) ?? [];
    group.push(scan);
    bySha.set(key, group);
  }

  const badges = new Map<string, DuplicateShaBadge>();

  for (const group of bySha.values()) {
    if (group.length <= 1) {
      continue;
    }

    const sorted = [...group].sort((a, b) => a.created_at.localeCompare(b.created_at));
    sorted.forEach((scan, index) => {
      badges.set(scan.id, { index: index + 1, total: group.length });
    });
  }

  return badges;
}

export function formatDuplicateShaBadge(badge: DuplicateShaBadge): string {
  return `#${badge.index} of ${badge.total}`;
}

export function formatScanHistoryChipLabel(scan: Scan): string {
  return `commit ${formatCommitShaShort(scan.commit_sha)} · ${formatScanTime(scan.created_at)}`;
}
