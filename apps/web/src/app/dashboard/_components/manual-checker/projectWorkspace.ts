import {
  scanColdStart,
  scanEnvVariables,
  scanRscDataLeaks,
  scanSqlMigration,
  scanStripeWebhook,
  type ScanResult,
  type WebFinding,
} from '../../../../utils/browserScanner';
import { buildIssueGroups, type ShipGateGroup } from '@shipready/scanner-core';
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
  errorCount: number;
  warningCount: number;
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

export function buildProjectScanOverview(
  files: ProjectFile[],
  findings: WebFinding[],
): ProjectScanOverview {
  const fileStats = buildProjectFileStats(files, findings);
  const errorCount = findings.filter((finding) => finding.severity === 'error').length;
  const warningCount = findings.filter((finding) => finding.severity === 'warning').length;
  const cleanFileCount = fileStats.filter((entry) => entry.status === 'clean').length;

  let verdict: ProjectScanVerdict = 'passed';
  if (errorCount > 0) verdict = 'failed';
  else if (warningCount > 0) verdict = 'warnings';

  return {
    errorCount,
    warningCount,
    cleanFileCount,
    scannedFileCount: files.length,
    verdict,
    fileStats,
    initialFilePath: pickInitialProjectFile(files, findings),
  };
}

export interface ScanMetricSummary {
  totalErrorFindings: number;
  totalWarningFindings: number;
  uniqueErrorCount: number;
  uniqueWarningCount: number;
  affectedFileCount: number;
  productionAffectedFileCount: number;
  testAffectedFileCount: number;
  cleanFileCount: number;
  scannedFileCount: number;
}

export interface IssueGroupSummary extends ShipGateGroup {}

function isTestFilePath(path: string): boolean {
  return /\.(?:test|spec)\.[jt]sx?$/i.test(path) || /(?:^|\/)__tests__\//.test(path);
}

export function buildIssueGroupSummaries(findings: WebFinding[]): IssueGroupSummary[] {
  return buildIssueGroups(findings);
}

export function buildScanMetricSummary(
  findings: WebFinding[],
  fileStats: ProjectFileStats[],
): ScanMetricSummary {
  const issueGroups = buildIssueGroupSummaries(findings);
  const affectedPaths = new Set(
    fileStats.filter((entry) => entry.status !== 'clean').map((entry) => entry.path),
  );

  return {
    totalErrorFindings: findings.filter((finding) => finding.severity === 'error').length,
    totalWarningFindings: findings.filter((finding) => finding.severity === 'warning').length,
    uniqueErrorCount: issueGroups.filter((group) => group.severity === 'error').length,
    uniqueWarningCount: issueGroups.filter((group) => group.severity === 'warning').length,
    affectedFileCount: affectedPaths.size,
    productionAffectedFileCount: [...affectedPaths].filter((path) => !isTestFilePath(path)).length,
    testAffectedFileCount: [...affectedPaths].filter((path) => isTestFilePath(path)).length,
    cleanFileCount: fileStats.filter((entry) => entry.status === 'clean').length,
    scannedFileCount: fileStats.length,
  };
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
