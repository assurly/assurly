import type { DbAdapter, Scan, ScanGateVerdict } from './dbAdapter';
import { persistRepoScan } from './persistRepoScan';
import { logRejectedGateClaim, resolveAuthoritativeGate } from './scanGateAuthority';
import { resolveVerdictFromScanFindings } from './shipGate';

export interface FullGateFinding {
  ruleId: string;
  severity: 'error' | 'warning';
  confidence?: 'high' | 'medium' | 'low';
  file?: string;
  line?: number;
  message: string;
  suggestion?: string;
}

export interface FullGateResult {
  repoId: string;
  commitSha: string;
  branch: string;
  status?: 'success' | 'failed';
  /** What the Full Gate engine reported; the server recomputes and decides. */
  claim: { shipScore: number; verdict: ScanGateVerdict };
  scannedFileCount: number;
  cleanFileCount?: number;
  scanScope?: Record<string, unknown> | null;
  findings: readonly FullGateFinding[];
  /** Route label for the rejected-claim log. */
  route: string;
}

export interface PersistedFullGate {
  scan: Scan;
  shipScore: number | null;
  verdict: ScanGateVerdict;
}

/**
 * Stores one Full Gate (CLI engine) result. Shared by `npx assurly scan
 * --submit` and the scan that runs after a push, so a verdict is scored and
 * stored the same way whichever started it.
 */
export async function persistFullGateScan(
  db: DbAdapter,
  input: FullGateResult,
): Promise<PersistedFullGate> {
  const persistedFindings = input.findings.map((finding) => ({
    rule_id: finding.ruleId,
    severity: finding.severity,
    confidence: finding.confidence,
    file_path: finding.file ?? 'unknown',
    line_number: finding.line,
    message: finding.message,
    suggestion: finding.suggestion,
  }));

  const computed = resolveVerdictFromScanFindings(persistedFindings as never, {
    scannedFileCount: input.scannedFileCount,
    cleanFileCount: input.cleanFileCount,
  });
  // The engine scored every finding but at most PERSISTED_FINDINGS_LIMIT are
  // stored, so its number is kept only when that slice is truncated and the
  // claim is no better than the slice proves.
  const gate = resolveAuthoritativeGate({
    computed,
    claim: input.claim,
    persistedFindingCount: persistedFindings.length,
  });
  logRejectedGateClaim({
    route: input.route,
    repoId: input.repoId,
    gate,
    computed,
    persistedFindingCount: persistedFindings.length,
  });
  // A failed scan has no gate — mirrors POST /api/scans, which stores null.
  const scanFailed = input.claim.verdict === 'failed';
  const shipScore = scanFailed ? null : gate.shipScore;
  const verdict: ScanGateVerdict = scanFailed ? 'failed' : gate.verdict;

  const scan = await persistRepoScan(db, {
    repoId: input.repoId,
    commitSha: input.commitSha,
    branch: input.branch,
    status: input.status ?? (scanFailed || verdict === 'blocked' ? 'failed' : 'success'),
    findings: persistedFindings,
    meta: {
      shipScore,
      verdict,
      scannedFileCount: input.scannedFileCount,
      cleanFileCount: input.cleanFileCount ?? computed.cleanFileCount,
      scanScope: input.scanScope ?? null,
      failureReason: null,
    },
  });
  return { scan, shipScore, verdict };
}
