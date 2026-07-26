import * as fs from 'fs';
import * as path from 'path';
import { isAgentStackFile, scanAgentStack, type ScannerFinding } from '@assurly/scanner-core';
import { Finding, ProjectContext, Rule } from '../types';

function toFinding(finding: ScannerFinding): Finding {
  return {
    ruleId: finding.ruleId,
    severity: finding.severity,
    confidence: finding.confidence,
    file: finding.file,
    line: finding.line,
    message: finding.message,
    suggestion: finding.suggestion,
  };
}

/**
 * Agent Stack — audits MCP client configs and instruction files the AI agent
 * reads. Runs in every scan by default (offline, cheap). Individual findings
 * keep their scanner-core rule ids; this wrapper id is never a ship blocker.
 *
 * See packages/scanner-core/src/agentStack.ts for the product decision that
 * `agent-*` findings must never gate deploy.
 */
export const agentStackRules: Rule = {
  id: 'agent-stack',
  name: 'Agent Stack (MCP configs & instruction files)',
  description:
    'Audits the AI agent setup: MCP server configs and instruction files for shell execution, inline secrets, hidden instructions, and exfiltration directives.',
  severity: 'warning',

  async run(context: ProjectContext): Promise<Finding[]> {
    const matches = context.files.filter((file) => isAgentStackFile(file.replace(/\\/g, '/')));

    const findings: Finding[] = [];
    for (const relativePath of matches) {
      try {
        const content = fs.readFileSync(path.join(context.projectPath, relativePath), 'utf8');
        const scan = scanAgentStack(content, relativePath.replace(/\\/g, '/'));
        findings.push(...scan.findings.map(toFinding));
      } catch {
        // Ignore unreadable files and keep checking others.
      }
    }
    return findings;
  },
};
