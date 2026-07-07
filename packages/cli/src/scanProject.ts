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

export async function runAllRules(context: ProjectContext): Promise<Finding[]> {
  const findings: Finding[] = [];
  for (const rule of allRules) {
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

export async function scanProjectDirectory(projectPath: string): Promise<ScanProjectResult> {
  const resolvedPath = path.resolve(projectPath);
  const context = buildContext(resolvedPath);
  const findings = await runAllRules(context);
  return buildScanProjectResult(findings, context);
}

export interface ScanProjectFileInput {
  path: string;
  content: string;
}

export async function scanProjectFiles(
  files: readonly ScanProjectFileInput[],
): Promise<ScanProjectResult> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'assurly-scan-'));
  try {
    for (const file of files) {
      const normalizedPath = file.path.replace(/\\/g, '/');
      const fullPath = path.join(tempDir, normalizedPath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, file.content, 'utf8');
    }
    return await scanProjectDirectory(tempDir);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}
