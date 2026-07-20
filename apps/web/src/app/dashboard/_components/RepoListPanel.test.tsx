// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RepoListPanel, formatRepositoryScanCount, type RepoListPanelProps } from './RepoListPanel';
import { filterRepositories } from './repoListFilter';
import type { Repository } from '../../../utils/dbAdapter';

const repositories: Repository[] = [
  {
    id: 'repo-attesta',
    organization_id: 'org-1',
    name: 'tibco87/Attesta',
    github_repo_id: 101,
    is_active: true,
    created_at: '2026-06-21T00:00:00Z',
  },
  {
    id: 'repo-attesta-fixes',
    organization_id: 'org-1',
    name: 'tibco87/Attesta---Fixes',
    github_repo_id: 102,
    is_active: true,
    created_at: '2026-06-21T00:00:00Z',
  },
  {
    id: 'repo-leaks',
    organization_id: 'org-1',
    name: 'react-client-leaks',
    github_repo_id: 103,
    is_active: true,
    created_at: '2026-06-21T00:00:00Z',
  },
  {
    id: 'repo-empty',
    organization_id: 'org-1',
    name: 'empty-repo',
    github_repo_id: 104,
    is_active: true,
    created_at: '2026-06-21T00:00:00Z',
  },
];

function renderPanel(overrides: Partial<RepoListPanelProps> = {}): ReturnType<typeof render> {
  return render(
    <RepoListPanel
      repositories={repositories}
      selectedRepoId="repo-attesta"
      scanCountsByRepoId={{
        'repo-attesta': 3,
        'repo-attesta-fixes': 1,
      }}
      hasGitHubInstallation={true}
      onSelectRepository={vi.fn()}
      {...overrides}
    />,
  );
}

afterEach(() => {
  cleanup();
});

describe('filterRepositories', () => {
  it('matches repository names case-insensitively', () => {
    expect(filterRepositories(repositories, 'attesta')).toHaveLength(2);
    expect(filterRepositories(repositories, 'ATTesta')).toHaveLength(2);
    expect(filterRepositories(repositories, 'attesta').map((repo) => repo.name)).toEqual([
      'tibco87/Attesta',
      'tibco87/Attesta---Fixes',
    ]);
  });

  it('returns the full list when the filter is empty', () => {
    expect(filterRepositories(repositories, '')).toHaveLength(repositories.length);
    expect(filterRepositories(repositories, '   ')).toHaveLength(repositories.length);
  });
});

describe('RepoListPanel', () => {
  it('formats scan count labels', () => {
    expect(formatRepositoryScanCount(0)).toBe('No scans');
    expect(formatRepositoryScanCount(1)).toBe('1 scan');
    expect(formatRepositoryScanCount(4)).toBe('4 scans');
  });

  it('filters repositories as the user types', () => {
    renderPanel();

    const filterInput = screen.getByTestId('repo-list-filter');
    fireEvent.change(filterInput, { target: { value: 'attesta' } });

    const list = screen.getByTestId('repo-list-panel');
    const buttons = within(list).getAllByRole('button');
    expect(buttons).toHaveLength(2);
    expect(buttons[0]?.textContent).toMatch(/tibco87\/Attesta(?!---Fixes)/);
    expect(buttons[1]?.textContent).toMatch(/Attesta---Fixes/);
  });

  it('shows an empty filter state when nothing matches', () => {
    renderPanel();

    fireEvent.change(screen.getByTestId('repo-list-filter'), {
      target: { value: 'does-not-exist' },
    });

    expect(screen.getByTestId('repo-list-no-match')).toBeTruthy();
    expect(screen.getByText('No repositories match')).toBeTruthy();
  });

  it('restores the full repository list when the filter is cleared', () => {
    renderPanel();

    const filterInput = screen.getByTestId('repo-list-filter');
    fireEvent.change(filterInput, { target: { value: 'attesta' } });
    expect(within(screen.getByTestId('repo-list-panel')).getAllByRole('button')).toHaveLength(2);

    fireEvent.change(filterInput, { target: { value: '' } });
    expect(within(screen.getByTestId('repo-list-panel')).getAllByRole('button')).toHaveLength(4);
  });

  it('calls onSelectRepository when a repository is clicked', () => {
    const onSelectRepository = vi.fn();
    renderPanel({ onSelectRepository });

    fireEvent.click(screen.getByRole('button', { name: /select repository react-client-leaks/i }));

    expect(onSelectRepository).toHaveBeenCalledTimes(1);
    expect(onSelectRepository).toHaveBeenCalledWith(repositories[2]);
  });

  it('does not render emoji icons in repository buttons', () => {
    renderPanel();

    const buttons = within(screen.getByTestId('repo-list-panel')).getAllByRole('button');
    for (const button of buttons) {
      expect(button.textContent).not.toMatch(/📁/);
    }

    expect(
      screen.getByRole('button', { name: /select repository tibco87\/Attesta(?!---Fixes)/i }),
    ).toBeTruthy();
  });

  it('shows the connected empty state when there are no repositories', () => {
    renderPanel({ repositories: [] });

    expect(screen.getByText('No repositories connected.')).toBeTruthy();
    expect(screen.queryByTestId('repo-list-filter')).toBeNull();
  });

  it('renders Adjust GitHub App permissions as a CTA when installation exists', () => {
    renderPanel({ hasGitHubInstallation: true });

    const permissionsCta = screen.getByTestId('repo-list-permissions-cta');
    expect(permissionsCta.tagName).toBe('A');
    expect(permissionsCta.getAttribute('href')).toBe('/api/github/install/start');
    expect(permissionsCta.className).toContain('repo-list-panel__cta');
    expect(permissionsCta.textContent).toBe('Adjust GitHub App permissions');
  });

  it('renders Install Assurly App CTA when installation is missing', () => {
    renderPanel({ hasGitHubInstallation: false });

    expect(screen.queryByTestId('repo-list-permissions-cta')).toBeNull();
    const installCta = screen.getByRole('link', { name: 'Install Assurly App' });
    expect(installCta.className).toContain('repo-list-panel__cta');
    expect(installCta.getAttribute('href')).toBe('/api/github/install/start');
  });
});
