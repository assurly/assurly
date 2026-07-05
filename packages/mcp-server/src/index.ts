#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  handleExplainRule,
  handleScanFiles,
  handleScanPath,
  SHIPREADY_MCP_TOOL_NAMES,
} from './tools';

export function createShipReadyMcpServer(): McpServer {
  const server = new McpServer(
    {
      name: 'shipready',
      version: '1.0.0',
    },
    {
      instructions:
        'ShipReady Ship Gate MCP server. Scan local projects before deploy and explain blockers so agents can remediate until READY TO SHIP.',
    },
  );

  server.registerTool(
    'shipready_scan_path',
    {
      title: 'Scan project directory',
      description:
        'Run the full ShipReady Ship Gate scan on a local project directory (same rules as `shipready scan`).',
      inputSchema: {
        path: z.string().describe('Absolute or relative path to the project root to scan'),
      },
    },
    async ({ path: projectPath }) => handleScanPath({ path: projectPath }),
  );

  server.registerTool(
    'shipready_scan_files',
    {
      title: 'Scan provided files',
      description:
        'Run the ShipReady Ship Gate scan on in-memory file contents (for agents that already have project files in context).',
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
    'shipready_explain_rule',
    {
      title: 'Explain a ShipReady rule',
      description:
        'Return a human-readable explanation and remediation steps for a ShipReady rule id (e.g. supabase-rls).',
      inputSchema: {
        ruleId: z.string().describe('ShipReady rule identifier'),
      },
    },
    async ({ ruleId }) => handleExplainRule({ ruleId }),
  );

  return server;
}

export { SHIPREADY_MCP_TOOL_NAMES };

async function main(): Promise<void> {
  const server = createShipReadyMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (require.main === module) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`ShipReady MCP server failed: ${message}`);
    process.exit(1);
  });
}
