/**
 * GitHub owner and repository names, checked once for every caller. Names
 * become URL paths (`repos/${owner}/${repo}`), where a `.` or `..` segment
 * resolves to another GitHub API endpoint, so those are never a name. Dots
 * inside a name stay valid: `vercel/next.js`, `acme/.github`.
 */
const NAME_SEGMENT = /^[A-Za-z0-9_.-]{1,100}$/;

/** One owner or repository name. */
export function isGitHubNameSegment(value: string): boolean {
  return NAME_SEGMENT.test(value) && value !== '.' && value !== '..';
}

/** An `owner/repo` full name. */
export function isGitHubRepositoryName(fullName: string): boolean {
  const parts = fullName.split('/');
  return parts.length === 2 && parts.every(isGitHubNameSegment);
}
