'use client';

import type { ReactElement } from 'react';
import type { BillingPlan } from '../../../utils/entitlements';
import { resolveWorkspaceDisplayName } from '../../../utils/workspaceName';
import { DashboardBuildingIcon } from './icons/DashboardIcons';

export interface WorkspaceHeaderProps {
  orgName?: string | null;
  /** GitHub login / profile name — used to replace legacy placeholder org titles. */
  ownerLabel?: string | null;
  billingPlan?: BillingPlan | null;
}

export function formatWorkspacePlanBadge(plan: BillingPlan): string {
  switch (plan) {
    case 'pro':
      return 'Pro Plan';
    case 'free':
      return 'Free Plan';
    case 'oem':
      return 'OEM';
    default: {
      const neverPlan: never = plan;
      return neverPlan;
    }
  }
}

function PlanBadge({ plan }: { plan: BillingPlan }): ReactElement {
  const modifier = plan === 'free' ? 'free' : 'pro';
  return (
    <span
      className={`dashboard-workspace__plan-badge dashboard-workspace__plan-badge--${modifier}`}
    >
      {formatWorkspacePlanBadge(plan)}
    </span>
  );
}

/**
 * Compact workspace identity: name + plan badge. Billing actions stay in the account menu.
 */
export function WorkspaceHeader({
  orgName,
  ownerLabel,
  billingPlan = null,
}: WorkspaceHeaderProps): ReactElement {
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
            <h1 className="dashboard-workspace__heading">
              <DashboardBuildingIcon />
              <span>{displayName}</span>
            </h1>
            {billingPlan ? <PlanBadge plan={billingPlan} /> : null}
          </div>
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
          {billingPlan ? <PlanBadge plan={billingPlan} /> : null}
        </summary>
        <div className="dashboard-workspace__panel">
          <p className="dashboard-workspace__eyebrow">Active Workspace</p>
        </div>
      </details>
    </>
  );
}
