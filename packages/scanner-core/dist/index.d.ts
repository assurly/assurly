import { buildScanScope, formatScanScopeSummary, getFileRelevanceScore, inferScanRoots, isScannableFile, rankFilesByRelevance, type ScanScope } from './fileRelevance';
export type Severity = 'error' | 'warning';
export type FindingConfidence = 'high' | 'medium' | 'low';
export interface ScannerFinding {
    ruleId: string;
    severity: Severity;
    /** Defaults to 'high' so existing high-precision rules stay blockers. */
    confidence?: FindingConfidence;
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
export interface ScanEnvOptions {
    /** All `.env.example` files in the repo; nearest ancestor wins for `codeFile`. */
    allExamples?: readonly SourceInput[];
    /** Keys referenced only from test/fixture files — never flagged as undocumented. */
    testOnlyKeys?: ReadonlySet<string>;
}
/** Resolve the nearest `.env.example` ancestor for a code path within a monorepo. */
export declare function resolveEnvExampleForPath(codePath: string, examples: readonly SourceInput[]): SourceInput | null;
/** Collect env keys that appear exclusively in non-scannable (test/fixture) files. */
export declare function collectTestOnlyEnvKeys(sources: readonly SourceInput[]): Set<string>;
export declare function scanEnvVariables(exampleContent: string, codeContent: string, exampleFile?: string, codeFile?: string, options?: ScanEnvOptions): ScanResult;
export { buildScanScope, formatScanScopeSummary, getFileRelevanceScore, inferScanRoots, isScannableFile, rankFilesByRelevance, type ScanScope, };
export { buildIssueGroups, buildShipGateReport, formatShipGateMarkdown, formatShipGatePlainText, getFindingGroupKey, isShipGateBlocked, resolveGroupAction, type ShipGateAction, type ShipGateActionKind, type ShipGateFindingInput, type ShipGateGroup, type ShipGateMarkdownOptions, type ShipGateOptions, type ShipGateReport, type ShipGateStatus, } from './shipGate';
