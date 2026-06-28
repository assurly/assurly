import { describe, expect, it } from 'vitest';
import type { Repository } from '../../../utils/dbAdapter';
import { filterRepositories, getRepositoryFullName } from './repoListFilter';

const repositories: Repository[] = [
  {
    id: 'repo-attesta',
    organization_id: 'org-1',
    name: 'tibco87/Attesta',
    github_repo_id: 101,
    is_active: true,
    created_at: '2026-06-21T00:00:00Z',
  },
  {
    id: 'repo-attesta-fixes',
    organization_id: 'org-1',
    name: 'tibco87/Attesta---Fixes',
    github_repo_id: 102,
    is_active: true,
    created_at: '2026-06-21T00:00:00Z',
  },
  {
    id: 'repo-leaks',
    organization_id: 'org-1',
    name: 'react-client-leaks',
    github_repo_id: 103,
    is_active: true,
    created_at: '2026-06-21T00:00:00Z',
  },
];

describe('repoListFilter', () => {
  it('returns the repository full name unchanged', () => {
    expect(getRepositoryFullName(repositories[0]!)).toBe('tibco87/Attesta');
  });

  it('matches owner and repo fragments case-insensitively', () => {
    expect(filterRepositories(repositories, 'tibco87').map((repo) => repo.name)).toEqual([
      'tibco87/Attesta',
      'tibco87/Attesta---Fixes',
    ]);
    expect(filterRepositories(repositories, 'leaks')).toEqual([repositories[2]]);
  });

  it('returns all repositories for blank filters', () => {
    expect(filterRepositories(repositories, '')).toEqual(repositories);
    expect(filterRepositories(repositories, '   ')).toEqual(repositories);
  });

  it('returns an empty list when nothing matches', () => {
    expect(filterRepositories(repositories, 'does-not-exist')).toEqual([]);
  });
});
