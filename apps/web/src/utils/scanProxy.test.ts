import { describe, expect, it } from 'vitest';
import type { Repository } from './dbAdapter';
import { preferPublicScanForRepository, sanitizeGitHubOwner } from './scanProxy';

function repo(name: string): Repository {
  return {
    id: `id-${name}`,
    organization_id: 'org-1',
    name,
    github_repo_id: name.length,
    is_active: true,
    created_at: '2026-01-01T00:00:00.000Z',
  };
}

describe('sanitizeGitHubOwner', () => {
  it('removes invisible unicode characters from pasted owner names', () => {
    expect(sanitizeGitHubOwner('yablko\u016b')).toBe('yablko');
  });

  it('preserves valid GitHub owner characters', () => {
    expect(sanitizeGitHubOwner(' vercel ')).toBe('vercel');
  });
});

describe('preferPublicScanForRepository', () => {
  it('prefers the public proxy for third-party repositories in a mixed workspace', () => {
    const connected = [repo('tibco87/app-a'), repo('tibco87/app-b'), repo('yablko/PHPAuth')];

    expect(preferPublicScanForRepository('yablko/PHPAuth', connected)).toBe(true);
    expect(preferPublicScanForRepository('tibco87/app-a', connected)).toBe(false);
  });

  it('does not force public scan for bare repository names', () => {
    expect(preferPublicScanForRepository('PHPAuth', [repo('tibco87/PHPAuth')])).toBe(false);
  });
});
