import { z } from 'zod';
import { githubHeaders, githubRepositoryApiUrl } from './githubApp';
import { isAssurlyFixBranch } from './scanBranch';

export type FixBranchCleanupResult = 'deleted' | 'already-gone' | 'skipped';

export interface ClosedFixPullRequest {
  /** `owner/repo` the pull request was opened against. */
  repositoryName: string;
  /** `owner/repo` holding the head branch; null when the fork was deleted. */
  headRepositoryName: string | null;
  branch: string;
  /** The head commit the pull request closed with. */
  headSha: string;
}

const referenceSchema = z.object({ object: z.object({ sha: z.string() }) });

/**
 * Deletes the branch behind a merged or closed Assurly fix pull request, so
 * fix branches stop piling up in the user's repository (Attesta had 33).
 *
 * Only Assurly's own branches in the same repository are touched, and only
 * while the branch still points at the commit the pull request closed with:
 * if anyone pushed to it afterwards, that work is theirs and stays.
 */
export async function deleteClosedFixBranch(
  pullRequest: ClosedFixPullRequest,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<FixBranchCleanupResult> {
  if (!isAssurlyFixBranch(pullRequest.branch)) return 'skipped';
  if (pullRequest.headRepositoryName !== pullRequest.repositoryName) return 'skipped';

  const refUrl = (...segments: string[]) =>
    githubRepositoryApiUrl(
      pullRequest.repositoryName,
      'git',
      ...segments,
      'heads',
      pullRequest.branch,
    );

  const lookup = await fetchImpl(refUrl('ref'), { headers: githubHeaders(token) });
  if (lookup.status === 404) return 'already-gone';
  if (!lookup.ok) throw new Error(`Fix branch lookup failed with HTTP ${lookup.status}.`);
  const ref = referenceSchema.safeParse(await lookup.json());
  if (!ref.success || ref.data.object.sha.toLowerCase() !== pullRequest.headSha.toLowerCase()) {
    return 'skipped';
  }

  const removal = await fetchImpl(refUrl('refs'), {
    method: 'DELETE',
    headers: githubHeaders(token),
  });
  if (removal.status === 204 || removal.ok) return 'deleted';
  // 422 "Reference does not exist": removed between the lookup and now.
  if (removal.status === 404 || removal.status === 422) return 'already-gone';
  throw new Error(`Fix branch deletion failed with HTTP ${removal.status}.`);
}
