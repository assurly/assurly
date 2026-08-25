/**
 * Backfill repo target projections (badge tokens + legacy scores).
 *
 * Safe to re-run. Default is dry-run (prints the plan, writes nothing).
 *
 * Dry-run:
 *   npx tsx --env-file=apps/web/.env.local apps/web/scripts/backfill-repo-target-projections.ts
 *
 * Apply (do not run against production from an agent — hand this to a human):
 *   npx tsx --env-file=apps/web/.env.local apps/web/scripts/backfill-repo-target-projections.ts --apply
 *
 * Touches:
 *   - public.targets.badge_token — only repo rows where badge_token IS NULL
 *   - public.targets.current_verdict, current_ship_score, verdict_evidence, last_checked_at
 *     — repo rows whose latest successful scan has ship_score IS NULL (legacy)
 *   - public.scans.ship_score, verdict — those same latest scans
 *
 * Does not touch findings, identifiers, organizations, or API keys.
 *
 * Expected dry-run output (shape):
 *   { "mode": "dry-run", "repoTargets": N, "missingBadgeTokens": N, "identifiersMissingBadge": [...] }
 *   badge  owner/name  would mint  <8 hex>…
 *   score  owner/name  stored=36  recomputed=59  would write
 *   { "mode": "dry-run", "badgeMints": N, "scoreResyncs": N }
 */

import { getAdminDbAdapter } from '../src/utils/dbAdapter';
import { getSupabaseAdminConfig } from '../src/utils/env';
import { generateBadgeToken } from '../src/utils/guardian';
import { syncRepoTargetVerdict } from '../src/utils/persistRepoScan';
import { resolveVerdictFromScanFindings } from '../src/utils/shipGate';

const apply = process.argv.includes('--apply');

type TargetRow = {
  id: string;
  organization_id: string;
  identifier: string;
  repository_id: string | null;
  badge_token: string | null;
  current_ship_score: number | null;
  current_verdict: string | null;
};

type ScanRow = {
  id: string;
  repository_id: string;
  ship_score: number | null;
  verdict: string | null;
  created_at: string;
  scanned_file_count: number | null;
  failure_reason: string | null;
};

async function main(): Promise<void> {
  const db = getAdminDbAdapter();
  const { url, serviceRoleKey } = getSupabaseAdminConfig();
  const targets = await rest<TargetRow[]>(
    url,
    serviceRoleKey,
    'targets?select=id,organization_id,identifier,repository_id,badge_token,current_ship_score,current_verdict&kind=eq.repo',
  );
  const missingBadge = targets.filter((row) => !row.badge_token);
  const withRepo = targets.filter((row) => row.repository_id);

  console.log(
    JSON.stringify(
      {
        mode: apply ? 'apply' : 'dry-run',
        repoTargets: targets.length,
        missingBadgeTokens: missingBadge.length,
        identifiersMissingBadge: missingBadge.map((row) => row.identifier),
      },
      null,
      2,
    ),
  );

  for (const target of missingBadge) {
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

  let scoreResyncs = 0;
  for (const target of withRepo) {
    if (!target.repository_id) continue;
    const scans = await rest<ScanRow[]>(
      url,
      serviceRoleKey,
      `scans?select=id,repository_id,ship_score,verdict,created_at,scanned_file_count,failure_reason&repository_id=eq.${encodeURIComponent(target.repository_id)}&order=created_at.desc&limit=1`,
    );
    const latest = scans[0];
    if (!latest) continue;
    if (latest.failure_reason || latest.verdict === 'failed') continue;
    if (typeof latest.ship_score === 'number') continue;

    const findings = await db.getScanFindings(latest.id);
    const verdict = resolveVerdictFromScanFindings(findings, {
      scannedFileCount: latest.scanned_file_count ?? undefined,
    });
    console.log(
      `score  ${target.identifier}  stored=${String(target.current_ship_score)}  recomputed=${String(verdict.shipScore)}  ${apply ? 'write' : 'would write'}`,
    );
    scoreResyncs += 1;
    if (!apply) continue;

    await rest(url, serviceRoleKey, `scans?id=eq.${encodeURIComponent(latest.id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        ship_score: verdict.shipScore,
        verdict: verdict.status,
      }),
    });
    await syncRepoTargetVerdict(db, target.repository_id, {
      findings,
      scannedFileCount: latest.scanned_file_count ?? undefined,
      lastCheckedAt: latest.created_at,
      shipScoreOverride: verdict.shipScore,
      verdictOverride: verdict.status,
    });
  }

  console.log(
    JSON.stringify(
      {
        mode: apply ? 'apply' : 'dry-run',
        badgeMints: missingBadge.length,
        scoreResyncs,
      },
      null,
      2,
    ),
  );
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
