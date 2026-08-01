'use client';

import type { ReactElement } from 'react';
import { resolveWorkspaceDisplayName } from '../../../utils/workspaceName';
import { DashboardBuildingIcon } from './icons/DashboardIcons';

export interface WorkspaceHeaderProps {
  orgName?: string | null;
  /** GitHub login / profile name — used to replace legacy placeholder org titles. */
  ownerLabel?: string | null;
}

/**
 * Workspace identity only. Billing plan lives in the account menu so Pro/Free
 * is not repeated three times on first paint (desktop badge + mobile strip + menu).
 */
export function WorkspaceHeader({ orgName, ownerLabel }: WorkspaceHeaderProps): ReactElement {
  const displayName = resolveWorkspaceDisplayName(orgName, ownerLabel);

  return (
    <>
      <section
        className="dashboard-workspace dashboard-workspace--desktop"
        aria-label="Active workspace"
      >
        <div className="dashboard-workspace__content">
          <p className="dashboard-workspace__eyebrow">Active Workspace</p>
          <div className="dashboard-workspace__title">
            <h2 className="dashboard-workspace__heading">
              <DashboardBuildingIcon />
              <span>{displayName}</span>
            </h2>
          </div>
          <p className="dashboard-workspace__billing-hint">
            Plan and billing are in your account menu.
          </p>
        </div>
      </section>

      <details className="dashboard-workspace dashboard-workspace--mobile">
        <summary
          className="dashboard-workspace__strip"
          data-testid="workspace-mobile-strip"
          aria-label={`Workspace: ${displayName}`}
        >
          <DashboardBuildingIcon />
          <span className="dashboard-workspace__name">{displayName}</span>
        </summary>
        <div className="dashboard-workspace__panel">
          <p className="dashboard-workspace__eyebrow">Active Workspace</p>
          <p className="dashboard-workspace__mobile-hint">
            Plan and billing options are available in your account menu.
          </p>
        </div>
      </details>
    </>
  );
}
