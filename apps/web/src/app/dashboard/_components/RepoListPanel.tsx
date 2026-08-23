'use client';

import { useMemo, useState, type ReactElement } from 'react';
import type { Repository } from '../../../utils/dbAdapter';
import { filterRepositories } from './repoListFilter';
import { DashboardFolderIcon } from './icons/DashboardIcons';

export interface RepoListPanelProps {
  repositories: Repository[];
  /** Repos the user removed from Your apps. Restoring is the only way back. */
  dismissedRepositories: Repository[];
  selectedRepoId: string | null;
  scanCountsByRepoId: Record<string, number>;
  hasGitHubInstallation: boolean;
  restoringRepositoryId: string | null;
  onSelectRepository: (repository: Repository) => void;
  onRestoreRepository: (repositoryId: string) => void;
}

export function formatRepositoryScanCount(scanCount: number): string {
  if (scanCount === 0) {
    return 'No scans';
  }
  return scanCount === 1 ? '1 scan' : `${scanCount} scans`;
}

export function RepoListPanel({
  repositories,
  dismissedRepositories,
  selectedRepoId,
  scanCountsByRepoId,
  hasGitHubInstallation,
  restoringRepositoryId,
  onSelectRepository,
  onRestoreRepository,
}: RepoListPanelProps): ReactElement {
  const [filterQuery, setFilterQuery] = useState('');
  const filteredRepositories = useMemo(
    () => filterRepositories(repositories, filterQuery),
    [repositories, filterQuery],
  );

  return (
    <section className="repo-list-panel" data-testid="repo-list-panel">
      <h2 className="repo-list-panel__title">Connected repositories</h2>

      {repositories.length > 0 ? (
        <label className="repo-list-panel__filter">
          <span className="visually-hidden">Filter repositories</span>
          <input
            type="search"
            className="repo-list-panel__filter-input"
            placeholder="Filter repositories…"
            value={filterQuery}
            onChange={(event) => setFilterQuery(event.target.value)}
            data-testid="repo-list-filter"
          />
        </label>
      ) : null}

      <div className="repo-list-panel__list">
        {repositories.length === 0 ? (
          <p className="repo-list-panel__empty">No repositories connected.</p>
        ) : filteredRepositories.length === 0 ? (
          <p className="repo-list-panel__empty" data-testid="repo-list-no-match">
            No repositories match
          </p>
        ) : (
          filteredRepositories.map((repository) => {
            const isSelected = selectedRepoId === repository.id;
            const scanCount = scanCountsByRepoId[repository.id] ?? 0;

            return (
              <button
                key={repository.id}
                type="button"
                onClick={() => onSelectRepository(repository)}
                className={`dashboard-repo-list-item${isSelected ? ' dashboard-repo-list-item--selected' : ''}`}
                aria-pressed={isSelected}
                aria-label={`Select repository ${repository.name}`}
              >
                <span className="dashboard-repo-list-item__name">
                  <DashboardFolderIcon />
                  <span>{repository.name}</span>
                </span>
                <span className="dashboard-repo-list-meta">
                  {formatRepositoryScanCount(scanCount)}
                  {isSelected ? (
                    <span
                      className="dashboard-repo-list-item__selected-indicator"
                      aria-hidden="true"
                    >
                      {' '}
                      ●
                    </span>
                  ) : null}
                </span>
              </button>
            );
          })
        )}

        {!hasGitHubInstallation ? (
          <div className="repo-list-panel__install">
            <p className="repo-list-panel__install-copy">
              Install the GitHub App to automatically check pull requests and connect private
              repositories.
            </p>
            <a className="repo-list-panel__cta" href="/api/github/install/start">
              Install Assurly App
            </a>
          </div>
        ) : null}

        {hasGitHubInstallation ? (
          <div className="repo-list-panel__permissions">
            <a
              className="repo-list-panel__cta"
              href="/api/github/install/start"
              data-testid="repo-list-permissions-cta"
            >
              Adjust GitHub App permissions
            </a>
          </div>
        ) : null}
      </div>

      {dismissedRepositories.length > 0 ? (
        <div className="repo-list-panel__hidden" data-testid="repo-list-hidden">
          <h3 className="repo-list-panel__hidden-title">Hidden repositories</h3>
          <p className="repo-list-panel__hidden-copy">
            Removed from Your apps. Scan history was kept — restore to guard them again.
          </p>
          {dismissedRepositories.map((repository) => (
            <div key={repository.id} className="repo-list-panel__hidden-item">
              <span className="repo-list-panel__hidden-name">{repository.name}</span>
              <button
                type="button"
                className="repo-list-panel__restore"
                onClick={() => onRestoreRepository(repository.id)}
                disabled={restoringRepositoryId === repository.id}
                aria-label={`Restore repository ${repository.name}`}
              >
                {restoringRepositoryId === repository.id ? 'Restoring…' : 'Restore'}
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export { filterRepositories } from './repoListFilter';
