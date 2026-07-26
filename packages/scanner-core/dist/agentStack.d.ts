/**
 * Agent Stack Scan — audits the AI agent's own setup (MCP client configs and
 * instruction files), not application source.
 *
 * PRODUCT DECISION (do not "helpfully" reverse):
 * Nothing in this category blocks ship. Findings may use error severity and
 * high confidence for triage priority, but `agent-*` ids are deliberately
 * absent from `HIGH_CONFIDENCE_BLOCKER_RULE_IDS`, and `shipGate` routes
 * non-allowlisted error+high findings to *review*. Pinning every `npx -y pkg`
 * would fail nearly every first scan and permanently destroy trust.
 *
 * Safety rails:
 * - Never echo secret values (shape-only messages via `redactEnvKey`).
 * - Never read outside the project root (callers pass project-local paths only).
 * - Prefer low confidence / warning when a signal is ambiguous.
 */
import type { ScannerFinding } from './index';
export interface AgentStackScanResult {
    errorCount: number;
    warningCount: number;
    findings: ScannerFinding[];
}
type ScanResult = AgentStackScanResult;
/**
 * Shape-only reference to an env key. Never include the value (or any
 * prefix/suffix fragment of it) in findings.
 */
export declare function redactEnvKey(envKey: string): string;
export declare function isAgentMcpConfigFile(filePath: string): boolean;
export declare function isAgentInstructionFile(filePath: string): boolean;
export declare function isAgentStackFile(filePath: string): boolean;
export declare function scanAgentMcpConfig(content: string, file?: string): ScanResult;
export declare function scanAgentInstructionFile(content: string, file?: string): ScanResult;
/** Dispatch to the MCP or instruction scanner based on the file path. */
export declare function scanAgentStack(content: string, file?: string): ScanResult;
export {};
