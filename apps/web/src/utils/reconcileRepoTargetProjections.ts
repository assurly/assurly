import type { DbAdapter, LatestScanSummary, Repository, Target } from './dbAdapter';
import { buildRepoTargetCard } from './repoTargetCard';
import { scanOwnsRepoVerdict } from './verdictOwningScan';

export type ProjectionReconcileMode =
  | 'stale'
  | 'missing'
  | 'zero'
  | 'orphaned'
  | 'already-in-agreement';

/** Clearing an orphaned projection is opt-in: it removes a live answer. */
export interface ReconcileWriteOptions {
  resetOrphaned?: boolean;
}

export type RepoProjectionPlan =
  | {
      kind: 'skip-failed';
      identifier: string;
      failureReason: string | null;
    }
  | {
      kind: 'reconcile';
      identifier: string;
      stored: number | null;
      resolved: number | null;
      mode: ProjectionReconcileMode;
    };

/**
 * `failure_reason` is the column that marks a scan that did not complete.
 * `scans.status = 'failed'` is also used for a blocked gate (errors > 0) with
 * `failure_reason` null, so it must not be the skip signal.
 */
export function classifyProjectionMode(
  stored: number | null,
  resolved: number | null,
  hasTarget: boolean,
): ProjectionReconcileMode {
  if (!hasTarget) return 'missing';
  if (stored === resolved) return 'already-in-agreement';
  // Nothing owns the verdict any more, but the projection still answers with a
  // score. Writing would clear a badge and a paid-API answer, not repair them.
  if (resolved === null) return 'orphaned';
  if (stored === 0) return 'zero';
  return 'stale';
}

export function shouldWriteProjection(
  plan: RepoProjectionPlan,
  options: ReconcileWriteOptions = {},
): boolean {
  if (plan.kind !== 'reconcile') return false;
  if (plan.mode === 'already-in-agreement') return false;
  if (plan.mode === 'orphaned') return options.resetOrphaned === true;
  return true;
}

export async function planRepoTargetProjection(input: {
  repo: Repository;
  target: Target | null;
  latestSummary: LatestScanSummary | null;
  db: Pick<DbAdapter, 'getRecentScans' | 'getScanFindings'>;
}): Promise<RepoProjectionPlan> {
  const identifier = input.target?.identifier ?? input.repo.name;
  const latest = input.latestSummary;

  if (latest && scanOwnsRepoVerdict(latest, input.repo.default_branch) && latest.failure_reason) {
    return {
      kind: 'skip-failed',
      identifier,
      failureReason: latest.failure_reason,
    };
  }

  const card = await buildRepoTargetCard(input.db, input.repo, input.target ?? undefined, latest);
  if (card.lastScanFailed) {
    return {
      kind: 'skip-failed',
      identifier,
      failureReason: card.lastScanFailureReason,
    };
  }

  const stored = input.target ? (input.target.current_ship_score ?? null) : null;
  const resolved = card.shipScore;
  return {
    kind: 'reconcile',
    identifier,
    stored,
    resolved,
    mode: classifyProjectionMode(stored, resolved, Boolean(input.target)),
  };
}

export function formatReconcileLine(
  plan: RepoProjectionPlan,
  apply: boolean,
  options: ReconcileWriteOptions = {},
): string {
  if (plan.kind === 'skip-failed') {
    return `skip  ${plan.identifier}  failed_scan failure_reason=${plan.failureReason ?? 'null'}`;
  }
  const action = describeAction(plan.mode, apply, options);
  return `score  ${plan.identifier}  stored=${String(plan.stored)}  resolved=${String(plan.resolved)}  ${plan.mode}${action}`;
}

function describeAction(
  mode: ProjectionReconcileMode,
  apply: boolean,
  options: ReconcileWriteOptions,
): string {
  if (mode === 'already-in-agreement') return '';
  if (mode === 'orphaned') {
    if (options.resetOrphaned !== true) {
      return '  kept (no scan owns the verdict; --reset-orphaned clears it)';
    }
    return apply ? '  clear' : '  would clear';
  }
  return apply ? '  write' : '  would write';
}

export function countReconcileModes(plans: readonly RepoProjectionPlan[]): {
  stale: number;
  missing: number;
  zero: number;
  orphaned: number;
  alreadyInAgreement: number;
  failedSkipped: number;
  scoreResyncs: number;
} {
  const counts = {
    stale: 0,
    missing: 0,
    zero: 0,
    orphaned: 0,
    alreadyInAgreement: 0,
    failedSkipped: 0,
    scoreResyncs: 0,
  };
  for (const plan of plans) {
    if (plan.kind === 'skip-failed') {
      counts.failedSkipped += 1;
      continue;
    }
    switch (plan.mode) {
      case 'stale':
        counts.stale += 1;
        counts.scoreResyncs += 1;
        break;
      case 'missing':
        counts.missing += 1;
        counts.scoreResyncs += 1;
        break;
      case 'zero':
        counts.zero += 1;
        counts.scoreResyncs += 1;
        break;
      // Deliberately not a resync: clearing one is opt-in, so it is reported
      // on its own rather than folded into the repair total.
      case 'orphaned':
        counts.orphaned += 1;
        break;
      case 'already-in-agreement':
        counts.alreadyInAgreement += 1;
        break;
      default: {
        const neverMode: never = plan.mode;
        throw new Error(`Unhandled reconcile mode: ${String(neverMode)}`);
      }
    }
  }
  return counts;
}
