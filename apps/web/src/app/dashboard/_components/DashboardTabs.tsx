'use client';

import type { ReactElement } from 'react';
import type { DashboardMainTab } from './publicRepoInputReset';
import { DashboardFolderIcon, DashboardSearchIcon } from './icons/DashboardIcons';

export interface DashboardTabsProps {
  activeTab: DashboardMainTab;
  onTabChange: (tab: DashboardMainTab) => void;
}

export function DashboardTabs({ activeTab, onTabChange }: DashboardTabsProps): ReactElement {
  return (
    <div className="dashboard-tabs">
      <button
        type="button"
        className={`dashboard-tab${activeTab === 'repositories' ? ' active' : ''}`}
        onClick={() => onTabChange('repositories')}
        aria-label="Repositories"
      >
        <DashboardFolderIcon />
        Repositories
      </button>
      <button
        type="button"
        className={`dashboard-tab${activeTab === 'checker' ? ' active' : ''}`}
        onClick={() => onTabChange('checker')}
        aria-label="Manual Checker"
      >
        <DashboardSearchIcon />
        Manual Checker
      </button>
    </div>
  );
}
