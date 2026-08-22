import { INSTANT_GATE_MAX_FILES, buildScanScope, formatScanScopeSummary, getFileRelevanceScore, inferScanRoots, instantGateSurfaceFiles, isScannableFile, isTextScanSurface, rankFilesByRelevance, type BuildScanScopeOptions, type ScanScope, type ScanScopeGaps } from './fileRelevance';
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
export declare const RLS_SUPABASE_TABLE_LABEL = "Supabase table";
export declare const RLS_GENERIC_TABLE_LABEL = "Database table";
/** True when a `supabase-rls` message was emitted for a real Supabase stack. */
export declare function isSupabaseRlsMessage(message: string): boolean;
/**
 * When both `supabase-rls` and `supabase-migration-auth-linked-no-rls` fire for
 * the same table, keep the richer auth-linked finding and drop the generic one.
 */
export declare function subsumeRlsFindings(findings: readonly ScannerFinding[]): ScannerFinding[];
export declare function selectFiles<T>(files: readonly T[], maxFiles?: number): FileSelection<T>;
export declare function incompleteScanFinding(selection: FileSelection<unknown>): ScannerFinding | null;
export declare function scanStripeWebhook(content: string, file?: string): ScanResult;
export declare function scanRscDataLeaks(content: string, file?: string): ScanResult;
/** Next.js API route / Route Handler paths, including monorepo apps/<pkg>/src/app/api. */
export declare function isServerlessApiRouteFile(filePath: string): boolean;
export declare function scanDbConnectionPooling(content: string, file?: string): ScanResult;
export declare function scanColdStart(content: string, file?: string): ScanResult;
export declare function scanEdgeRuntime(content: string, file?: string): ScanResult;
export declare function scanMaxDuration(content: string, file?: string): ScanResult;
export declare function scanSqlMigrations(sources: readonly SourceInput[]): ScanResult;
export declare function scanSqlMigration(content: string, file?: string): ScanResult;
export declare function scanSupabaseClientLeaks(content: string, file?: string): ScanResult;
/**
 * CLI env-docs surface: application source, not tooling packages (`packages/cli`).
 * Matches `packages/cli/src/rules/envRules.ts` path prefixes exactly.
 */
export declare function isAppEnvSourceFile(filePath: string): boolean;
/**
 * `process.env.KEY` / `process.env['KEY']` from real code, never from string literals.
 */
export declare function collectProcessEnvKeysFromCode(content: string): Array<{
    key: string;
    line: number;
}>;
export interface ScanEnvOptions {
    /** All `.env.example` files in the repo; nearest ancestor wins for `codeFile`. */
    allExamples?: readonly SourceInput[];
    /** Keys referenced only from test/fixture files — never flagged as undocumented. */
    testOnlyKeys?: ReadonlySet<string>;
    /**
     * When false, skip the one-per-scan `assurly-canary-missing` warning.
     * Callers that invoke `scanEnvVariables` in a loop should emit it once.
     */
    emitMissingCanary?: boolean;
}
/**
 * Propose the package-local `.env.example` path for a code file when no ancestor
 * example exists. Preserves leading workspace prefixes (e.g. `shipready/`).
 */
export declare function proposeEnvExamplePath(codePath: string): string;
/** Resolve the nearest `.env.example` ancestor for a code path within a monorepo. */
export declare function resolveEnvExampleForPath(codePath: string, examples: readonly SourceInput[]): SourceInput | null;
/** Collect env keys that appear exclusively in non-scannable (test/fixture) files. */
export declare function collectTestOnlyEnvKeys(sources: readonly SourceInput[]): Set<string>;
export declare function scanEnvVariables(exampleContent: string, codeContent: string, exampleFile?: string, codeFile?: string, options?: ScanEnvOptions): ScanResult;
export { INSTANT_GATE_MAX_FILES, buildScanScope, formatScanScopeSummary, getFileRelevanceScore, inferScanRoots, instantGateSurfaceFiles, isScannableFile, isTextScanSurface, rankFilesByRelevance, type BuildScanScopeOptions, type ScanScope, type ScanScopeGaps, };
export { SCAN_LANGUAGE_COVERAGE_RULE_ID, UNANALYZED_SOURCE_LANGUAGES, formatUnanalyzedLogLine, isAnalyzedCodeFile, isAnalyzedSourceFile, isSecuritySurfacePath, summarizeUnanalyzedSource, unanalyzedLanguageCounts, unanalyzedLanguageForPath, unanalyzedSourceFinding, type UnanalyzedLanguageCount, type UnanalyzedLanguageSummary, type UnanalyzedSourceSummary, } from './languageCoverage';
export { MAX_PACKAGE_MANIFESTS, describeDetectedStack, detectStackFromManifests, selectPackageManifestPaths, type DetectedDatabase, type DetectedDeployment, type DetectedFramework, type DetectedPayments, type DetectedStack, type DetectStackFromManifestsInput, type PackageManifestInput, } from './stackDetect';
export { scanAiAppSecurity, scanAiLlmKeyLeak, scanAiPiiToModelContext, scanAiPromptInjection, scanAiRateLimit, scanAiRouteAuthz, } from './aiAppSecurity';
export { scanAuthBoundary, scanRouteHandlerAuth, scanServerActionAuth, scanServiceRoleBypass, } from './authBoundary';
export { scanAuthLinkedMigrationNoRls, scanSupabaseDeepPolicies, scanSupabasePolicies, scanSupabaseStorage, } from './supabasePolicies';
export { scanStripeLifecycle, scanStripeLiveKeyInDev, scanStripeMissingSubscriptionEvents, scanStripeWebhookIdempotency, scanStripeWebhookIdempotencyForProject, } from './stripeLifecycle';
export { HIGH_CONFIDENCE_BLOCKER_RULE_IDS, isHighConfidenceBlockerRuleId, type HighConfidenceBlockerRuleId, } from './blockerAllowlist';
export { isAgentInstructionFile, isAgentMcpConfigFile, isAgentStackFile, redactEnvKey, scanAgentInstructionFile, scanAgentMcpConfig, scanAgentStack, } from './agentStack';
export { SUPPLY_ALLOWSCRIPTS_IN_WORKSPACE, SUPPLY_ALLOWSCRIPTS_INVALID, SUPPLY_ALLOWSCRIPTS_STALE, SUPPLY_ALLOWSCRIPTS_UNPINNED, SUPPLY_CHAIN_RULE_IDS, SUPPLY_INSTALL_SCRIPTS_UNREVIEWED, SUPPLY_NON_REGISTRY_DEPENDENCY, SUPPLY_NPM_BELOW_V12, classifyAllowScriptsKey, enginesNpmPermitsBelow12, isSupplyChainRuleId, packageNameFromLockKey, parsePackageManagerNpmMajor, readIgnoreScriptsFromNpmrc, scanSupplyChain, type SupplyChainRuleId, type SupplyChainScanInput, type SupplyChainScanResult, type WorkspacePackageJsonInput, } from './supplyChain';
export { DEP_DEFAULT_EVAL_CAP, DEP_LOW_DOWNLOADS, DEP_NEW_UNVETTED, DEP_NONEXISTENT_PACKAGE, DEP_PROXIMITY_MAX_DISTANCE, DEP_REGISTRY_UNAVAILABLE, DEP_SCAN_CAPPED, DEP_SLOPSQUAT_SUSPECT, DEP_TYPOSQUAT_SUSPECT, DEP_YOUNG_AGE_DAYS, collectDependencyNames, contiguousTokenRuns, diffAddedDependencies, evaluateDependencyProvenance, evaluateNewDependencies, findBorrowedCorpusName, getTopNpmPackageCorpus, isAbandonedShape, parsePackageJsonDependencies, scopeOwnsBorrowedName, tokenizePackageName, type BorrowedNameMatch, type DependencyProvenanceScanResult, type DependencyProvenanceSignals, type PackageJsonDependencies, } from './dependencyProvenance';
export { damerauLevenshtein, findNearestCorpusMatch, type NearestCorpusMatch, } from './editDistance';
export { ASSURLY_CANARY_CALLBACK_PATH, ASSURLY_CANARY_ENV_KEY, ASSURLY_CANARY_IN_TEXT, ASSURLY_CANARY_PREFIX, containsAssurlyCanaryCallbackPath, containsAssurlyCanaryToken, extractAssurlyCanaryToken, isAssurlyCanaryBody, isAssurlyCanaryEnvKey, isAssurlyCanaryMcpUrl, isAssurlyCanaryPlantLine, isAssurlyCanaryToken, mergeCanaryPlantIntoEnvExample, } from './canaryToken';
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
export { BLOCKED_SCORE_CAP, RLS_SCORE_GROUP_CAP, buildIssueGroups, buildShipGateReport, countCleanScannedFiles, formatShipGateMarkdown, formatShipGatePlainText, getFindingGroupKey, isShipGateBlocked, resolveGroupAction, type ShipGateAction, type ShipGateActionKind, type ShipGateFindingInput, type ShipGateGroup, type ShipGateMarkdownOptions, type ShipGateOptions, type ShipGateReport, type ShipGateStatus, } from './shipGate';
export { excludeGitIgnoredFiles, isAssurlyEnvExamplePath, isGitIgnorePath, isGitIgnored, parseGitIgnoreSources, type GitIgnoreFileInput, type GitIgnoreSource, } from './gitIgnore';
export { GITHUB_ACTIONS_EXISTING_CI_MESSAGE, GITHUB_ACTIONS_INIT_SUGGESTION, GITHUB_ACTIONS_MISSING_ASSURLY_MESSAGE, githubActionsIntegrationMessage, scanGithubActionsIntegration, scanHardcodedStripeSecrets, scanTsconfigStrict, scanWorkspaceFiles, } from './workspaceScan';
export { detectSqlDialect, isPostgresSqlSource, type SqlDialect, type SqlDialectInput, } from './sqlDialect';
