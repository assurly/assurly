'use client';

import type { ReactElement } from 'react';
import type { DashboardNavId } from './dashboardView';
import {
  DashboardFolderIcon,
  DashboardSearchIcon,
  DashboardSettingsIcon,
} from './icons/DashboardIcons';

export interface DashboardNavProps {
  active: DashboardNavId;
  onNavigate: (id: DashboardNavId) => void;
}

export function DashboardNav({ active, onNavigate }: DashboardNavProps): ReactElement {
  return (
    <div className="dashboard-tabs" role="navigation" aria-label="Dashboard sections">
      <button
        type="button"
        className={`dashboard-tab${active === 'apps' ? ' active' : ''}`}
        onClick={() => onNavigate('apps')}
        aria-label="Apps"
        aria-current={active === 'apps' ? 'page' : undefined}
      >
        <DashboardFolderIcon />
        Apps
      </button>
      <button
        type="button"
        className={`dashboard-tab${active === 'checker' ? ' active' : ''}`}
        onClick={() => onNavigate('checker')}
        aria-label="Manual Checker"
        aria-current={active === 'checker' ? 'page' : undefined}
      >
        <DashboardSearchIcon />
        Manual Checker
      </button>
      <button
        type="button"
        className={`dashboard-tab${active === 'settings' ? ' active' : ''}`}
        onClick={() => onNavigate('settings')}
        aria-label="Settings"
        aria-current={active === 'settings' ? 'page' : undefined}
      >
        <DashboardSettingsIcon />
        Settings
      </button>
    </div>
  );
}
