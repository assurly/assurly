import type { ReactElement, ReactNode } from 'react';

export interface DashboardSettingsProps {
  repoList: ReactNode;
  sharedReports: ReactNode;
  apiKeys: ReactNode;
  canary: ReactNode;
}

export function DashboardSettings({
  repoList,
  sharedReports,
  apiKeys,
  canary,
}: DashboardSettingsProps): ReactElement {
  return (
    <div className="dashboard-view dashboard-view--settings">
      <h1 className="dashboard-settings__title">Settings</h1>
      {repoList}
      {sharedReports}
      {apiKeys}
      {canary}
    </div>
  );
}
