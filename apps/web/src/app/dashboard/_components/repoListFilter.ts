import type { Repository } from '../../../utils/dbAdapter';

export function getRepositoryFullName(repository: Repository): string {
  return repository.name;
}

export function filterRepositories(repositories: Repository[], query: string): Repository[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return repositories;
  }

  return repositories.filter((repository) =>
    getRepositoryFullName(repository).toLowerCase().includes(normalizedQuery),
  );
}
