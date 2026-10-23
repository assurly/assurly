import type { DbAdapter, Scan, Target } from './dbAdapter';
import { verdictFreshness, type VerdictFreshness } from './verdictFreshness';
import { selectVerdictOwningScan } from './verdictOwningScan';

type FreshnessDb = Pick<DbAdapter, 'getRepository' | 'getRecentScans'>;

function logFreshnessFallback(scope: string, error: unknown): void {
  console.warn(
    JSON.stringify({
      service: 'assurly-api',
      event: 'verdict-freshness-age-only',
      scope,
      errorType: error instanceof Error ? error.name : 'UnknownError',
    }),
  );
}

/**
 * How current a target's verdict is, for public surfaces (README badge, trust
 * page). Repositories compare the verdict's commit with the newest pushed one;
 * URLs, and any lookup that fails, fall back to age alone — a public page must
 * still render, and age is never a reason to look better than the truth.
 */
export async function resolveTargetFreshness(
  db: FreshnessDb,
  target: Pick<Target, 'kind' | 'repository_id' | 'last_checked_at'>,
  now: number = Date.now(),
): Promise<VerdictFreshness> {
  let checkedCommitSha: string | null = null;
  let headCommitSha: string | null = null;
  if (target.kind === 'repo' && target.repository_id) {
    try {
      const repo = await db.getRepository(target.repository_id);
      headCommitSha = repo?.head_commit_sha ?? null;
      if (repo && headCommitSha) {
        const scans = await db.getRecentScans(repo.id);
        checkedCommitSha = selectVerdictOwningScan(scans, repo.default_branch)?.commit_sha ?? null;
      }
    } catch (error) {
      logFreshnessFallback('target', error);
    }
  }
  return verdictFreshness(
    { checkedAt: target.last_checked_at, checkedCommitSha, headCommitSha },
    now,
  );
}

/**
 * How current one shared scan is. A shared report is a snapshot of that scan,
 * so it is compared with the repository's newest pushed commit.
 */
export async function resolveScanFreshness(
  db: Pick<DbAdapter, 'getRepository'>,
  scan: Pick<Scan, 'repository_id' | 'commit_sha' | 'created_at'>,
  now: number = Date.now(),
): Promise<VerdictFreshness> {
  let headCommitSha: string | null = null;
  try {
    headCommitSha = (await db.getRepository(scan.repository_id))?.head_commit_sha ?? null;
  } catch (error) {
    logFreshnessFallback('scan', error);
  }
  return verdictFreshness(
    { checkedAt: scan.created_at, checkedCommitSha: scan.commit_sha, headCommitSha },
    now,
  );
}
