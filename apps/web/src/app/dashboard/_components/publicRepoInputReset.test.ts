import { describe, expect, it } from 'vitest';
import {
  INITIAL_PUBLIC_REPO_CONNECT_SESSION,
  createPublicRepoConnectSession,
  shouldClearPublicRepoInputOnRepoSelect,
  shouldClearPublicRepoInputOnTabChange,
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

  it('clears public repo input when leaving Repositories for Manual Checker', () => {
    expect(shouldClearPublicRepoInputOnTabChange('repositories', 'checker')).toBe(true);
    expect(shouldClearPublicRepoInputOnTabChange('checker', 'repositories')).toBe(false);
    expect(shouldClearPublicRepoInputOnTabChange('repositories', 'repositories')).toBe(false);
  });
});
