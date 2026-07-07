#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  handleExplainRule,
  handleScanFiles,
  handleScanPath,
  ASSURLY_MCP_TOOL_NAMES,
} from './tools';

export function createAssurlyMcpServer(): McpServer {
  const server = new McpServer(
    {
      name: 'assurly',
      version: '1.0.0',
    },
    {
      instructions:
        'Assurly Ship Gate MCP server. Scan local projects before deploy and explain blockers so agents can remediate until READY TO SHIP.',
    },
  );

  server.registerTool(
    'assurly_scan_path',
    {
      title: 'Scan project directory',
      description:
        'Run the full Assurly Ship Gate scan on a local project directory (same rules as `assurly scan`).',
      inputSchema: {
        path: z.string().describe('Absolute or relative path to the project root to scan'),
      },
    },
    async ({ path: projectPath }) => handleScanPath({ path: projectPath }),
  );

  server.registerTool(
    'assurly_scan_files',
    {
      title: 'Scan provided files',
      description:
        'Run the Assurly Ship Gate scan on in-memory file contents (for agents that already have project files in context).',
      inputSchema: {
        files: z
          .array(
            z.object({
              path: z.string().describe('Project-relative file path'),
              content: z.string().describe('File contents'),
            }),
          )
          .min(1)
          .describe('Files to analyze'),
      },
    },
    async ({ files }) => handleScanFiles({ files }),
  );

  server.registerTool(
    'assurly_explain_rule',
    {
      title: 'Explain a Assurly rule',
      description:
        'Return a human-readable explanation and remediation steps for a Assurly rule id (e.g. supabase-rls).',
      inputSchema: {
        ruleId: z.string().describe('Assurly rule identifier'),
      },
    },
    async ({ ruleId }) => handleExplainRule({ ruleId }),
  );

  return server;
}

export { ASSURLY_MCP_TOOL_NAMES };

async function main(): Promise<void> {
  const server = createAssurlyMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (require.main === module) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Assurly MCP server failed: ${message}`);
    process.exit(1);
  });
}
