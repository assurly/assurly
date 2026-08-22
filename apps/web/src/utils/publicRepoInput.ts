/**
 * Client-side shape check for "Connect & Scan" / public-repo inputs so the
 * button reflects what GitHub will accept and the user gets immediate feedback —
 * NOT a security boundary. The server's `/api/github/discover` remains the
 * authority for whether the repository exists and is public.
 */
import { isGitHubRepositoryName } from './githubApp';

const GITHUB_HOST_PREFIX = /^(?:https?:\/\/)?(?:www\.)?github\.com\//i;

export function parsePublicRepoInput(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const fromGithubUrl = GITHUB_HOST_PREFIX.test(trimmed);
  let candidate = fromGithubUrl ? trimmed.replace(GITHUB_HOST_PREFIX, '') : trimmed;
  candidate = (candidate.split('?')[0] ?? '').split('#')[0] ?? '';
  candidate = candidate.replace(/\.git$/i, '').replace(/\/+$/, '');

  const parts = candidate.split('/').filter(Boolean);
  if (fromGithubUrl) {
    if (parts.length < 2) return null;
    const fullName = `${parts[0]}/${parts[1]}`;
    return isGitHubRepositoryName(fullName) ? fullName : null;
  }
  if (parts.length !== 2) return null;
  const fullName = `${parts[0]}/${parts[1]}`;
  return isGitHubRepositoryName(fullName) ? fullName : null;
}

export function isLikelyPublicRepoInput(value: string): boolean {
  return parsePublicRepoInput(value) !== null;
}
