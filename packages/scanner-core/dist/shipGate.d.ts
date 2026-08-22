import type { ScannerFinding, Severity } from './index';
import type { ScanScope } from './fileRelevance';
export type ShipGateFindingInput = Pick<ScannerFinding, 'severity' | 'message' | 'file' | 'line' | 'ruleId' | 'suggestion' | 'confidence'>;
export type ShipGateActionKind = 'command' | 'link' | 'hint';
export interface ShipGateAction {
    label: string;
    kind: ShipGateActionKind;
    command?: string;
    href?: string;
    hint?: string;
}
export type ShipGateStatus = 'blocked' | 'review' | 'ready';
export interface ShipGateGroup {
    id: string;
    label: string;
    severity: Severity;
    occurrenceCount: number;
    affectedFileCount: number;
    sampleMessage: string;
    action?: ShipGateAction;
}
export interface ShipGateReport {
    status: ShipGateStatus;
    shipScore: number;
    headline: string;
    statusEmoji: string;
    blockers: ShipGateGroup[];
    /** Error-severity findings with medium/low confidence — review, not block. */
    reviews: ShipGateGroup[];
    warnings: ShipGateGroup[];
    cleanFileCount: number;
    scannedFileCount: number;
    totalErrorFindings: number;
    totalWarningFindings: number;
    scanScope?: ScanScope;
}
export interface ShipGateOptions {
    scannedFileCount?: number;
    cleanFileCount?: number;
    scanScope?: ScanScope;
}
/** Cannot-ship scores must not look like a passing grade. */
export declare const BLOCKED_SCORE_CAP = 59;
/** Extra missing-RLS tables stay listed but do not zero the score. */
export declare const RLS_SCORE_GROUP_CAP = 3;
/**
 * Instant Gate "N of M had no issues" must only subtract findings whose path
 * was in the scanned set. Pseudo-files (`Global Configs`) and config like
 * `.env.example` are not among the analysed JS/TS/SQL files.
 */
export declare function countCleanScannedFiles(scannedFileCount: number, findingFiles: readonly (string | undefined)[], scannedFiles?: readonly string[]): number;
export declare function getFindingGroupKey(finding: ShipGateFindingInput): string;
/**
 * Build the group-level remediation hint. Env groups may span multiple packages
 * in a monorepo — include every unique suggestion so Copy fix is complete.
 */
export declare function aggregateGroupSuggestion(key: string, suggestions: readonly string[]): string | undefined;
export declare function resolveGroupAction(key: string, suggestion: string | undefined, ruleId: string | undefined): ShipGateAction | undefined;
export declare function buildIssueGroups(findings: ShipGateFindingInput[]): ShipGateGroup[];
export declare function buildShipGateReport(findings: ShipGateFindingInput[], options?: ShipGateOptions): ShipGateReport;
export declare function formatShipGatePlainText(report: ShipGateReport): string;
export interface ShipGateMarkdownOptions {
    repositoryName?: string;
    reportUrl?: string;
}
export declare function formatShipGateMarkdown(report: ShipGateReport, options?: ShipGateMarkdownOptions): string;
export declare function isShipGateBlocked(report: ShipGateReport): boolean;
