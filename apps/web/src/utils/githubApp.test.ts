import { afterEach, describe, expect, it } from 'vitest';
import { getGitHubServerPat } from './githubApp';

describe('getGitHubServerPat', () => {
  afterEach(() => {
    delete process.env.GITHUB_PAT;
    delete process.env.GITHUB_TOKEN;
  });

  it('prefers GITHUB_PAT over GITHUB_TOKEN', () => {
    process.env.GITHUB_PAT = 'ghp_primary';
    process.env.GITHUB_TOKEN = 'ghp_secondary';
    expect(getGitHubServerPat()).toBe('ghp_primary');
  });

  it('falls back to GITHUB_TOKEN when GITHUB_PAT is unset', () => {
    process.env.GITHUB_TOKEN = 'ghp_fallback';
    expect(getGitHubServerPat()).toBe('ghp_fallback');
  });

  it('returns undefined when no server token is configured', () => {
    expect(getGitHubServerPat()).toBeUndefined();
  });
});
