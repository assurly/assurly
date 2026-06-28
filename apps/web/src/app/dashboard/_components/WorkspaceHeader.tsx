'use client';

import type { ReactElement } from 'react';
import type { Organization } from '../../../utils/dbAdapter';
import { DashboardBuildingIcon } from './icons/DashboardIcons';

export interface WorkspaceHeaderProps {
  orgName?: string | null;
  billingPlan?: Organization['billing_plan'];
}

function getWorkspaceDisplayName(orgName?: string | null): string {
  return orgName?.trim() || 'My Workspace';
}

function getPlanBadgeLabel(billingPlan: Organization['billing_plan']): string {
  return billingPlan === 'pro' ? 'Pro Plan' : 'Free Plan';
}

function getPlanBadgeClassName(billingPlan: Organization['billing_plan']): string {
  return billingPlan === 'pro'
    ? 'dashboard-workspace__plan-badge dashboard-workspace__plan-badge--pro'
    : 'dashboard-workspace__plan-badge dashboard-workspace__plan-badge--free';
}

export function WorkspaceHeader({
  orgName,
  billingPlan = 'free',
}: WorkspaceHeaderProps): ReactElement {
  const displayName = getWorkspaceDisplayName(orgName);
  const planLabel = getPlanBadgeLabel(billingPlan);
  const planBadgeClassName = getPlanBadgeClassName(billingPlan);

  return (
    <>
      <section
        className="dashboard-workspace dashboard-workspace--desktop"
        aria-label="Active workspace"
      >
        <div className="dashboard-workspace__content">
          <p className="dashboard-workspace__eyebrow">Active Workspace</p>
          <h2 className="dashboard-workspace__title">
            <DashboardBuildingIcon />
            <span>{displayName}</span>
            <span className={planBadgeClassName}>{planLabel}</span>
          </h2>
        </div>
      </section>

      <details className="dashboard-workspace dashboard-workspace--mobile">
        <summary
          className="dashboard-workspace__strip"
          data-testid="workspace-mobile-strip"
          aria-label={`Workspace: ${displayName}, ${planLabel}`}
        >
          <DashboardBuildingIcon />
          <span className="dashboard-workspace__name">{displayName}</span>
          <span className={planBadgeClassName}>{planLabel}</span>
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
