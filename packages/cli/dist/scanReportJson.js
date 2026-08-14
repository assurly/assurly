"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ASSURLY_SCAN_REPORT_VERSION = void 0;
exports.buildAssurlyScanReportJson = buildAssurlyScanReportJson;
exports.extractFindingsFromScanJson = extractFindingsFromScanJson;
/** Stable wire format for CLI `--json` / `--submit` and MCP-aligned consumers. */
exports.ASSURLY_SCAN_REPORT_VERSION = 1;
function buildAssurlyScanReportJson(result) {
    return {
        version: exports.ASSURLY_SCAN_REPORT_VERSION,
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
function extractFindingsFromScanJson(payload) {
    if (Array.isArray(payload)) {
        return payload;
    }
    if (payload &&
        typeof payload === 'object' &&
        Array.isArray(payload.findings)) {
        return payload.findings;
    }
    throw new Error('Scan JSON must be a findings array or an Assurly scan report object.');
}
