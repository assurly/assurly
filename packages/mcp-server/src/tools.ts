import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { explainRule } from '@shipready/cli/ruleExplainer';
import {
  scanProjectDirectory,
  scanProjectFiles,
  type ScanProjectFileInput,
  type ScanProjectResult,
} from '@shipready/cli/scanProject';

export const SHIPREADY_MCP_TOOL_NAMES = [
  'shipready_scan_path',
  'shipready_scan_files',
  'shipready_explain_rule',
] as const;

export type ShipReadyMcpToolName = (typeof SHIPREADY_MCP_TOOL_NAMES)[number];

export interface ScanPathInput {
  path: string;
}

export interface ScanFilesInput {
  files: ScanProjectFileInput[];
}

export interface ExplainRuleInput {
  ruleId: string;
}

function formatScanToolResult(result: ScanProjectResult): CallToolResult {
  const payload = {
    verdict: result.report.headline,
    status: result.report.status,
    shipScore: result.report.shipScore,
    blockers: result.report.blockers,
    reviews: result.report.reviews,
    warnings: result.report.warnings,
    findings: result.findings,
    detectedStack: result.context.detectedStack,
    scanScope: result.context.scanScope,
    report: result.report,
  };

  return {
    content: [
      {
        type: 'text',
        text: result.summary,
      },
      {
        type: 'text',
        text: `Markdown report:\n\n${result.markdown}`,
      },
      {
        type: 'text',
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

export async function handleScanPath(input: ScanPathInput): Promise<CallToolResult> {
  const result = await scanProjectDirectory(input.path);
  return formatScanToolResult(result);
}

export async function handleScanFiles(input: ScanFilesInput): Promise<CallToolResult> {
  const result = await scanProjectFiles(input.files);
  return formatScanToolResult(result);
}

export function handleExplainRule(input: ExplainRuleInput): CallToolResult {
  const explanation = explainRule(input.ruleId);
  if (!explanation) {
    return {
      content: [
        {
          type: 'text',
          text: `Unknown rule id: ${input.ruleId}`,
        },
      ],
      isError: true,
    };
  }

  const text = [
    `# ${explanation.title}`,
    '',
    `Rule ID: ${explanation.ruleId}`,
    `Blocks ship when high-confidence: ${explanation.blocksShip ? 'yes' : 'no'}`,
    '',
    '## What this rule checks',
    explanation.explanation,
    '',
    '## How to fix',
    explanation.howToFix,
  ].join('\n');

  return {
    content: [
      {
        type: 'text',
        text,
      },
      {
        type: 'text',
        text: JSON.stringify(explanation, null, 2),
      },
    ],
  };
}
