import type { ReactElement, ReactNode } from 'react';
import type { Repository } from '../../../utils/dbAdapter';

export interface DashboardAppViewProps {
  repositories: Repository[];
  selectedRepoId: string | null;
  onBackToApps: () => void;
  onSelectRepository: (repository: Repository) => void;
  workspace: ReactNode;
  canary: ReactNode;
}

export function DashboardAppView({
  repositories,
  selectedRepoId,
  onBackToApps,
  onSelectRepository,
  workspace,
  canary,
}: DashboardAppViewProps): ReactElement {
  return (
    <div className="dashboard-view dashboard-view--app">
      <div className="dashboard-app-toolbar">
        <button
          type="button"
          className="dashboard-app-back"
          onClick={onBackToApps}
          aria-label="Back to Apps"
        >
          Back to Apps
        </button>
        {repositories.length > 1 ? (
          <nav
            className="dashboard-app-switcher"
            aria-label="Switch repository"
            data-testid="dashboard-app-switcher"
          >
            {repositories.map((repository) => {
              const isSelected = repository.id === selectedRepoId;
              return (
                <button
                  key={repository.id}
                  type="button"
                  className={`dashboard-app-switcher__item${isSelected ? ' is-selected' : ''}`}
                  aria-pressed={isSelected}
                  aria-label={`Select repository ${repository.name}`}
                  onClick={() => onSelectRepository(repository)}
                >
                  {repository.name}
                </button>
              );
            })}
          </nav>
        ) : null}
      </div>
      {workspace}
      {canary}
    </div>
  );
}
