'use client';

import type { ReactElement } from 'react';
import { DashboardFolderIcon } from './icons/DashboardIcons';
import type { RepoDetailStatus } from './repoSelection';

export interface SelectedRepoHeaderProps {
  repoName: string;
  scanCount: number;
  canJumpToResults: boolean;
  onJumpToResults: () => void;
  scanBranch?: string | null;
  repoBranches?: string[];
  onScanBranchChange?: (branch: string) => void;
  branchSelectDisabled?: boolean;
  repoDetailStatus?: RepoDetailStatus;
}

export function formatSelectedRepoScanCount(
  scanCount: number,
  repoDetailStatus?: RepoDetailStatus,
): string {
  if (repoDetailStatus === 'loading' && scanCount === 0) {
    return 'Loading scans…';
  }
  if (scanCount === 0) {
    return 'No scans';
  }
  return scanCount === 1 ? '1 scan' : `${scanCount} scans`;
}

export function SelectedRepoHeader({
  repoName,
  scanCount,
  canJumpToResults,
  onJumpToResults,
  scanBranch = null,
  repoBranches = [],
  onScanBranchChange,
  branchSelectDisabled = false,
  repoDetailStatus,
}: SelectedRepoHeaderProps): ReactElement {
  const branchOptions =
    scanBranch && !repoBranches.includes(scanBranch) ? [scanBranch, ...repoBranches] : repoBranches;
  const isLoadingScans = repoDetailStatus === 'loading' && scanCount === 0;

  return (
    <section
      className="selected-repo-header"
      data-testid="selected-repo-header"
      aria-label={`Selected repository ${repoName}`}
    >
      <div className="selected-repo-header__info">
        <h1 className="selected-repo-header__name">
          <DashboardFolderIcon />
          <span>{repoName}</span>
        </h1>
        <p className="selected-repo-header__meta" aria-busy={isLoadingScans}>
          {formatSelectedRepoScanCount(scanCount, repoDetailStatus)}
        </p>
      </div>

      <div className="selected-repo-header__actions">
        {branchOptions.length > 0 && onScanBranchChange ? (
          <label className="selected-repo-header__branch">
            <span className="visually-hidden">Scan branch</span>
            <select
              data-testid="scan-branch-select"
              aria-label="Scan branch"
              value={scanBranch ?? branchOptions[0]}
              disabled={branchSelectDisabled}
              onChange={(event) => onScanBranchChange(event.target.value)}
            >
              {branchOptions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {canJumpToResults ? (
          <button
            type="button"
            className="selected-repo-header__jump"
            data-testid="selected-repo-jump-btn"
            onClick={onJumpToResults}
          >
            Jump to results
          </button>
        ) : null}
      </div>
    </section>
  );
}
