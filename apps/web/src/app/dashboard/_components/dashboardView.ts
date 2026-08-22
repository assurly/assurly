export type DashboardView = 'apps' | 'app' | 'settings' | 'checker';

export type DashboardNavId = 'apps' | 'settings' | 'checker';

export interface DashboardRoute {
  view: DashboardView;
  repoId: string | null;
}

const VIEWS = new Set<DashboardView>(['apps', 'app', 'settings', 'checker']);

export function parseDashboardRoute(
  params: { view: string | null; repo: string | null },
  knownRepoIds: readonly string[],
): DashboardRoute {
  const repoId = params.repo && knownRepoIds.includes(params.repo) ? params.repo : null;
  const viewParam = params.view;

  if (viewParam === 'app') {
    if (repoId) {
      return { view: 'app', repoId };
    }
    return { view: 'apps', repoId: null };
  }

  if (viewParam === 'settings') {
    return { view: 'settings', repoId };
  }

  if (viewParam === 'checker' || viewParam === 'apps') {
    return { view: viewParam, repoId: null };
  }

  if (viewParam && !VIEWS.has(viewParam as DashboardView)) {
    return { view: 'apps', repoId: null };
  }

  return { view: 'apps', repoId: null };
}

export function navIdForView(view: DashboardView): DashboardNavId {
  switch (view) {
    case 'apps':
    case 'app':
      return 'apps';
    case 'settings':
      return 'settings';
    case 'checker':
      return 'checker';
    default: {
      const neverView: never = view;
      return neverView;
    }
  }
}

export function serializeDashboardSearch(route: DashboardRoute, currentSearch: string): string {
  const params = new URLSearchParams(
    currentSearch.startsWith('?') ? currentSearch.slice(1) : currentSearch,
  );
  params.delete('view');
  params.delete('repo');

  switch (route.view) {
    case 'apps':
      break;
    case 'app':
      params.set('view', 'app');
      if (route.repoId) {
        params.set('repo', route.repoId);
      }
      break;
    case 'settings':
      params.set('view', 'settings');
      if (route.repoId) {
        params.set('repo', route.repoId);
      }
      break;
    case 'checker':
      params.set('view', 'checker');
      break;
    default: {
      const neverView: never = route.view;
      return neverView;
    }
  }

  const query = params.toString();
  return query ? `?${query}` : '';
}

/** Repo chips in Settings stay on Settings; everywhere else opens the app workspace. */
export function routeAfterRepositorySelect(
  currentView: DashboardView,
  repoId: string,
): DashboardRoute {
  switch (currentView) {
    case 'settings':
      return { view: 'settings', repoId };
    case 'apps':
    case 'app':
    case 'checker':
      return { view: 'app', repoId };
    default: {
      const neverView: never = currentView;
      return neverView;
    }
  }
}

/** Settings keeps the selected repo so canary tokens stay on the same app. */
export function routeAfterNavChange(
  nextNav: DashboardNavId,
  selectedRepoId: string | null,
): DashboardRoute {
  switch (nextNav) {
    case 'settings':
      return { view: 'settings', repoId: selectedRepoId };
    case 'checker':
      return { view: 'checker', repoId: null };
    case 'apps':
      return { view: 'apps', repoId: null };
    default: {
      const neverNav: never = nextNav;
      return neverNav;
    }
  }
}

export function replaceDashboardUrl(route: DashboardRoute): void {
  if (typeof window === 'undefined') {
    return;
  }
  const search = serializeDashboardSearch(route, window.location.search);
  window.history.replaceState(
    null,
    '',
    `${window.location.pathname}${search}${window.location.hash}`,
  );
}
