export type DashboardView = 'apps' | 'app' | 'settings' | 'checker';

export interface PublicRepoConnectSession {
  lastConnectedRepoId: string | null;
  connectedViaPublicInput: boolean;
}

export const INITIAL_PUBLIC_REPO_CONNECT_SESSION: PublicRepoConnectSession = {
  lastConnectedRepoId: null,
  connectedViaPublicInput: false,
};

/**
 * Public repository input reset policy for the dashboard Apps / Settings views.
 *
 * 1. Selecting a connected repository does not clear draft text in the public
 *    repo field, so users can keep typing `owner/repo` while browsing scans.
 * 2. After a successful public connect, selecting a different connected
 *    repository clears the public input.
 * 3. Leaving Apps, App, or Settings for Manual Checker always clears the public input.
 */
export function shouldClearPublicRepoInputOnRepoSelect(
  nextRepoId: string,
  previousRepoId: string | null,
  session: PublicRepoConnectSession,
): boolean {
  if (!previousRepoId || nextRepoId === previousRepoId) {
    return false;
  }

  return (
    session.connectedViaPublicInput &&
    session.lastConnectedRepoId !== null &&
    session.lastConnectedRepoId !== nextRepoId
  );
}

export function shouldClearPublicRepoInputOnViewChange(
  previousView: DashboardView,
  nextView: DashboardView,
): boolean {
  return previousView !== 'checker' && nextView === 'checker';
}

export function createPublicRepoConnectSession(connectedRepoId: string): PublicRepoConnectSession {
  return {
    lastConnectedRepoId: connectedRepoId,
    connectedViaPublicInput: true,
  };
}
