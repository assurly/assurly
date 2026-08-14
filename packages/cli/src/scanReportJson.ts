import type { ShipGateReport } from '@assurly/scanner-core';
import type { Finding, ProjectContext } from './types';
import type { ScanProjectResult } from './scanProject';

/** Stable wire format for CLI `--json` / `--submit` and MCP-aligned consumers. */
export const ASSURLY_SCAN_REPORT_VERSION = 1 as const;

export interface AssurlyScanReportJson {
  version: typeof ASSURLY_SCAN_REPORT_VERSION;
  status: ShipGateReport['status'];
  shipScore: number;
  headline: string;
  scannedFileCount: number;
  cleanFileCount: number;
  findings: Finding[];
  blockers: ShipGateReport['blockers'];
  reviews: ShipGateReport['reviews'];
  warnings: ShipGateReport['warnings'];
  scanScope: ShipGateReport['scanScope'];
  detectedStack: ProjectContext['detectedStack'];
  report: ShipGateReport;
}

export function buildAssurlyScanReportJson(result: ScanProjectResult): AssurlyScanReportJson {
  return {
    version: ASSURLY_SCAN_REPORT_VERSION,
    status: result.report.status,
    shipScore: result.report.shipScore,
    headline: result.report.headline,
    scannedFileCount: result.report.scannedFileCount,
    cleanFileCount: result.report.cleanFileCount,
    findings: result.findings,
    blockers: result.report.blockers,
    reviews: result.report.reviews,
    warnings: result.report.warnings,
    scanScope: result.report.scanScope,
    detectedStack: result.context.detectedStack,
    report: result.report,
  };
}

/**
 * GitHub Action / legacy parsers may still emit a bare findings array.
 * Prefer the versioned object when present.
 */
export function extractFindingsFromScanJson(payload: unknown): Finding[] {
  if (Array.isArray(payload)) {
    return payload as Finding[];
  }
  if (
    payload &&
    typeof payload === 'object' &&
    Array.isArray((payload as AssurlyScanReportJson).findings)
  ) {
    return (payload as AssurlyScanReportJson).findings;
  }
  throw new Error('Scan JSON must be a findings array or an Assurly scan report object.');
}
