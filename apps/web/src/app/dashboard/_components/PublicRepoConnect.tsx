'use client';

import type { FormEvent, ReactElement } from 'react';
import type { GitHubRepository } from '../../../utils/clientApi';
import { DashboardFolderIcon } from './icons/DashboardIcons';

export interface PublicRepoConnectProps {
  publicRepoInput: string;
  isAddingRepo: boolean;
  isFetchingPublicRepos: boolean;
  discoveredPublicRepos: GitHubRepository[];
  onInputChange: (value: string) => void;
  onSubmit: (event?: FormEvent) => void;
  onClearDiscovered: () => void;
  onSelectDiscoveredRepo: (fullName: string) => void;
}

export function PublicRepoConnect({
  publicRepoInput,
  isAddingRepo,
  isFetchingPublicRepos,
  discoveredPublicRepos,
  onInputChange,
  onSubmit,
  onClearDiscovered,
  onSelectDiscoveredRepo,
}: PublicRepoConnectProps): ReactElement {
  const isSubmitDisabled = isAddingRepo || isFetchingPublicRepos || !publicRepoInput.trim();

  return (
    <section className="dashboard-public-connect" aria-label="Scan public repository">
      <h4 className="dashboard-public-connect__title">Scan Public Repository</h4>
      <p className="dashboard-public-connect__copy">
        Quickly connect and scan any public GitHub repository without installing the app.
      </p>

      <form className="dashboard-public-connect__form" onSubmit={(event) => onSubmit(event)}>
        <label className="visually-hidden" htmlFor="dashboard-public-repository">
          Public GitHub repository
        </label>
        <input
          id="dashboard-public-repository"
          type="text"
          className="dashboard-public-connect__input"
          placeholder="owner/repo (e.g. facebook/react)"
          value={publicRepoInput}
          onChange={(event) => onInputChange(event.target.value)}
          disabled={isAddingRepo || isFetchingPublicRepos}
        />
        <button
          type="submit"
          className="dashboard-public-connect__submit"
          disabled={isSubmitDisabled}
          aria-busy={isAddingRepo || isFetchingPublicRepos}
        >
          {isAddingRepo ? 'Adding...' : isFetchingPublicRepos ? 'Fetching...' : 'Connect & Scan'}
        </button>
      </form>

      {isFetchingPublicRepos ? (
        <div className="dashboard-public-connect__loading">
          <div className="dashboard-public-connect__loader pulse-loader" aria-hidden="true" />
          <span>Fetching repositories...</span>
        </div>
      ) : null}

      {!isFetchingPublicRepos && discoveredPublicRepos.length > 0 ? (
        <div className="dashboard-repo-selector">
          <div className="dashboard-repo-selector-header">
            <span>Select repository ({discoveredPublicRepos.length}):</span>
            <button
              type="button"
              className="dashboard-public-connect__clear"
              onClick={onClearDiscovered}
            >
              clear
            </button>
          </div>
          <p className="dashboard-repo-selector-hint">
            Pick a repository to connect and run a scan. Ship Gate appears after the scan finishes.
          </p>
          <div className="dashboard-repo-selector-list">
            {discoveredPublicRepos.map((repo) => (
              <button
                key={repo.full_name}
                type="button"
                className="dashboard-repo-selector-item"
                onClick={() => onSelectDiscoveredRepo(repo.full_name)}
              >
                <span className="dashboard-repo-name">
                  <DashboardFolderIcon />
                  <span>{repo.name}</span>
                </span>
                <span className="dashboard-repo-meta">
                  {repo.language ? (
                    <span className="dashboard-repo-lang">{repo.language}</span>
                  ) : null}
                  <span className="dashboard-repo-stars">★ {repo.stargazers_count}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
