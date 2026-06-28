import { Finding } from './types';
/**
 * Creates a safety backup of the working directory using Git stash.
 */
export declare function setupBackup(projectPath: string): {
    type: 'stash' | 'clean' | 'none';
    reference?: string;
};
/**
 * Checks if a finding is auto-fixable.
 */
export declare function isFixable(finding: Finding): boolean;
/**
 * Applies the fix for a single finding.
 */
export declare function applySingleFix(projectPath: string, finding: Finding): boolean;
/**
 * Interactively prompts the user to select which fixes to apply.
 */
export declare function promptSelectFixes(findings: Finding[]): Promise<Finding[]>;
/**
 * Runs the interactive auto-fixer pipeline.
 */
export declare function applyFixesInteractive(projectPath: string, findings: Finding[]): Promise<number>;
