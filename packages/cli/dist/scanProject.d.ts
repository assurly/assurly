import { type ShipGateReport } from '@assurly/scanner-core';
import type { Finding, ProjectContext } from './types';
export interface ScanProjectResult {
    findings: Finding[];
    report: ShipGateReport;
    context: ProjectContext;
    summary: string;
    markdown: string;
}
export interface RunRulesOptions {
    /**
     * When true, run only the agent-stack surface (MCP configs + instruction
     * files) and skip application rules. Used by `assurly scan --agent` and the
     * `assurly_scan_agent` MCP tool. Agent rules still run in the default full
     * scan — this flag is focused mode, not an opt-in.
     */
    agentOnly?: boolean;
}
export declare function runAllRules(context: ProjectContext, options?: RunRulesOptions): Promise<Finding[]>;
export declare function scanProjectDirectory(projectPath: string, options?: RunRulesOptions): Promise<ScanProjectResult>;
export interface ScanProjectFileInput {
    path: string;
    content: string;
}
export declare function scanProjectFiles(files: readonly ScanProjectFileInput[], options?: RunRulesOptions): Promise<ScanProjectResult>;
