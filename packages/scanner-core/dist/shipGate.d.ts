import type { ScannerFinding, Severity } from './index';
export type ShipGateFindingInput = Pick<ScannerFinding, 'severity' | 'message' | 'file' | 'line' | 'ruleId' | 'suggestion'>;
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
    warnings: ShipGateGroup[];
    cleanFileCount: number;
    scannedFileCount: number;
    totalErrorFindings: number;
    totalWarningFindings: number;
}
export interface ShipGateOptions {
    scannedFileCount?: number;
    cleanFileCount?: number;
}
export declare function getFindingGroupKey(finding: ShipGateFindingInput): string;
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
