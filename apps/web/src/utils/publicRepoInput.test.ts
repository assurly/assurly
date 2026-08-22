import { describe, expect, it } from 'vitest';
import { isLikelyPublicRepoInput, parsePublicRepoInput } from './publicRepoInput';

describe('parsePublicRepoInput', () => {
  it('accepts owner/repo, GitHub URLs, and a .git suffix', () => {
    expect(parsePublicRepoInput('facebook/react')).toBe('facebook/react');
    expect(parsePublicRepoInput('  facebook/react  ')).toBe('facebook/react');
    expect(parsePublicRepoInput('facebook/react.git')).toBe('facebook/react');
    expect(parsePublicRepoInput('https://github.com/facebook/react')).toBe('facebook/react');
    expect(parsePublicRepoInput('https://www.github.com/facebook/react.git')).toBe(
      'facebook/react',
    );
    expect(parsePublicRepoInput('github.com/facebook/react')).toBe('facebook/react');
  });

  it('takes the first two path segments from a GitHub URL with extra path', () => {
    expect(parsePublicRepoInput('https://github.com/facebook/react/tree/main')).toBe(
      'facebook/react',
    );
  });

  it('rejects empty, owner-only, and extra raw path segments', () => {
    expect(parsePublicRepoInput('')).toBeNull();
    expect(parsePublicRepoInput('   ')).toBeNull();
    expect(parsePublicRepoInput('not-a-repo')).toBeNull();
    expect(parsePublicRepoInput('owner/')).toBeNull();
    expect(parsePublicRepoInput('owner/repo/tree/main')).toBeNull();
  });

  it('exposes isLikelyPublicRepoInput as a boolean wrapper', () => {
    expect(isLikelyPublicRepoInput('facebook/react')).toBe(true);
    expect(isLikelyPublicRepoInput('not-a-repo')).toBe(false);
  });
});
