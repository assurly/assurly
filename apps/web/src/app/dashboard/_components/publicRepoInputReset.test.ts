import { describe, expect, it } from 'vitest';
import {
  INITIAL_PUBLIC_REPO_CONNECT_SESSION,
  createPublicRepoConnectSession,
  shouldClearPublicRepoInputOnRepoSelect,
  shouldClearPublicRepoInputOnViewChange,
} from './publicRepoInputReset';

describe('publicRepoInputReset policy', () => {
  it('keeps draft public repo text when switching connected repositories without a public connect', () => {
    expect(
      shouldClearPublicRepoInputOnRepoSelect(
        'repo-b',
        'repo-a',
        INITIAL_PUBLIC_REPO_CONNECT_SESSION,
      ),
    ).toBe(false);
  });

  it('clears public repo input after a public connect when selecting another connected repository', () => {
    expect(
      shouldClearPublicRepoInputOnRepoSelect(
        'repo-b',
        'repo-a',
        createPublicRepoConnectSession('repo-a'),
      ),
    ).toBe(true);
  });

  it('does not clear when re-selecting the repository that was connected via public input', () => {
    expect(
      shouldClearPublicRepoInputOnRepoSelect(
        'repo-a',
        'repo-b',
        createPublicRepoConnectSession('repo-a'),
      ),
    ).toBe(false);
  });

  it('clears public repo input when leaving Apps or Settings for Manual Checker', () => {
    expect(shouldClearPublicRepoInputOnViewChange('apps', 'checker')).toBe(true);
    expect(shouldClearPublicRepoInputOnViewChange('settings', 'checker')).toBe(true);
    expect(shouldClearPublicRepoInputOnViewChange('app', 'checker')).toBe(true);
    expect(shouldClearPublicRepoInputOnViewChange('checker', 'apps')).toBe(false);
    expect(shouldClearPublicRepoInputOnViewChange('apps', 'apps')).toBe(false);
    expect(shouldClearPublicRepoInputOnViewChange('apps', 'settings')).toBe(false);
  });
});
