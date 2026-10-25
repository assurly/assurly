import {
  BLOCKED_SCORE_CAP,
  isShipGateBlockerFinding,
  type ScannerFinding,
} from '@assurly/scanner-core';
import type { DbAdapter, LiveLockAttemptRow, LiveLockReason, Target } from './dbAdapter';
import { isActiveProbeAllowed } from './ownership';
import { persistUrlTargetShipGateVerdict, scannerFindingsToScanFindings } from './guardian';
import {
  isVercelDeploymentUrl,
  type DeploymentBlocker,
  type DeploymentCheckOutcome,
} from './liveLockCheck';
import { reprobeTargetAndRecord, type ScanLiveUrlFn } from './reprobe';
import { safeFetch, scanLiveUrlWithEvidence, type LookupImpl } from './runtimeScanner';
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

export interface DeploymentProbeResult {
  outcome: DeploymentCheckOutcome;
  shipScore: number | null;
  blockers: DeploymentBlocker[];
}

/**
 * Leaves room inside Vercel's five-minute `running` window to send the
 * conclusion. A probe that runs out of time is `probe_unavailable`, never READY.
 */
export const DEPLOYMENT_PROBE_BUDGET_MS = 120_000;

export interface DeploymentProbeRequest {
  target: Target;
  /** The generated `*.vercel.app` URL of the deployment Vercel is holding. */
  deploymentUrl: string;
  scanImpl?: ScanLiveUrlFn;
  fetchImpl?: typeof fetch;
  lookupImpl?: LookupImpl;
  budgetMs?: number;
  /** The integration's Deployment Protection bypass for this project, if any. */
  bypassSecret?: string | null;
}

const BYPASS_HEADER = 'x-vercel-protection-bypass';

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

/**
 * Adds the bypass header to requests for the deployment's own origin and to
 * nothing else. Every scanner request, including each redirect hop, goes
 * through this fetch, so the secret never reaches Supabase, a CDN, or a host a
 * redirect points at.
 */
export function withDeploymentBypass(
  fetchImpl: typeof fetch,
  deploymentOrigin: string,
  secret: string,
): typeof fetch {
  return (input, init) => {
    let origin: string | null = null;
    try {
      origin = new URL(requestUrl(input)).origin;
    } catch {
      origin = null;
    }
    if (origin !== deploymentOrigin) return fetchImpl(input, init);
    const headers = new Headers(init?.headers);
    headers.set(BYPASS_HEADER, secret);
    return fetchImpl(input, { ...init, headers });
  };
}

/**
 * Checks the exact deployment Vercel is about to put on the production domain.
 *
 * The caller has already tied the deployment to the verified URL: the signed
 * webhook names the Vercel project, and that project serves the verified
 * domain. Nothing here is recorded against the target. The deployment is not
 * live yet, so its findings must not overwrite the target's evidence, verdict
 * or verified-fix history.
 */
export async function probeDeployment(
  request: DeploymentProbeRequest,
): Promise<DeploymentProbeResult> {
  const { target } = request;
  if (
    target.kind !== 'url' ||
    !isActiveProbeAllowed({ kind: target.kind, ownershipVerified: target.ownership_verified })
  ) {
    return { outcome: 'ownership_unverified', shipScore: null, blockers: [] };
  }
  if (!isVercelDeploymentUrl(`${request.deploymentUrl}/`)) {
    return { outcome: 'probe_refused', shipScore: null, blockers: [] };
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<DeploymentProbeResult>((resolve) => {
    timer = setTimeout(
      () => resolve({ outcome: 'probe_unavailable', shipScore: null, blockers: [] }),
      request.budgetMs ?? DEPLOYMENT_PROBE_BUDGET_MS,
    );
  });
  try {
    return await Promise.race([scanDeployment(request), timeout]);
  } catch {
    return { outcome: 'probe_unavailable', shipScore: null, blockers: [] };
  } finally {
    clearTimeout(timer);
  }
}

async function scanDeployment(request: DeploymentProbeRequest): Promise<DeploymentProbeResult> {
  const baseFetch = request.fetchImpl ?? fetch;
  const fetchImpl = request.bypassSecret
    ? withDeploymentBypass(baseFetch, new URL(request.deploymentUrl).origin, request.bypassSecret)
    : baseFetch;
  // Deployment Protection answers a generated URL with 401, or sends it to a
  // Vercel login. The full scan follows redirects, so it would grade
  // vercel.com's login page as the app. Look first, and stay on the origin.
  const { response } = await safeFetch(
    request.deploymentUrl,
    { method: 'GET' },
    fetchImpl,
    request.lookupImpl,
    { redirects: 'same-origin' },
  );
  await response.body?.cancel().catch(() => undefined);
  if (response.status === 401 || response.status === 403) {
    return { outcome: 'deployment_protected', shipScore: null, blockers: [] };
  }
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location') ?? '';
    const protectedRedirect = /^https:\/\/vercel\.com\//.test(location);
    return {
      outcome: protectedRedirect ? 'deployment_protected' : 'probe_refused',
      shipScore: null,
      blockers: [],
    };
  }

  const scan = request.scanImpl ?? scanLiveUrlWithEvidence;
  const { findings, blocked } = await scan(request.deploymentUrl, fetchImpl, request.lookupImpl, {
    activeProbe: true,
    organizationId: request.target.organization_id,
    useAiPlanner: false,
  });
  if (blocked) {
    return {
      outcome:
        blocked.status === 401 || blocked.status === 403 ? 'deployment_protected' : 'probe_refused',
      shipScore: null,
      blockers: [],
    };
  }

  const verdict = verdictForFindings(findings);
  const blockers = findings
    .filter((finding) =>
      isShipGateBlockerFinding({
        severity: finding.severity,
        confidence: finding.confidence,
        message: finding.message,
        file: finding.file,
        line: finding.line,
        ruleId: finding.ruleId,
        suggestion: finding.suggestion,
      }),
    )
    .slice(0, 20)
    .map((finding) => ({
      ruleId: finding.ruleId,
      message: finding.message.slice(0, 500),
      location: (finding.file ?? 'runtime').slice(0, 300),
    }));
  if (verdict.status === 'blocked') {
    return {
      outcome: 'runtime_blocker',
      shipScore: Math.min(verdict.shipScore, BLOCKED_SCORE_CAP),
      blockers,
    };
  }
  return { outcome: 'clear', shipScore: verdict.shipScore, blockers: [] };
}
