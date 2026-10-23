import { type ScanResult, type SourceInput } from './index';
export declare const GITHUB_ACTIONS_MISSING_ASSURLY_MESSAGE = "GitHub Actions workflow for Assurly is missing.";
export declare const GITHUB_ACTIONS_EXISTING_CI_MESSAGE = "GitHub Actions workflows exist, but none runs the Assurly scan.";
export declare const GITHUB_ACTIONS_INIT_SUGGESTION = "Run \"npx assurly init\" to automatically generate the .github/workflows/assurly.yml workflow file.";
export declare function githubActionsIntegrationMessage(existingWorkflowCount: number): string;
/** The tsconfig.json files `scanTsconfigStrict` reads: the root one or an app's. */
export declare function isProjectTsconfigPath(filePath: string): boolean;
export interface TsconfigStrictOptions {
    /**
     * Whether the project has TypeScript sources. Callers that pass only
     * tsconfig files must say; otherwise it is read from `files`.
     */
    usesTypeScript?: boolean;
}
export declare function scanTsconfigStrict(files: readonly SourceInput[], options?: TsconfigStrictOptions): ScanResult;
export declare function scanGithubActionsIntegration(files: readonly SourceInput[]): ScanResult;
export declare function scanHardcodedStripeSecrets(files: readonly SourceInput[]): ScanResult;
/**
 * Browser-safe equivalent of `assurly scan`: same scanner-core rules, in-memory
 * files, no fs / git / ts-morph.
 */
export declare function scanWorkspaceFiles(files: readonly SourceInput[]): ScanResult;
