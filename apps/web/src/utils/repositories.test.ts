import { describe, expect, it } from 'vitest';
import { dedupeRepositoriesByGithubId } from './repositories';
import type { Repository } from './dbAdapter';

const base = (overrides: Partial<Repository>): Repository => ({
  id: '11000000-0000-4000-8000-000000000001',
  organization_id: 'org-1',
  name: 'owner/repo',
  github_repo_id: 42,
  is_active: true,
  created_at: '2026-06-21T00:00:00Z',
  ...overrides,
});

describe('dedupeRepositoriesByGithubId', () => {
  it('keeps a single record per github_repo_id', () => {
    const repositories = dedupeRepositoriesByGithubId([
      base({ id: '11000000-0000-4000-8000-000000000001', name: 'repo', github_repo_id: 99 }),
      base({ id: '11000000-0000-4000-8000-000000000002', name: 'owner/repo', github_repo_id: 99 }),
    ]);

    expect(repositories).toHaveLength(1);
    expect(repositories[0]?.name).toBe('owner/repo');
  });

  it('orders case-insensitively and locale-independently (SSR-stable, no localeCompare)', () => {
    const repositories = dedupeRepositoriesByGithubId([
      base({ id: 'id-3', name: 'tibco87/anima-privacy', github_repo_id: 3 }),
      base({ id: 'id-1', name: 'vercel/chatbot', github_repo_id: 1 }),
      base({ id: 'id-2', name: 'tibco87/Anima', github_repo_id: 2 }),
      base({ id: 'id-4', name: 'vercel/eve', github_repo_id: 4 }),
    ]);

    // Deterministic across Node (SSR) and the browser: 'Anima' sorts next to
    // 'anima-privacy' (case-insensitive), and 'chatbot' before 'eve'.
    expect(repositories.map((repository) => repository.name)).toEqual([
      'tibco87/Anima',
      'tibco87/anima-privacy',
      'vercel/chatbot',
      'vercel/eve',
    ]);
  });

  it('prefers the newest record when both names are canonical', () => {
    const repositories = dedupeRepositoriesByGithubId([
      base({
        id: '11000000-0000-4000-8000-000000000001',
        name: 'owner/repo',
        github_repo_id: 99,
        created_at: '2026-06-20T00:00:00Z',
      }),
      base({
        id: '11000000-0000-4000-8000-000000000002',
        name: 'owner/repo',
        github_repo_id: 99,
        created_at: '2026-06-22T00:00:00Z',
      }),
    ]);

    expect(repositories[0]?.id).toBe('11000000-0000-4000-8000-000000000002');
  });
});
