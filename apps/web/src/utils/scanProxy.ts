import type { Repository } from './dbAdapter';

/**
 * GitHub owner/org names allow only ASCII alphanumerics plus `_`, `.`, and `-`.
 * Strips accidental whitespace and invisible Unicode characters from user input.
 */
export function sanitizeGitHubOwner(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9_.-]/g, '');
}

/**
 * Returns true when a repository is unlikely to be reachable through the workspace
 * GitHub App installation, so the public-scan proxy should be used up front.
 */
export function preferPublicScanForRepository(
  repoFullName: string,
  connectedRepositories: Repository[],
): boolean {
  if (!repoFullName.includes('/')) return false;

  const owner = repoFullName.split('/')[0]?.toLowerCase();
  if (!owner) return false;

  const ownerCounts = new Map<string, number>();
  for (const repository of connectedRepositories) {
    if (!repository.name.includes('/')) continue;
    const repositoryOwner = repository.name.split('/')[0]?.toLowerCase();
    if (!repositoryOwner) continue;
    ownerCounts.set(repositoryOwner, (ownerCounts.get(repositoryOwner) ?? 0) + 1);
  }

  if (ownerCounts.size === 0) return false;

  let dominantOwner = owner;
  let dominantCount = 0;
  for (const [candidateOwner, count] of ownerCounts) {
    if (count > dominantCount) {
      dominantOwner = candidateOwner;
      dominantCount = count;
    }
  }

  return owner !== dominantOwner;
}
