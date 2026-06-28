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

  return Array.from(byGithubId.values()).sort((a, b) => a.name.localeCompare(b.name));
}
