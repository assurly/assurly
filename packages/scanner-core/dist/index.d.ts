export type Severity = 'error' | 'warning';
export interface ScannerFinding {
    ruleId: string;
    severity: Severity;
    message: string;
    suggestion?: string;
    file?: string;
    line?: number;
}
export interface ScanResult {
    errorCount: number;
    warningCount: number;
    findings: ScannerFinding[];
}
export interface SourceInput {
    file: string;
    content: string;
}
export interface FileSelection<T> {
    files: T[];
    total: number;
    complete: boolean;
    limit: number | null;
}
export declare function selectFiles<T>(files: readonly T[], maxFiles?: number): FileSelection<T>;
export declare function incompleteScanFinding(selection: FileSelection<unknown>): ScannerFinding | null;
export declare function scanStripeWebhook(content: string, file?: string): ScanResult;
export declare function scanRscDataLeaks(content: string, file?: string): ScanResult;
export declare function scanColdStart(content: string, file?: string): ScanResult;
export declare function scanEdgeRuntime(content: string, file?: string): ScanResult;
export declare function scanSqlMigrations(sources: readonly SourceInput[]): ScanResult;
export declare function scanSqlMigration(content: string, file?: string): ScanResult;
export declare function scanSupabaseClientLeaks(content: string, file?: string): ScanResult;
export declare function scanEnvVariables(exampleContent: string, codeContent: string, exampleFile?: string, codeFile?: string): ScanResult;
export { buildIssueGroups, buildShipGateReport, formatShipGateMarkdown, formatShipGatePlainText, getFindingGroupKey, isShipGateBlocked, resolveGroupAction, type ShipGateAction, type ShipGateActionKind, type ShipGateFindingInput, type ShipGateGroup, type ShipGateMarkdownOptions, type ShipGateOptions, type ShipGateReport, type ShipGateStatus, } from './shipGate';
