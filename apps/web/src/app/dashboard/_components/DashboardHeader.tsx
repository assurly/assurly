'use client';

import Image from 'next/image';
import Link from 'next/link';
import type { RefObject, ReactElement } from 'react';
import type { Organization, User } from '../../../utils/dbAdapter';
import { AssurlyLogo } from './icons/AssurlyLogo';
import { DashboardRocketIcon, DashboardSettingsIcon } from './icons/DashboardIcons';

export interface DashboardHeaderProps {
  user: User;
  org: Organization | null;
  currencySymbol: string;
  isProfileOpen: boolean;
  billingAction: 'checkout' | 'portal' | null;
  profileRef: RefObject<HTMLDivElement | null>;
  profileMenuRef: RefObject<HTMLDivElement | null>;
  onToggleProfile: (trigger: HTMLButtonElement) => void;
  onManageBilling: () => void;
  onCheckout: (plan: 'monthly' | 'yearly') => void;
}

export function DashboardHeader({
  user,
  org,
  currencySymbol,
  isProfileOpen,
  billingAction,
  profileRef,
  profileMenuRef,
  onToggleProfile,
  onManageBilling,
  onCheckout,
}: DashboardHeaderProps): ReactElement {
  return (
    <header className={`dashboard-header${isProfileOpen ? ' dashboard-header-menu-open' : ''}`}>
      <div className="dashboard-header-brand">
        {/* Accessible name comes from AssurlyLogo (role=img aria-label="Assurly"). */}
        <Link href="/" className="dashboard-header-brand-link">
          <AssurlyLogo />
        </Link>
      </div>

      <div className="dashboard-header-right" ref={profileRef}>
        <button
          type="button"
          className={`profile-trigger-btn ${isProfileOpen ? 'active' : ''}`}
          onClick={(event) => onToggleProfile(event.currentTarget)}
          aria-label={`${isProfileOpen ? 'Close' : 'Open'} account menu for ${user.name?.trim() || 'user'}`}
          aria-expanded={isProfileOpen}
          aria-controls="account-menu"
          aria-haspopup="dialog"
        >
          <Image
            src={user.avatar_url || 'https://avatars.githubusercontent.com/u/9919?v=4'}
            alt={`${user.name?.trim() || 'User'} avatar`}
            aria-hidden="true"
            className="profile-avatar-img"
            width={36}
            height={36}
            unoptimized
          />
          <span className="dashboard-username" aria-hidden="true">
            {user.name}
          </span>
          <span className="profile-arrow" aria-hidden="true">
            ▼
          </span>
        </button>

        <button
          type="button"
          className="hamburger-btn"
          onClick={(event) => onToggleProfile(event.currentTarget)}
          aria-label={isProfileOpen ? 'Close account menu' : 'Open account menu'}
          aria-expanded={isProfileOpen}
          aria-controls="account-menu"
          aria-haspopup="dialog"
        >
          <span className={`bar ${isProfileOpen ? 'open' : ''}`} aria-hidden="true" />
          <span className={`bar ${isProfileOpen ? 'open' : ''}`} aria-hidden="true" />
          <span className={`bar ${isProfileOpen ? 'open' : ''}`} aria-hidden="true" />
        </button>

        {isProfileOpen ? (
          <div
            id="account-menu"
            ref={profileMenuRef}
            className="profile-dropdown-menu"
            role="dialog"
            aria-label="Account menu"
          >
            <div className="profile-dropdown-header">
              <span className="profile-dropdown-name">{user.name}</span>
              <span className="profile-dropdown-email">{user.email}</span>
              {/* Single plan signal for the whole dashboard — not repeated on Workspace. */}
              <div className="profile-dropdown-plan-badge">
                {org?.billing_plan === 'pro' ? (
                  <span className="plan-badge pro">Pro Plan</span>
                ) : (
                  <span className="plan-badge free">Free Plan</span>
                )}
              </div>
            </div>

            <div className="profile-dropdown-divider" />

            <div className="profile-dropdown-body">
              {org?.billing_plan === 'pro' ? (
                <button
                  type="button"
                  disabled={billingAction !== null}
                  aria-busy={billingAction === 'portal'}
                  onClick={onManageBilling}
                  className="profile-dropdown-item"
                >
                  <span className="profile-dropdown-item__label">
                    <DashboardSettingsIcon />
                    {billingAction === 'portal' ? 'Opening billing…' : 'Manage Billing'}
                  </span>
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={billingAction !== null}
                    aria-busy={billingAction === 'checkout'}
                    onClick={() => onCheckout('monthly')}
                    className="profile-dropdown-item upgrade"
                  >
                    <span className="profile-dropdown-item__label">
                      <DashboardRocketIcon />
                      Upgrade to Pro ({currencySymbol}19/mo)
                    </span>
                  </button>
                  <button
                    type="button"
                    disabled={billingAction !== null}
                    aria-busy={billingAction === 'checkout'}
                    onClick={() => onCheckout('yearly')}
                    className="profile-dropdown-item"
                  >
                    <span>Save ~35%: {currencySymbol}149/yr</span>
                  </button>
                </>
              )}
            </div>

            <div className="profile-dropdown-divider" />

            <div className="profile-dropdown-footer">
              <form action="/api/auth/logout" method="post">
                <button type="submit" className="profile-dropdown-logout-btn">
                  Logout
                </button>
              </form>
            </div>
          </div>
        ) : null}
      </div>
    </header>
  );
}
