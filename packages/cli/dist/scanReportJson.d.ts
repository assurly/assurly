import type { ShipGateReport } from '@assurly/scanner-core';
import type { Finding, ProjectContext } from './types';
import type { ScanProjectResult } from './scanProject';
/** Stable wire format for CLI `--json` / `--submit` and MCP-aligned consumers. */
export declare const ASSURLY_SCAN_REPORT_VERSION: 1;
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
export declare function buildAssurlyScanReportJson(result: ScanProjectResult): AssurlyScanReportJson;
/**
 * GitHub Action / legacy parsers may still emit a bare findings array.
 * Prefer the versioned object when present.
 */
export declare function extractFindingsFromScanJson(payload: unknown): Finding[];
