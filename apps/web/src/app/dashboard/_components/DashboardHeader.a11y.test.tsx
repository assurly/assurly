// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRef } from 'react';
import { DashboardHeader } from './DashboardHeader';
import type { Organization, User } from '../../../utils/dbAdapter';

afterEach(() => cleanup());

const user: User = {
  id: 'user-1',
  name: 'Tibor',
  email: 'tibor@example.com',
  avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4',
};

const org: Organization = {
  id: 'org-1',
  name: 'Workspace',
  billing_plan: 'pro',
  created_at: '2026-01-01T00:00:00.000Z',
};

describe('DashboardHeader brand a11y', () => {
  it('names the home brand link Assurly via the logo, not Ass url y', () => {
    render(
      <DashboardHeader
        user={user}
        org={org}
        currencySymbol="$"
        isProfileOpen={false}
        billingAction={null}
        profileRef={createRef<HTMLDivElement>()}
        profileMenuRef={createRef<HTMLDivElement>()}
        onToggleProfile={vi.fn()}
        onManageBilling={vi.fn()}
        onCheckout={vi.fn()}
      />,
    );

    const brand = screen.getByRole('link', { name: 'Assurly' });
    expect(screen.getByRole('img', { name: 'Assurly' })).toBeTruthy();
    expect(brand.querySelector('.assurly-logo')?.getAttribute('aria-label')).toBe('Assurly');
    expect(screen.queryByRole('link', { name: /Ass url y/i })).toBeNull();
  });

  it('gives the profile avatar a non-empty alt while keeping it presentational', () => {
    const { container } = render(
      <DashboardHeader
        user={user}
        org={org}
        currencySymbol="$"
        isProfileOpen={false}
        billingAction={null}
        profileRef={createRef<HTMLDivElement>()}
        profileMenuRef={createRef<HTMLDivElement>()}
        onToggleProfile={vi.fn()}
        onManageBilling={vi.fn()}
        onCheckout={vi.fn()}
      />,
    );

    const avatar = container.querySelector('img.profile-avatar-img');
    expect(avatar).toBeTruthy();
    expect(avatar?.getAttribute('alt')).toBe('Tibor avatar');
    expect(avatar?.getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByRole('button', { name: /Open account menu for Tibor/i })).toBeTruthy();
  });

  it('surfaces Pro Plan once — inside the account menu only', () => {
    render(
      <DashboardHeader
        user={user}
        org={org}
        currencySymbol="$"
        isProfileOpen
        billingAction={null}
        profileRef={createRef<HTMLDivElement>()}
        profileMenuRef={createRef<HTMLDivElement>()}
        onToggleProfile={vi.fn()}
        onManageBilling={vi.fn()}
        onCheckout={vi.fn()}
      />,
    );

    const badges = screen.getAllByText('Pro Plan');
    expect(badges).toHaveLength(1);
    const menu = screen.getByRole('dialog', { name: 'Account menu' });
    expect(menu.contains(badges[0]!)).toBe(true);
  });
});
