import { type ShipGateReport } from '@assurly/scanner-core';
import type { Finding, ProjectContext } from './types';
export interface ScanProjectResult {
    findings: Finding[];
    report: ShipGateReport;
    context: ProjectContext;
    summary: string;
    markdown: string;
}
export declare function runAllRules(context: ProjectContext): Promise<Finding[]>;
export declare function scanProjectDirectory(projectPath: string): Promise<ScanProjectResult>;
export interface ScanProjectFileInput {
    path: string;
    content: string;
}
export declare function scanProjectFiles(files: readonly ScanProjectFileInput[]): Promise<ScanProjectResult>;
