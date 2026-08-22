import type { ReactElement, ReactNode } from 'react';

export interface DashboardSettingsProps {
  repoList: ReactNode;
  apiKeys: ReactNode;
  canary: ReactNode;
}

export function DashboardSettings({
  repoList,
  apiKeys,
  canary,
}: DashboardSettingsProps): ReactElement {
  return (
    <div className="dashboard-view dashboard-view--settings">
      <h1 className="dashboard-settings__title">Settings</h1>
      {repoList}
      {apiKeys}
      {canary}
    </div>
  );
}
