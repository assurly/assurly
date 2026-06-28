'use client';

import type { ReactElement } from 'react';
import { DashboardFolderIcon } from './icons/DashboardIcons';

export interface SelectedRepoHeaderProps {
  repoName: string;
  scanCount: number;
  canJumpToResults: boolean;
  onJumpToResults: () => void;
}

export function formatSelectedRepoScanCount(scanCount: number): string {
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
}: SelectedRepoHeaderProps): ReactElement {
  return (
    <section
      className="selected-repo-header"
      data-testid="selected-repo-header"
      aria-label={`Selected repository ${repoName}`}
    >
      <div className="selected-repo-header__info">
        <h2 className="selected-repo-header__name">
          <DashboardFolderIcon />
          <span>{repoName}</span>
        </h2>
        <p className="selected-repo-header__meta">{formatSelectedRepoScanCount(scanCount)}</p>
      </div>

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
    </section>
  );
}
