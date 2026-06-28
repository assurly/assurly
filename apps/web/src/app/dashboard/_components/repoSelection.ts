import type { ScanFinding } from '../../../utils/dbAdapter';

export type RepoDetailStatus = 'loading' | 'ready' | 'empty';

export interface RepoSelectionReset {
  selectedScan: null;
  findings: [];
  scans: [];
  shareError: null;
  repoDetailStatus: 'loading';
}

export function createRepoSelectionReset(): RepoSelectionReset {
  return {
    selectedScan: null,
    findings: [],
    scans: [],
    shareError: null,
    repoDetailStatus: 'loading',
  };
}

export function resolveRepoDetailStatusAfterScans(
  scanCount: number,
  hasLocalScanForRepo: boolean,
): 'loading' | 'empty' {
  if (scanCount === 0 && !hasLocalScanForRepo) {
    return 'empty';
  }
  return 'loading';
}

export function markRepoDetailReady(current: RepoDetailStatus): RepoDetailStatus {
  return current === 'ready' ? current : 'ready';
}

export function findingsMatchScan(findings: ScanFinding[], scanId: string | undefined): boolean {
  if (!scanId) {
    return findings.length === 0;
  }
  if (findings.length === 0) {
    return true;
  }
  return findings.every((finding) => finding.scan_id === scanId);
}
