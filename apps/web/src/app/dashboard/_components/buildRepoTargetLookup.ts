import type { TargetCard } from '../../../utils/clientApi';

const TARGET_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Map repository id → real UUID target id for canary / guardian panels.
 * Synthetic `repo:…` cards are omitted — they are not writable targets.
 */
export function buildRepoTargetLookup(targets: TargetCard[]): Record<string, string> {
  const byRepoId: Record<string, string> = {};
  for (const target of targets) {
    if (target.kind === 'repo' && target.repositoryId && TARGET_UUID.test(target.id)) {
      byRepoId[target.repositoryId] = target.id;
    }
  }
  return byRepoId;
}
