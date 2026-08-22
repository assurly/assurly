import { fireEvent, screen } from '@testing-library/react';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Selects a connected repository on the App workspace switcher.
 * Settings keeps `view=settings` when a repo is clicked, so tests must start
 * on `?view=app&repo=<id>` (or already be in the app workspace).
 */
export function openDashboardAppView(repoName?: string): void {
  if (!screen.queryByRole('button', { name: 'Back to Apps' })) {
    throw new Error(
      'openDashboardAppView requires the app workspace. Mock useSearchParams with view=app&repo=<id>.',
    );
  }

  if (repoName === undefined) {
    return;
  }

  const chip = screen.queryByRole('button', {
    name: new RegExp(`select repository ${escapeRegExp(repoName)}`, 'i'),
  });
  if (chip) {
    fireEvent.click(chip);
  }
}
