import { BLOCKED_SCORE_CAP, type ScannerFinding } from '@assurly/scanner-core';
import type { DbAdapter, LiveLockAttemptRow, LiveLockReason, Target } from './dbAdapter';
import { isActiveProbeAllowed } from './ownership';
import { persistUrlTargetShipGateVerdict, scannerFindingsToScanFindings } from './guardian';
import { reprobeTargetAndRecord, type ScanLiveUrlFn } from './reprobe';
import { resolveVerdictFromScanFindings } from './shipGate';

export interface LiveLockRequest {
  target: Target;
  gitSha: string;
  attemptId: string;
  db: DbAdapter;
  /** Injectable scanner for tests. Defaults to the real read-only probe. */
  scanImpl?: ScanLiveUrlFn;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

export interface LiveLockResult {
  status: 'ready' | 'blocked';
  shipScore: number;
  reason: LiveLockReason;
  gitSha: string;
  attemptId: string;
  checkedAt: string;
  /** False when this call returned a row already stored for the attempt id. */
  fresh: boolean;
}

function fromRow(row: LiveLockAttemptRow, fresh: boolean): LiveLockResult {
  return {
    status: row.status,
    shipScore: row.ship_score,
    reason: row.reason,
    gitSha: row.git_sha,
    attemptId: row.attempt_id,
    checkedAt: row.created_at,
    fresh,
  };
}

/**
 * A fresh read-only check for one deploy attempt. READY is allowed only when
 * this run has zero high-confidence blockers. A stored score is never read.
 * The same attempt id returns the recorded row and does not probe again.
 */
export async function runLiveLock(request: LiveLockRequest): Promise<LiveLockResult> {
  const { target, db } = request;
  const gitSha = request.gitSha.toLowerCase();
  const existing = await db.getLiveLockAttempt(target.id, request.attemptId);
  if (existing) return fromRow(existing, false);

  const owned = isActiveProbeAllowed({
    kind: target.kind,
    ownershipVerified: target.ownership_verified,
  });

  if (target.kind !== 'url' || !owned) {
    const row = await db.insertLiveLockAttempt({
      organizationId: target.organization_id,
      targetId: target.id,
      gitSha,
      attemptId: request.attemptId,
      status: 'blocked',
      shipScore: 0,
      reason: 'ownership_unverified',
    });
    return fromRow(row, true);
  }

  const probe = await reprobeTargetAndRecord({
    target,
    db,
    deployId: request.attemptId,
    scanImpl: request.scanImpl,
    fetchImpl: request.fetchImpl,
    useAiPlanner: false,
  });

  if (!probe.probed) {
    const row = await db.insertLiveLockAttempt({
      organizationId: target.organization_id,
      targetId: target.id,
      gitSha,
      attemptId: request.attemptId,
      status: 'blocked',
      shipScore: 0,
      reason: 'probe_refused',
    });
    return fromRow(row, true);
  }

  const findings = probe.findings;
  await persistUrlTargetShipGateVerdict({
    db,
    organizationId: target.organization_id,
    identifier: target.identifier,
    findings,
    previous: target,
    now: request.now,
  });

  const verdict = verdictForFindings(findings);
  const blocked = verdict.status === 'blocked';
  const row = await db.insertLiveLockAttempt({
    organizationId: target.organization_id,
    targetId: target.id,
    gitSha,
    attemptId: request.attemptId,
    status: blocked ? 'blocked' : 'ready',
    shipScore: blocked ? Math.min(verdict.shipScore, BLOCKED_SCORE_CAP) : verdict.shipScore,
    reason: blocked ? 'runtime_blocker' : 'clear',
  });
  return fromRow(row, true);
}

function verdictForFindings(findings: readonly ScannerFinding[]): {
  status: 'ready' | 'review' | 'blocked';
  shipScore: number;
} {
  const verdict = resolveVerdictFromScanFindings(scannerFindingsToScanFindings(findings), {
    scannedFileCount: 1,
    cleanFileCount: findings.length === 0 ? 1 : 0,
  });
  return { status: verdict.status, shipScore: verdict.shipScore };
}
