import type { Repository } from './dbAdapter';

/**
 * Collapses duplicate workspace records that point at the same GitHub repository.
 * Prefers canonical `owner/repo` names and the newest record when both exist.
 */
export function dedupeRepositoriesByGithubId(repositories: Repository[]): Repository[] {
  const byGithubId = new Map<number, Repository>();

  for (const repository of repositories) {
    const existing = byGithubId.get(repository.github_repo_id);
    if (!existing) {
      byGithubId.set(repository.github_repo_id, repository);
      continue;
    }

    const existingCanonical = existing.name.includes('/');
    const candidateCanonical = repository.name.includes('/');
    if (candidateCanonical && !existingCanonical) {
      byGithubId.set(repository.github_repo_id, repository);
      continue;
    }
    if (
      candidateCanonical === existingCanonical &&
      new Date(repository.created_at).getTime() > new Date(existing.created_at).getTime()
    ) {
      byGithubId.set(repository.github_repo_id, repository);
    }
  }

  // Sort deterministically and LOCALE-INDEPENDENTLY. `localeCompare` uses the
  // runtime's default collation, which differs between Node (SSR) and the browser
  // for mixed-case / `-` / `_` names — reordering the list on the client and
  // triggering a hydration mismatch. `toLowerCase()` (Unicode-default, not locale
  // sensitive) + code-point comparison is identical on both, with a stable id
  // tiebreak so the order never depends on the environment.
  return Array.from(byGithubId.values()).sort((a, b) => {
    const an = a.name.toLowerCase();
    const bn = b.name.toLowerCase();
    if (an !== bn) return an < bn ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
