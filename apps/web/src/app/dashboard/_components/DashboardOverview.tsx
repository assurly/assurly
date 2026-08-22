import type { ReactElement, ReactNode } from 'react';

export interface DashboardOverviewProps {
  header: ReactNode;
  apps: ReactNode;
  tools: ReactNode;
  urlResults?: ReactNode;
}

export function DashboardOverview({
  header,
  apps,
  tools,
  urlResults = null,
}: DashboardOverviewProps): ReactElement {
  return (
    <div className="dashboard-view dashboard-view--apps">
      {header}
      {apps}
      <div className="dashboard-overview-tools">{tools}</div>
      {urlResults}
    </div>
  );
}
