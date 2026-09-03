/**
 * Reconcile `targets.current_ship_score` with the score the dashboard displays.
 *
 * Safe to re-run. Default is dry-run (prints the plan, writes nothing).
 *
 * Dry-run:
 *   npx tsx --env-file=apps/web/.env.local apps/web/scripts/backfill-repo-target-projections.ts
 *
 * Apply (do not run against production from an agent — hand this to a human):
 *   npx tsx --env-file=apps/web/.env.local apps/web/scripts/backfill-repo-target-projections.ts --apply
 *
 * Clearing an orphaned projection is opt-in via --reset-orphaned. A repository
 * whose scans are all off its default branch resolves to no score; without the
 * flag the script reports it and leaves the stored answer alone, because
 * clearing it darkens a live badge rather than repairing a wrong number.
 *
 * Badge minting is opt-in via --mint-badges. Minting a badge_token creates
 * auth-free public URLs for that repo (/report/<token>, /api/badge/<token>) and
 * makes GET /api/v1/verdict start returning them. Tokens are unguessable, but
 * publishing a verdict page for a private repo is a product decision, so it is
 * never a side effect of a score backfill.
 *
 * Iterates every repository that has at least one scan (not existing target
 * rows), so a missing projection is created rather than skipped. Reconciles
 * whenever the stored projection differs from GET /api/targets for that repo.
 *
 * Touches:
 *   - public.targets.badge_token — only with --mint-badges, and only repo rows
 *     where badge_token IS NULL
 *   - public.targets.current_verdict, current_ship_score, verdict_evidence, last_checked_at
 *     — repo rows whose stored projection disagrees with the dashboard card
 *   - public.scans.ship_score, verdict — only when the verdict-owning scan has no
 *     stored score (legacy null), so the cheap dashboard path can use it later
 *
 * Does not touch findings, identifiers, organizations, or API keys.
 *
 * Expected dry-run output (shape):
 *   { "mode": "dry-run", "mintBadges": false, "scannedRepositories": N, ... }
 *   badge  owner/name  skipped (pass --mint-badges to mint)
 *   score  owner/name  stored=36  resolved=59  stale  would write
 *   score  owner/name  stored=59  resolved=null  orphaned  kept (no scan owns the verdict; --reset-orphaned clears it)
 *   { "mode": "dry-run", "stale": N, "missing": N, "zero": N, "orphaned": N, "alreadyInAgreement": N, "scoreResyncs": N }
 */

import { getAdminDbAdapter } from '../src/utils/dbAdapter';
import type { LatestScanSummary, Repository, Target } from '../src/utils/dbAdapter';
import { getSupabaseAdminConfig } from '../src/utils/env';
import { generateBadgeToken } from '../src/utils/guardian';
import { resetRepoTargetToNeutral, syncRepoTargetVerdict } from '../src/utils/persistRepoScan';
import {
  countReconcileModes,
  formatReconcileLine,
  planRepoTargetProjection,
  shouldWriteProjection,
  type RepoProjectionPlan,
} from '../src/utils/reconcileRepoTargetProjections';
import { buildRepoTargetCard } from '../src/utils/repoTargetCard';
import { selectVerdictOwningScan } from '../src/utils/verdictOwningScan';

const apply = process.argv.includes('--apply');
const mintBadges = process.argv.includes('--mint-badges');
/**
 * Clearing a projection that no scan owns any more is opt-in. It is not a
 * repair: it removes the answer the badge, the trust page and GET
 * /api/v1/verdict currently give for that repository.
 */
const resetOrphaned = process.argv.includes('--reset-orphaned');
const writeOptions = { resetOrphaned } as const;
const PAGE_SIZE = 1000;

type ScanRow = {
  id: string;
  repository_id: string;
  ship_score: number | null;
  verdict: 'ready' | 'review' | 'blocked' | 'failed' | null;
  created_at: string;
  scanned_file_count: number | null;
  clean_file_count: number | null;
  failure_reason: string | null;
  branch: string | null;
  scan_scope: Record<string, unknown> | null;
};

async function main(): Promise<void> {
  const db = getAdminDbAdapter();
  const { url, serviceRoleKey } = getSupabaseAdminConfig();

  const [repos, targets, scans] = await Promise.all([
    restAll<Repository>(url, serviceRoleKey, 'repositories?select=*'),
    restAll<Target>(url, serviceRoleKey, 'targets?select=*&kind=eq.repo'),
    restAll<ScanRow>(
      url,
      serviceRoleKey,
      'scans?select=id,repository_id,ship_score,verdict,created_at,scanned_file_count,clean_file_count,failure_reason,branch,scan_scope&order=created_at.desc',
    ),
  ]);

  const scansByRepoId = new Map<string, ScanRow[]>();
  for (const scan of scans) {
    const rows = scansByRepoId.get(scan.repository_id);
    if (rows) {
      rows.push(scan);
    } else {
      scansByRepoId.set(scan.repository_id, [scan]);
    }
  }

  const repoById = new Map(repos.map((row) => [row.id, row]));
  const targetByRepoId = new Map(
    targets.filter((row) => row.repository_id).map((row) => [row.repository_id as string, row]),
  );

  const missingBadge = targets.filter((row) => !row.badge_token);

  console.log(
    JSON.stringify(
      {
        mode: apply ? 'apply' : 'dry-run',
        mintBadges,
        scannedRepositories: scansByRepoId.size,
        repoTargets: targets.length,
        missingBadgeTokens: missingBadge.length,
        identifiersMissingBadge: missingBadge.map((row) => row.identifier),
      },
      null,
      2,
    ),
  );

  for (const target of missingBadge) {
    if (!mintBadges) {
      console.log(`badge  ${target.identifier}  skipped (pass --mint-badges to mint)`);
      continue;
    }
    const token = generateBadgeToken();
    console.log(
      `badge  ${target.identifier}  ${apply ? 'mint' : 'would mint'}  ${token.slice(0, 8)}…`,
    );
    if (!apply) continue;
    await rest(url, serviceRoleKey, `targets?id=eq.${encodeURIComponent(target.id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ badge_token: token }),
    });
  }

  const plans: RepoProjectionPlan[] = [];
  for (const [repoId, repoScans] of scansByRepoId) {
    const foundRepo = repoById.get(repoId);
    if (!foundRepo) continue;
    const target = targetByRepoId.get(repoId) ?? null;
    const owning = selectVerdictOwningScan(repoScans, foundRepo.default_branch);
    const latestSummary = owning ? toLatestSummary(owning) : null;
    const plan = await planRepoTargetProjection({
      repo: foundRepo,
      target,
      latestSummary,
      db,
    });
    plans.push(plan);
    console.log(formatReconcileLine(plan, apply, writeOptions));
    if (!shouldWriteProjection(plan, writeOptions) || !apply) continue;

    if (!owning) {
      await resetRepoTargetToNeutral(db, foundRepo.id);
      continue;
    }

    const findings = await db.getScanFindings(owning.id);
    const card = await buildRepoTargetCard(db, foundRepo, target ?? undefined, latestSummary);
    const verdictOverride =
      card.verdict === 'ready' || card.verdict === 'review' || card.verdict === 'blocked'
        ? card.verdict
        : undefined;
    await syncRepoTargetVerdict(db, foundRepo.id, {
      findings,
      scannedFileCount: owning.scanned_file_count ?? undefined,
      lastCheckedAt: owning.created_at,
      shipScoreOverride: plan.kind === 'reconcile' ? (plan.resolved ?? undefined) : undefined,
      verdictOverride,
      mintBadgeIfMissing: mintBadges,
    });
    if (owning.ship_score == null && plan.kind === 'reconcile' && plan.resolved != null) {
      await rest(url, serviceRoleKey, `scans?id=eq.${encodeURIComponent(owning.id)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          ship_score: plan.resolved,
          verdict: verdictOverride ?? owning.verdict,
        }),
      });
    }
  }

  const counts = countReconcileModes(plans);
  console.log(
    JSON.stringify(
      {
        mode: apply ? 'apply' : 'dry-run',
        badgeMints: mintBadges ? missingBadge.length : 0,
        stale: counts.stale,
        missing: counts.missing,
        zero: counts.zero,
        orphaned: counts.orphaned,
        orphanedCleared: resetOrphaned ? counts.orphaned : 0,
        alreadyInAgreement: counts.alreadyInAgreement,
        failedSkipped: counts.failedSkipped,
        scoreResyncs: counts.scoreResyncs,
      },
      null,
      2,
    ),
  );
}

function toLatestSummary(scan: ScanRow): LatestScanSummary {
  return {
    id: scan.id,
    repository_id: scan.repository_id,
    ship_score: scan.ship_score,
    created_at: scan.created_at,
    verdict: scan.verdict,
    failure_reason: scan.failure_reason,
    branch: scan.branch,
    scan_scope: scan.scan_scope,
  };
}

async function restAll<T>(url: string, serviceRoleKey: string, path: string): Promise<T[]> {
  const rows: T[] = [];
  let offset = 0;
  for (;;) {
    const page = await rest<T[]>(url, serviceRoleKey, withPage(path, offset, PAGE_SIZE));
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
    offset += PAGE_SIZE;
  }
}

function withPage(path: string, offset: number, pageSize: number): string {
  const join = path.includes('?') ? '&' : '?';
  return `${path}${join}limit=${pageSize}&offset=${offset}`;
}

async function rest<T>(
  url: string,
  serviceRoleKey: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${url.replace(/\/$/, '')}/rest/v1/${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      Prefer: 'return=representation',
      ...init.headers,
    },
  });
  if (!response.ok) {
    throw new Error(`PostgREST ${response.status} ${path}: ${await response.text()}`);
  }
  const text = await response.text();
  return (text.length > 0 ? JSON.parse(text) : null) as T;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
