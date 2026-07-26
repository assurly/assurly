import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  formatShipGateMarkdown,
  formatShipGatePlainText,
  type ShipGateReport,
} from '@assurly/scanner-core';
import { buildContext } from './detector';
import { allRules } from './rules';
import { buildCliShipGateReport } from './shipGateReporter';
import type { Finding, ProjectContext } from './types';

export interface ScanProjectResult {
  findings: Finding[];
  report: ShipGateReport;
  context: ProjectContext;
  summary: string;
  markdown: string;
}

function ruleErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
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

export async function runAllRules(
  context: ProjectContext,
  options: RunRulesOptions = {},
): Promise<Finding[]> {
  const rules = options.agentOnly ? allRules.filter((rule) => rule.id === 'agent-stack') : allRules;
  const findings: Finding[] = [];
  for (const rule of rules) {
    try {
      const ruleFindings = await rule.run(context);
      findings.push(...ruleFindings);
    } catch (ruleError: unknown) {
      findings.push({
        ruleId: rule.id,
        severity: 'error',
        message: `Rule failed to execute: ${ruleErrorMessage(ruleError)}`,
      });
    }
  }
  return findings;
}

function buildScanProjectResult(findings: Finding[], context: ProjectContext): ScanProjectResult {
  const report = buildCliShipGateReport(findings, context.files.length, context.scanScope);
  return {
    findings,
    report,
    context,
    summary: formatShipGatePlainText(report),
    markdown: formatShipGateMarkdown(report),
  };
}

export async function scanProjectDirectory(
  projectPath: string,
  options: RunRulesOptions = {},
): Promise<ScanProjectResult> {
  const resolvedPath = path.resolve(projectPath);
  const context = buildContext(resolvedPath);
  const findings = await runAllRules(context, options);
  return buildScanProjectResult(findings, context);
}

export interface ScanProjectFileInput {
  path: string;
  content: string;
}

export async function scanProjectFiles(
  files: readonly ScanProjectFileInput[],
  options: RunRulesOptions = {},
): Promise<ScanProjectResult> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'assurly-scan-'));
  try {
    for (const file of files) {
      const normalizedPath = file.path.replace(/\\/g, '/');
      const fullPath = path.join(tempDir, normalizedPath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, file.content, 'utf8');
    }
    return await scanProjectDirectory(tempDir, options);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}
