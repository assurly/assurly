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
export declare function scanMaxDuration(content: string, file?: string): ScanResult;
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
export { scanAiAppSecurity, scanAiLlmKeyLeak, scanAiPiiToModelContext, scanAiPromptInjection, scanAiRateLimit, scanAiRouteAuthz, } from './aiAppSecurity';
export { scanAuthBoundary, scanRouteHandlerAuth, scanServerActionAuth, scanServiceRoleBypass, } from './authBoundary';
export { scanAuthLinkedMigrationNoRls, scanSupabaseDeepPolicies, scanSupabasePolicies, scanSupabaseStorage, } from './supabasePolicies';
export { scanStripeLifecycle, scanStripeLiveKeyInDev, scanStripeMissingSubscriptionEvents, scanStripeWebhookIdempotency, } from './stripeLifecycle';
export { HIGH_CONFIDENCE_BLOCKER_RULE_IDS, isHighConfidenceBlockerRuleId, type HighConfidenceBlockerRuleId, } from './blockerAllowlist';
export { isAgentInstructionFile, isAgentMcpConfigFile, isAgentStackFile, redactEnvKey, scanAgentInstructionFile, scanAgentMcpConfig, scanAgentStack, } from './agentStack';
export { SUPPLY_ALLOWSCRIPTS_IN_WORKSPACE, SUPPLY_ALLOWSCRIPTS_INVALID, SUPPLY_ALLOWSCRIPTS_STALE, SUPPLY_ALLOWSCRIPTS_UNPINNED, SUPPLY_CHAIN_RULE_IDS, SUPPLY_INSTALL_SCRIPTS_UNREVIEWED, SUPPLY_NON_REGISTRY_DEPENDENCY, SUPPLY_NPM_BELOW_V12, classifyAllowScriptsKey, enginesNpmPermitsBelow12, isSupplyChainRuleId, packageNameFromLockKey, parsePackageManagerNpmMajor, readIgnoreScriptsFromNpmrc, scanSupplyChain, type SupplyChainRuleId, type SupplyChainScanInput, type SupplyChainScanResult, type WorkspacePackageJsonInput, } from './supplyChain';
export { DEP_DEFAULT_EVAL_CAP, DEP_LOW_DOWNLOADS, DEP_NEW_UNVETTED, DEP_NONEXISTENT_PACKAGE, DEP_PROXIMITY_MAX_DISTANCE, DEP_REGISTRY_UNAVAILABLE, DEP_SCAN_CAPPED, DEP_SLOPSQUAT_SUSPECT, DEP_TYPOSQUAT_SUSPECT, DEP_YOUNG_AGE_DAYS, collectDependencyNames, contiguousTokenRuns, diffAddedDependencies, evaluateDependencyProvenance, evaluateNewDependencies, findBorrowedCorpusName, getTopNpmPackageCorpus, isAbandonedShape, parsePackageJsonDependencies, scopeOwnsBorrowedName, tokenizePackageName, type BorrowedNameMatch, type DependencyProvenanceScanResult, type DependencyProvenanceSignals, type PackageJsonDependencies, } from './dependencyProvenance';
export { damerauLevenshtein, findNearestCorpusMatch, type NearestCorpusMatch, } from './editDistance';
export { ASSURLY_CANARY_IN_TEXT, ASSURLY_CANARY_PREFIX, containsAssurlyCanaryToken, extractAssurlyCanaryToken, isAssurlyCanaryBody, isAssurlyCanaryToken, } from './canaryToken';
export interface DeeperStackScanOptions {
    /**
     * Whether to run `scanEdgeRuntime`. The CLI and web already wire the edge
     * scanner through their own dedicated paths (vercelRules / DashboardClient),
     * so those callers pass `false` to avoid emitting duplicate edge findings.
     * Defaults to `true` so standalone callers (and the integration test) get the
     * complete deeper-stack rule set.
     */
    includeEdgeRuntime?: boolean;
}
/** Runs Phase 3 deeper-stack scanners over the supplied project sources. */
export declare function runDeeperStackScans(sources: readonly SourceInput[], options?: DeeperStackScanOptions): ScanResult;
export { buildIssueGroups, buildShipGateReport, formatShipGateMarkdown, formatShipGatePlainText, getFindingGroupKey, isShipGateBlocked, resolveGroupAction, type ShipGateAction, type ShipGateActionKind, type ShipGateFindingInput, type ShipGateGroup, type ShipGateMarkdownOptions, type ShipGateOptions, type ShipGateReport, type ShipGateStatus, } from './shipGate';
