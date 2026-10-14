import type { ScannerFinding } from './index';
/**
 * What a finding is about. Only `issue` describes a problem in the user's app,
 * so only issues are listed as findings, count toward the Ship Score, or go
 * into a fix prompt. The rest still reach the user, each in its own place:
 *
 * - `coverage`: something this scan could not check (unread code, a registry
 *   lookup that failed). It limits how much the verdict proves.
 * - `setup`: an optional Assurly setup step (CI workflow, silent alarm).
 * - `info`: a state worth showing that needs no action (a planted canary).
 *
 * Production data showed why this matters: in 14 of 16 repositories the latest
 * scan's findings were about Assurly itself, so no app could ever reach Ready.
 */
export type FindingKind = 'issue' | 'coverage' | 'setup' | 'info';
/**
 * The CI-workflow nag, including copies persisted before the rename to Assurly
 * under rule `general` that still tell people to run `npx shipready init` —
 * a package on npm that is not ours.
 */
export declare function isCiWorkflowSuggestion(finding: Pick<ScannerFinding, 'ruleId' | 'message'>): boolean;
export declare function findingKind(finding: Pick<ScannerFinding, 'ruleId' | 'message'>): FindingKind;
export declare function isIssueFinding(finding: Pick<ScannerFinding, 'ruleId' | 'message'>): boolean;
