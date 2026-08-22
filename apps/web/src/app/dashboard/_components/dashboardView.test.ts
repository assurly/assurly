import { describe, expect, it } from 'vitest';
import {
  navIdForView,
  parseDashboardRoute,
  routeAfterNavChange,
  routeAfterRepositorySelect,
  serializeDashboardSearch,
} from './dashboardView';

const KNOWN = ['repo-1', 'repo-2'] as const;

describe('parseDashboardRoute', () => {
  it('defaults to apps when the query is empty', () => {
    expect(parseDashboardRoute({ view: null, repo: null }, KNOWN)).toEqual({
      view: 'apps',
      repoId: null,
    });
  });

  it('opens the app view when the repo id is known', () => {
    expect(parseDashboardRoute({ view: 'app', repo: 'repo-2' }, KNOWN)).toEqual({
      view: 'app',
      repoId: 'repo-2',
    });
  });

  it('falls back to apps when view=app has an unknown repo', () => {
    expect(parseDashboardRoute({ view: 'app', repo: 'missing' }, KNOWN)).toEqual({
      view: 'apps',
      repoId: null,
    });
  });

  it('falls back to apps when view=app has no repo', () => {
    expect(parseDashboardRoute({ view: 'app', repo: null }, KNOWN)).toEqual({
      view: 'apps',
      repoId: null,
    });
  });

  it('parses settings with a known repo so canary tokens can deep-link', () => {
    expect(parseDashboardRoute({ view: 'settings', repo: 'repo-1' }, KNOWN)).toEqual({
      view: 'settings',
      repoId: 'repo-1',
    });
  });

  it('drops an unknown settings repo and still opens settings', () => {
    expect(parseDashboardRoute({ view: 'settings', repo: 'missing' }, KNOWN)).toEqual({
      view: 'settings',
      repoId: null,
    });
  });

  it('parses checker without keeping a repo', () => {
    expect(parseDashboardRoute({ view: 'checker', repo: 'repo-1' }, KNOWN)).toEqual({
      view: 'checker',
      repoId: null,
    });
  });

  it('treats an invalid view as apps', () => {
    expect(parseDashboardRoute({ view: 'billing', repo: 'repo-1' }, KNOWN)).toEqual({
      view: 'apps',
      repoId: null,
    });
  });
});

describe('navIdForView', () => {
  it('marks Apps active while an app detail is open', () => {
    expect(navIdForView('apps')).toBe('apps');
    expect(navIdForView('app')).toBe('apps');
    expect(navIdForView('settings')).toBe('settings');
    expect(navIdForView('checker')).toBe('checker');
  });
});

describe('serializeDashboardSearch', () => {
  it('omits view and repo for the default apps overview', () => {
    expect(serializeDashboardSearch({ view: 'apps', repoId: null }, '')).toBe('');
  });

  it('keeps unrelated query params', () => {
    expect(serializeDashboardSearch({ view: 'checker', repoId: null }, 'welcome=1')).toBe(
      '?welcome=1&view=checker',
    );
  });

  it('writes app deep links', () => {
    expect(serializeDashboardSearch({ view: 'app', repoId: 'repo-1' }, '')).toBe(
      '?view=app&repo=repo-1',
    );
  });

  it('writes settings deep links with the selected repo', () => {
    expect(serializeDashboardSearch({ view: 'settings', repoId: 'repo-1' }, '')).toBe(
      '?view=settings&repo=repo-1',
    );
  });

  it('writes settings without a repo when none is selected', () => {
    expect(serializeDashboardSearch({ view: 'settings', repoId: null }, '')).toBe('?view=settings');
  });
});

describe('routeAfterRepositorySelect', () => {
  it('keeps Settings when a repository is chosen there', () => {
    expect(routeAfterRepositorySelect('settings', 'repo-1')).toEqual({
      view: 'settings',
      repoId: 'repo-1',
    });
  });

  it('opens the app workspace from Apps, app detail, or checker', () => {
    expect(routeAfterRepositorySelect('apps', 'repo-1')).toEqual({
      view: 'app',
      repoId: 'repo-1',
    });
    expect(routeAfterRepositorySelect('app', 'repo-1')).toEqual({
      view: 'app',
      repoId: 'repo-1',
    });
    expect(routeAfterRepositorySelect('checker', 'repo-1')).toEqual({
      view: 'app',
      repoId: 'repo-1',
    });
  });
});

describe('routeAfterNavChange', () => {
  it('carries the selected repo into Settings', () => {
    expect(routeAfterNavChange('settings', 'repo-1')).toEqual({
      view: 'settings',
      repoId: 'repo-1',
    });
  });

  it('clears the repo on Apps and Manual Checker', () => {
    expect(routeAfterNavChange('apps', 'repo-1')).toEqual({ view: 'apps', repoId: null });
    expect(routeAfterNavChange('checker', 'repo-1')).toEqual({
      view: 'checker',
      repoId: null,
    });
  });
});
