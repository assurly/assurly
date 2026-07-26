import type { DbAdapter, ProdWatchSubscription, Target } from '../dbAdapter';
import { isActiveProbeAllowed } from '../ownership';
import { decideProdWatchAlert, notifyProdWatchAbuse } from './alerts';
import {
  isProdWatchFeatureEnabled,
  PROD_WATCH_MAX_CONCURRENCY,
  PROD_WATCH_MAX_WALL_MS,
  PROD_WATCH_SIGNAL_RETENTION_MS,
} from './constants';
import { decryptProdWatchToken } from './crypto';
import { deriveProdWatchSignal, toPersistableRow } from './derive';
import { fetchProdWatchRequestSignals } from './fetchLogs';

export interface ProdWatchCheckResult {
  targetId: string;
  skipped: boolean;
  skipReason:
    | 'feature_flag'
    | 'disabled'
    | 'ownership_gate'
    | null;
  status: ProdWatchSubscription['last_status'];
  alerted: boolean;
  error?: string;
}

export interface ProdWatchBatchResult {
  checked: number;
  skipped: number;
  alerted: number;
  errors: number;
  timedOut: boolean;
  results: ProdWatchCheckResult[];
}

export async function runProdWatchBatch(options: {
  db: DbAdapter;
  fetchImpl?: typeof fetch;
  nowMs?: number;
  resolveAdminEmails?: (organizationId: string) => Promise<string[]>;
}): Promise<ProdWatchBatchResult> {
  const nowMs = options.nowMs ?? Date.now();
  const results: ProdWatchCheckResult[] = [];
  let checked = 0;
  let skipped = 0;
  let alerted = 0;
  let errors = 0;
  let timedOut = false;

  if (!isProdWatchFeatureEnabled()) {
    return {
      checked: 0,
      skipped: 0,
      alerted: 0,
      errors: 0,
      timedOut: false,
      results: [],
    };
  }

  // Best-effort retention sweep once per batch.
  await options.db.purgeProdWatchSignalsOlderThan(
    new Date(nowMs - PROD_WATCH_SIGNAL_RETENTION_MS).toISOString(),
  );

  const subscriptions = await options.db.listEnabledProdWatchSubscriptions();
  const queue = [...subscriptions];
  const workers = Array.from(
    { length: Math.min(PROD_WATCH_MAX_CONCURRENCY, Math.max(queue.length, 1)) },
    async () => {
      while (queue.length > 0) {
        if (Date.now() - nowMs >= PROD_WATCH_MAX_WALL_MS) {
          timedOut = true;
          return;
        }
        const sub = queue.shift();
        if (!sub) return;
        try {
          const result = await checkOneSubscription({
            db: options.db,
            subscription: sub,
            fetchImpl: options.fetchImpl,
            nowMs,
            resolveAdminEmails: options.resolveAdminEmails,
          });
          results.push(result);
          if (result.skipped) skipped += 1;
          else checked += 1;
          if (result.alerted) alerted += 1;
          if (result.status === 'error') errors += 1;
        } catch (error) {
          errors += 1;
          results.push({
            targetId: sub.target_id,
            skipped: false,
            skipReason: null,
            status: 'error',
            alerted: false,
            error: error instanceof Error ? error.message : 'unknown_error',
          });
        }
      }
    },
  );

  await Promise.all(workers);
  return { checked, skipped, alerted, errors, timedOut, results };
}

async function checkOneSubscription(options: {
  db: DbAdapter;
  subscription: ProdWatchSubscription;
  fetchImpl?: typeof fetch;
  nowMs: number;
  resolveAdminEmails?: (organizationId: string) => Promise<string[]>;
}): Promise<ProdWatchCheckResult> {
  const { db, subscription } = options;

  if (!subscription.enabled) {
    return {
      targetId: subscription.target_id,
      skipped: true,
      skipReason: 'disabled',
      status: subscription.last_status,
      alerted: false,
    };
  }

  const target = await db.getTargetById(subscription.target_id);
  if (
    !target ||
    !isActiveProbeAllowed({
      kind: target.kind,
      ownershipVerified: target.ownership_verified,
    })
  ) {
    return {
      targetId: subscription.target_id,
      skipped: true,
      skipReason: 'ownership_gate',
      status: 'not_checked',
      alerted: false,
    };
  }

  let accessToken: string;
  try {
    accessToken = decryptProdWatchToken(subscription.access_token_ciphertext);
  } catch {
    await db.updateProdWatchSubscriptionStatus({
      targetId: subscription.target_id,
      lastStatus: 'error',
      lastError: 'credential_decrypt_failed',
      lastCheckedAt: new Date(options.nowMs).toISOString(),
    });
    return {
      targetId: subscription.target_id,
      skipped: false,
      skipReason: null,
      status: 'error',
      alerted: false,
      error: 'credential_decrypt_failed',
    };
  }

  const fetched = await fetchProdWatchRequestSignals({
    projectRef: subscription.supabase_project_ref,
    accessToken,
    fetchImpl: options.fetchImpl,
    nowMs: options.nowMs,
  });

  // Drop the plaintext token from the local scope as soon as the fetch returns.
  accessToken = '';

  if (!fetched.ok) {
    await db.updateProdWatchSubscriptionStatus({
      targetId: subscription.target_id,
      lastStatus: 'not_checked',
      lastError: fetched.reason,
      lastCheckedAt: new Date(options.nowMs).toISOString(),
    });
    return {
      targetId: subscription.target_id,
      skipped: false,
      skipReason: null,
      status: 'not_checked',
      alerted: false,
      error: fetched.reason,
    };
  }

  const derived = deriveProdWatchSignal(fetched.requests);
  const row = toPersistableRow(derived);

  await db.insertProdWatchSignal({
    organizationId: subscription.organization_id,
    targetId: subscription.target_id,
    bucketStart: row.bucketStart,
    shapeCounts: row.shapeCounts,
    distinctTables: row.distinctTables,
    verdict: row.verdict,
  });

  const decision = await decideProdWatchAlert({
    db,
    organizationId: subscription.organization_id,
    targetId: subscription.target_id,
    detected: derived.verdict === 'abuse_sequence',
    nowMs: options.nowMs,
  });

  let didAlert = false;
  if (decision.shouldAlert) {
    const emails = options.resolveAdminEmails
      ? await options.resolveAdminEmails(subscription.organization_id)
      : [];
    await notifyProdWatchAbuse({ db, target, organizationAdminEmails: emails });
    didAlert = true;
  }

  await db.updateProdWatchSubscriptionStatus({
    targetId: subscription.target_id,
    lastStatus: derived.verdict,
    lastError: null,
    lastCheckedAt: new Date(options.nowMs).toISOString(),
  });

  return {
    targetId: subscription.target_id,
    skipped: false,
    skipReason: null,
    status: derived.verdict,
    alerted: didAlert,
  };
}

/** Used by opt-in tests: no fetch may occur when the subscription is disabled. */
export async function wouldFetchForSubscription(
  subscription: Pick<ProdWatchSubscription, 'enabled'> | null,
  featureEnabled: boolean = isProdWatchFeatureEnabled(),
): Promise<boolean> {
  return featureEnabled && subscription?.enabled === true;
}

export type { Target };
