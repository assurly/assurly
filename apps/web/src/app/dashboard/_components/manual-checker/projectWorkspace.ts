import {
  scanColdStart,
  scanEnvVariables,
  scanRscDataLeaks,
  scanSqlMigration,
  scanStripeWebhook,
  type ScanResult,
  type WebFinding,
} from '../../../../utils/browserScanner';
import type { ShipGateGroup } from '@assurly/scanner-core';
import { buildShipGateFromWebFindings } from '../../../../utils/shipGate';
import type { ProjectFile } from './useManualScan';

export type FileScanStatus = 'error' | 'warning' | 'clean';
export type ProjectScanVerdict = 'failed' | 'warnings' | 'passed';

export interface ProjectFileStats {
  path: string;
  errorCount: number;
  warningCount: number;
  status: FileScanStatus;
}

export interface ProjectScanOverview {
  /**
   * Distinct Ship Gate blockers (must-fix groups) — matches the Ship Gate
   * "Blockers" list length, not raw error finding occurrences.
   */
  errorCount: number;
  /** Distinct Ship Gate warning groups. */
  warningCount: number;
  /** Distinct Ship Gate review (heuristic) groups. */
  reviewCount: number;
  /** Raw error-severity finding count across files (file-log total). */
  totalErrorFindings: number;
  cleanFileCount: number;
  scannedFileCount: number;
  verdict: ProjectScanVerdict;
  fileStats: ProjectFileStats[];
  initialFilePath: string | null;
}

export function scanProject(files: ProjectFile[]): ScanResult {
  const findings: WebFinding[] = [];
  for (const file of files.filter((candidate) => candidate.path.endsWith('.sql'))) {
    findings.push(...scanSqlMigration(file.content, file.path).findings);
  }

  const codeFiles = files.filter((file) => /\.(?:[jt]sx?)$/.test(file.path));
  for (const file of codeFiles) {
    const searchable = `${file.path}\n${file.content}`.toLowerCase();
    if (searchable.includes('stripe') || searchable.includes('webhook')) {
      findings.push(...scanStripeWebhook(file.content, file.path).findings);
    }
    findings.push(...scanRscDataLeaks(file.content, file.path).findings);
    findings.push(...scanColdStart(file.content, file.path).findings);
  }

  const envExample = files.find((file) => /(?:^|\/)\.env\.example$/.test(file.path));
  for (const file of files.filter((candidate) => candidate.path.includes('.env'))) {
    findings.push(...scanEnvVariables(file.content, '', file.path, 'code.ts').findings);
  }
  for (const file of codeFiles) {
    const result = scanEnvVariables(
      envExample?.content ?? '',
      file.content,
      envExample?.path ?? '.env.example',
      file.path,
    );
    findings.push(...result.findings.filter((finding) => finding.file === file.path));
  }

  return {
    errorCount: findings.filter((finding) => finding.severity === 'error').length,
    warningCount: findings.filter((finding) => finding.severity === 'warning').length,
    findings,
  };
}

function compareFileStats(a: ProjectFileStats, b: ProjectFileStats): number {
  const rank = (status: FileScanStatus): number => {
    switch (status) {
      case 'error':
        return 0;
      case 'warning':
        return 1;
      case 'clean':
        return 2;
      default: {
        const neverStatus: never = status;
        return neverStatus;
      }
    }
  };

  const rankDiff = rank(a.status) - rank(b.status);
  if (rankDiff !== 0) return rankDiff;
  if (b.errorCount !== a.errorCount) return b.errorCount - a.errorCount;
  if (b.warningCount !== a.warningCount) return b.warningCount - a.warningCount;
  return a.path.localeCompare(b.path);
}

export function buildProjectFileStats(
  files: ProjectFile[],
  findings: WebFinding[],
): ProjectFileStats[] {
  const findingsByFile = new Map<string, WebFinding[]>();
  for (const finding of findings) {
    if (!finding.file) continue;
    const bucket = findingsByFile.get(finding.file) ?? [];
    bucket.push(finding);
    findingsByFile.set(finding.file, bucket);
  }

  return files
    .map((file) => {
      const fileFindings = findingsByFile.get(file.path) ?? [];
      const errorCount = fileFindings.filter((finding) => finding.severity === 'error').length;
      const warningCount = fileFindings.filter((finding) => finding.severity === 'warning').length;
      let status: FileScanStatus = 'clean';
      if (errorCount > 0) status = 'error';
      else if (warningCount > 0) status = 'warning';

      return { path: file.path, errorCount, warningCount, status };
    })
    .sort(compareFileStats);
}

export function pickInitialProjectFile(
  files: ProjectFile[],
  findings: WebFinding[],
): string | null {
  if (files.length === 0) return null;

  const stats = buildProjectFileStats(files, findings);
  const firstIssue = stats.find((entry) => entry.status !== 'clean');
  if (firstIssue) return firstIssue.path;

  const sortedPaths = [...files].map((file) => file.path).sort((a, b) => a.localeCompare(b));
  return sortedPaths[0] ?? null;
}

function verdictFromShipGateStatus(status: 'blocked' | 'review' | 'ready'): ProjectScanVerdict {
  switch (status) {
    case 'blocked':
      return 'failed';
    case 'review':
      return 'warnings';
    case 'ready':
      return 'passed';
    default: {
      const neverStatus: never = status;
      return neverStatus;
    }
  }
}

export function buildProjectScanOverview(
  files: ProjectFile[],
  findings: WebFinding[],
): ProjectScanOverview {
  const fileStats = buildProjectFileStats(files, findings);
  const cleanFileCount = fileStats.filter((entry) => entry.status === 'clean').length;
  const shipGate = buildShipGateFromWebFindings(findings, {
    scannedFileCount: files.length,
    cleanFileCount,
  });

  return {
    errorCount: shipGate.blockers.length,
    warningCount: shipGate.warnings.length,
    reviewCount: shipGate.reviews.length,
    totalErrorFindings: shipGate.totalErrorFindings,
    cleanFileCount,
    scannedFileCount: files.length,
    verdict: verdictFromShipGateStatus(shipGate.status),
    fileStats,
    initialFilePath: pickInitialProjectFile(files, findings),
  };
}

export interface ScanMetricSummary {
  totalErrorFindings: number;
  totalWarningFindings: number;
  /** Distinct Ship Gate blockers — must match the Ship Gate blockers list. */
  uniqueErrorCount: number;
  /** Distinct Ship Gate review groups (heuristic errors). */
  uniqueReviewCount: number;
  /** Distinct Ship Gate warning groups. */
  uniqueWarningCount: number;
  affectedFileCount: number;
  productionAffectedFileCount: number;
  testAffectedFileCount: number;
  cleanFileCount: number;
  scannedFileCount: number;
}

export type IssueGateKind = 'blocker' | 'review' | 'warning';

export type IssueGroupSummary = ShipGateGroup & { gateKind: IssueGateKind };

function isTestFilePath(path: string): boolean {
  return /\.(?:test|spec)\.[jt]sx?$/i.test(path) || /(?:^|\/)__tests__\//.test(path);
}

/**
 * Root-cause list aligned with Ship Gate sections (blockers → reviews → warnings).
 * Grouping uses the same keys as the Ship Gate panel so counts never diverge.
 */
export function buildIssueGroupSummaries(findings: WebFinding[]): IssueGroupSummary[] {
  const shipGate = buildShipGateFromWebFindings(findings);
  return [
    ...shipGate.blockers.map((group) => ({ ...group, gateKind: 'blocker' as const })),
    ...shipGate.reviews.map((group) => ({ ...group, gateKind: 'review' as const })),
    ...shipGate.warnings.map((group) => ({ ...group, gateKind: 'warning' as const })),
  ];
}

export function buildScanMetricSummary(
  findings: WebFinding[],
  fileStats: ProjectFileStats[],
): ScanMetricSummary {
  const cleanFileCount = fileStats.filter((entry) => entry.status === 'clean').length;
  const shipGate = buildShipGateFromWebFindings(findings, {
    scannedFileCount: fileStats.length,
    cleanFileCount,
  });
  const affectedPaths = new Set(
    fileStats.filter((entry) => entry.status !== 'clean').map((entry) => entry.path),
  );

  return {
    totalErrorFindings: shipGate.totalErrorFindings,
    totalWarningFindings: shipGate.totalWarningFindings,
    uniqueErrorCount: shipGate.blockers.length,
    uniqueReviewCount: shipGate.reviews.length,
    uniqueWarningCount: shipGate.warnings.length,
    affectedFileCount: affectedPaths.size,
    productionAffectedFileCount: [...affectedPaths].filter((path) => !isTestFilePath(path)).length,
    testAffectedFileCount: [...affectedPaths].filter((path) => isTestFilePath(path)).length,
    cleanFileCount,
    scannedFileCount: fileStats.length,
  };
}

/** Distinct Ship Gate blockers for a finding set (badge / toast source of truth). */
export function countShipGateBlockers(findings: WebFinding[]): number {
  return buildShipGateFromWebFindings(findings).blockers.length;
}

export function getScanActionLabel(verdict: ProjectScanVerdict): string {
  switch (verdict) {
    case 'failed':
      return 'Fix blocking errors in the workspace above, then review the active file log below.';
    case 'warnings':
      return 'No blocking errors. Review warnings in the active file log before shipping.';
    case 'passed':
      return 'All scanned files passed. You can deploy with confidence.';
    default: {
      const neverVerdict: never = verdict;
      return neverVerdict;
    }
  }
}

export function getProjectIssuePaths(fileStats: ProjectFileStats[]): string[] {
  return fileStats.filter((entry) => entry.status !== 'clean').map((entry) => entry.path);
}

export function getScanVerdictLabel(verdict: ProjectScanVerdict): string {
  switch (verdict) {
    case 'failed':
      return 'Scan failed — blocking issues found';
    case 'warnings':
      return 'Review recommended — warnings detected';
    case 'passed':
      return 'Production ready — no issues found';
    default: {
      const neverVerdict: never = verdict;
      return neverVerdict;
    }
  }
}
