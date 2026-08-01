import { randomBytes } from 'node:crypto';
import type { ScannerFinding } from '@assurly/scanner-core';
import type { DbAdapter, ScanFinding, Target } from './dbAdapter';
import { isActiveProbeAllowed } from './ownership';
import type { VerdictEvidenceShape } from './publicTrust';
import { reprobeTargetAndRecord, type ScanLiveUrlFn } from './reprobe';
import { notifyIfTargetRegressionBlockers } from './scanRegression';
import { resolveVerdictFromScanFindings, type Verdict } from './shipGate';

/** Bound concurrency so one slow target cannot monopolise the cron run. */
export const GUARDIAN_MAX_CONCURRENCY = 3;

/** Soft wall-clock budget for a single cron invocation (under Vercel maxDuration). */
export const GUARDIAN_MAX_WALL_MS = 50_000;

export interface BlockerSnapshotItem {
  rule_id: string;
  file_path: string;
  line_number?: number;
  severity: 'error' | 'warning';
  confidence?: 'high' | 'medium' | 'low';
  message: string;
}

export interface GuardianCheckResult {
  targetId: string;
  skipped: boolean;
  skipReason: 'ownership_gate' | 'not_url' | null;
  probed: boolean;
  alerted: boolean;
  newBlockerCount: number;
  shipScore: number | null;
  verdict: Target['current_verdict'];
}

export interface GuardianBatchResult {
  checked: number;
  skipped: number;
  alerted: number;
  errors: number;
  timedOut: boolean;
  results: GuardianCheckResult[];
}

/** Maps runtime scanner findings into the ScanFinding shape detectNewBlockers expects. */
export function scannerFindingsToScanFindings(findings: readonly ScannerFinding[]): ScanFinding[] {
  return findings.map((finding, index) => ({
    id: `guardian-${index}`,
    scan_id: 'guardian',
    rule_id: finding.ruleId,
    severity: finding.severity,
    confidence: finding.confidence,
    file_path: finding.file ?? 'runtime',
    line_number: finding.line,
    message: finding.message,
    suggestion: finding.suggestion,
    created_at: new Date(0).toISOString(),
  }));
}

/** Reads the previous blocker snapshot used as the regression baseline. */
export function readBlockerSnapshot(evidence: unknown): ScanFinding[] {
  const shape = (evidence ?? {}) as VerdictEvidenceShape;
  const snapshot = shape.blockerSnapshot;
  if (!Array.isArray(snapshot)) return [];
  return snapshot
    .filter((row): row is BlockerSnapshotItem => {
      if (!row || typeof row !== 'object') return false;
      const item = row as BlockerSnapshotItem;
      return typeof item.rule_id === 'string' && typeof item.file_path === 'string';
    })
    .map((item, index) => ({
      id: `snapshot-${index}`,
      scan_id: 'guardian-baseline',
      rule_id: item.rule_id,
      file_path: item.file_path,
      line_number: item.line_number,
      severity: item.severity,
      confidence: item.confidence,
      message: item.message,
      created_at: new Date(0).toISOString(),
    }));
}

export function buildBlockerSnapshot(findings: ScanFinding[]): BlockerSnapshotItem[] {
  return findings
    .filter((finding) => finding.severity === 'error' && (finding.confidence ?? 'high') === 'high')
    .map((finding) => ({
      rule_id: finding.rule_id,
      file_path: finding.file_path,
      line_number: finding.line_number,
      severity: finding.severity,
      confidence: finding.confidence,
      message: finding.message,
    }));
}

export function buildGuardianVerdictEvidence(
  verdict: Verdict,
  currentFindings: ScanFinding[],
  previousShipScore: number | null,
): VerdictEvidenceShape {
  return {
    topIssue: verdict.topIssue,
    blockerSnapshot: buildBlockerSnapshot(currentFindings),
    previousShipScore,
  };
}

export function generateBadgeToken(): string {
  return randomBytes(16).toString('hex');
}

/**
 * Persists the Ship Gate projection on a `url` target after a dashboard URL scan
 * (passive or active). Best-effort — never throws. Visibility/SEO scores stay
 * out of these columns on purpose.
 */
export async function persistUrlTargetShipGateVerdict(options: {
  db: DbAdapter;
  organizationId: string;
  identifier: string;
  findings: readonly ScannerFinding[];
  previous?: Pick<Target, 'current_ship_score' | 'badge_token'> | null;
  now?: () => Date;
}): Promise<void> {
  const { db, organizationId, identifier, findings } = options;
  const now = options.now ?? (() => new Date());
  try {
    const currentFindings = scannerFindingsToScanFindings(findings);
    const verdict = resolveVerdictFromScanFindings(currentFindings, {
      scannedFileCount: 1,
      cleanFileCount: currentFindings.length === 0 ? 1 : 0,
    });
    const previousShipScore = options.previous?.current_ship_score ?? null;
    const badgeToken = options.previous?.badge_token ?? generateBadgeToken();
    await db.upsertTarget({
      organizationId,
      kind: 'url',
      identifier,
      currentVerdict: verdict.status,
      currentShipScore: verdict.shipScore,
      verdictEvidence: buildGuardianVerdictEvidence(verdict, currentFindings, previousShipScore),
      lastCheckedAt: now().toISOString(),
      badgeToken,
    });
  } catch (error) {
    console.warn(
      '[Assurly] failed to persist url target ship gate verdict:',
      (error as Error).message,
    );
  }
}

export interface RunGuardianCheckOptions {
  db: DbAdapter;
  target: Target;
  scanImpl?: ScanLiveUrlFn;
  fetchImpl?: typeof fetch;
  /** Injectable clock for tests. */
  now?: () => Date;
}

/**
 * One guardian check: ownership-gated re-probe → verdict refresh → low-noise
 * regression alert. Reuses `reprobeTargetAndRecord` (never a second probe path).
 *
 * Alert fatigue rule: alerts fire ONLY when a previous baseline exists AND
 * `detectNewBlockers` finds new blockers. First observation establishes the
 * baseline with zero alerts. Newly-fixed findings never alert.
 */
export async function runGuardianCheckForTarget(
  options: RunGuardianCheckOptions,
): Promise<GuardianCheckResult> {
  const { db, target } = options;
  const now = options.now ?? (() => new Date());

  if (target.kind !== 'url') {
    return {
      targetId: target.id,
      skipped: true,
      skipReason: 'not_url',
      probed: false,
      alerted: false,
      newBlockerCount: 0,
      shipScore: target.current_ship_score,
      verdict: target.current_verdict,
    };
  }

  // Belt-and-suspenders with the list filter: never schedule an active probe for
  // an unverified url. Still go through reprobeTargetAndRecord so the gate is
  // the single authority when a check does run.
  if (!isActiveProbeAllowed({ kind: target.kind, ownershipVerified: target.ownership_verified })) {
    return {
      targetId: target.id,
      skipped: true,
      skipReason: 'ownership_gate',
      probed: false,
      alerted: false,
      newBlockerCount: 0,
      shipScore: target.current_ship_score,
      verdict: target.current_verdict,
    };
  }

  const previousFindings = readBlockerSnapshot(target.verdict_evidence);
  const hadBaseline = previousFindings.length > 0 || target.last_checked_at != null;

  const reprobe = await reprobeTargetAndRecord({
    target,
    db,
    scanImpl: options.scanImpl,
    fetchImpl: options.fetchImpl,
  });

  const currentFindings = scannerFindingsToScanFindings(reprobe.findings);
  const verdict = resolveVerdictFromScanFindings(currentFindings, {
    scannedFileCount: 1,
    cleanFileCount: currentFindings.length === 0 ? 1 : 0,
  });

  let alerted = false;
  let newBlockerCount = 0;
  if (hadBaseline && reprobe.probed) {
    const notify = await notifyIfTargetRegressionBlockers(
      db,
      target,
      previousFindings,
      currentFindings,
    );
    alerted = notify.alerted;
    newBlockerCount = notify.newBlockers.length;
  }

  const previousShipScore = target.current_ship_score;
  const badgeToken = target.badge_token ?? generateBadgeToken();

  await db.upsertTarget({
    organizationId: target.organization_id,
    kind: target.kind,
    identifier: target.identifier,
    currentVerdict: verdict.status,
    currentShipScore: verdict.shipScore,
    verdictEvidence: buildGuardianVerdictEvidence(verdict, currentFindings, previousShipScore),
    lastCheckedAt: now().toISOString(),
    badgeToken,
  });

  return {
    targetId: target.id,
    skipped: false,
    skipReason: null,
    probed: reprobe.probed,
    alerted,
    newBlockerCount,
    shipScore: verdict.shipScore,
    verdict: verdict.status,
  };
}

/**
 * Applies verdict refresh + low-noise alerts after an already-completed re-probe
 * (e.g. the Vercel deploy webhook). Does not probe again.
 */
export async function applyGuardianAfterReprobe(options: {
  db: DbAdapter;
  target: Target;
  findings: readonly ScannerFinding[];
  probed: boolean;
  now?: () => Date;
}): Promise<GuardianCheckResult> {
  const { db, target, findings, probed } = options;
  const now = options.now ?? (() => new Date());

  if (!probed) {
    return {
      targetId: target.id,
      skipped: true,
      skipReason: 'ownership_gate',
      probed: false,
      alerted: false,
      newBlockerCount: 0,
      shipScore: target.current_ship_score,
      verdict: target.current_verdict,
    };
  }

  const previousFindings = readBlockerSnapshot(target.verdict_evidence);
  const hadBaseline = previousFindings.length > 0 || target.last_checked_at != null;
  const currentFindings = scannerFindingsToScanFindings(findings);
  const verdict = resolveVerdictFromScanFindings(currentFindings, {
    scannedFileCount: 1,
    cleanFileCount: currentFindings.length === 0 ? 1 : 0,
  });

  let alerted = false;
  let newBlockerCount = 0;
  if (hadBaseline) {
    const notify = await notifyIfTargetRegressionBlockers(
      db,
      target,
      previousFindings,
      currentFindings,
    );
    alerted = notify.alerted;
    newBlockerCount = notify.newBlockers.length;
  }

  const previousShipScore = target.current_ship_score;
  const badgeToken = target.badge_token ?? generateBadgeToken();

  await db.upsertTarget({
    organizationId: target.organization_id,
    kind: target.kind,
    identifier: target.identifier,
    currentVerdict: verdict.status,
    currentShipScore: verdict.shipScore,
    verdictEvidence: buildGuardianVerdictEvidence(verdict, currentFindings, previousShipScore),
    lastCheckedAt: now().toISOString(),
    badgeToken,
  });

  return {
    targetId: target.id,
    skipped: false,
    skipReason: null,
    probed: true,
    alerted,
    newBlockerCount,
    shipScore: verdict.shipScore,
    verdict: verdict.status,
  };
}

export interface RunGuardianBatchOptions {
  db: DbAdapter;
  scanImpl?: ScanLiveUrlFn;
  fetchImpl?: typeof fetch;
  concurrency?: number;
  maxWallMs?: number;
  now?: () => Date;
  /** Injectable target list for tests. Defaults to all ownership-verified url targets. */
  targets?: Target[];
}

/**
 * Daily guardian batch: ownership-verified url targets only, bounded concurrency
 * and wall time. One slow/failed target never fails the batch.
 */
export async function runGuardianBatch(
  options: RunGuardianBatchOptions,
): Promise<GuardianBatchResult> {
  const concurrency = options.concurrency ?? GUARDIAN_MAX_CONCURRENCY;
  const maxWallMs = options.maxWallMs ?? GUARDIAN_MAX_WALL_MS;
  const started = Date.now();
  const targets = options.targets ?? (await options.db.listVerifiedUrlTargets());

  const results: GuardianCheckResult[] = [];
  let skipped = 0;
  let alerted = 0;
  let errors = 0;
  let timedOut = false;
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < targets.length) {
      if (Date.now() - started >= maxWallMs) {
        timedOut = true;
        return;
      }
      const index = cursor;
      cursor += 1;
      const target = targets[index];
      try {
        const result = await runGuardianCheckForTarget({
          db: options.db,
          target,
          scanImpl: options.scanImpl,
          fetchImpl: options.fetchImpl,
          now: options.now,
        });
        results.push(result);
        if (result.skipped) skipped += 1;
        if (result.alerted) alerted += 1;
      } catch {
        errors += 1;
        results.push({
          targetId: target.id,
          skipped: true,
          skipReason: null,
          probed: false,
          alerted: false,
          newBlockerCount: 0,
          shipScore: target.current_ship_score,
          verdict: target.current_verdict,
        });
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, Math.max(targets.length, 1)) }, () =>
    worker(),
  );
  await Promise.all(workers);

  return {
    checked: results.filter((result) => !result.skipped).length,
    skipped,
    alerted,
    errors,
    timedOut,
    results,
  };
}
