import { describe, expect, it } from 'vitest';
import { isGitHubNameSegment, isGitHubRepositoryName } from './githubNames';

describe('isGitHubRepositoryName', () => {
  it.each(['vercel/next.js', 'tibco87/assurly-live-target', 'acme/.github', 'a_b/c-d.e', 'x/y'])(
    'accepts %s',
    (name) => {
      expect(isGitHubRepositoryName(name)).toBe(true);
    },
  );

  it.each([
    '../..',
    'owner/..',
    '../repo',
    './repo',
    'owner/.',
    'owner',
    'owner/repo/extra',
    'owner/',
    '/repo',
    'own er/repo',
    'owner/re%2e%2epo',
    `owner/${'r'.repeat(101)}`,
  ])('rejects %s', (name) => {
    // A dot segment in `repos/${name}` resolves to another GitHub API path.
    expect(isGitHubRepositoryName(name)).toBe(false);
  });
});

describe('isGitHubNameSegment', () => {
  it('accepts an owner, rejects dot segments and the empty string', () => {
    expect(isGitHubNameSegment('yablko')).toBe(true);
    expect(isGitHubNameSegment('.github')).toBe(true);
    expect(['.', '..', ''].map(isGitHubNameSegment)).toEqual([false, false, false]);
  });
});
