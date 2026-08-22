#!/usr/bin/env node

import { readFileSync } from 'fs';
import { join } from 'path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  handleExplainRule,
  handlePlantCanary,
  handleScanAgent,
  handleScanFiles,
  handleScanPath,
  handleVerdict,
  ASSURLY_MCP_TOOL_NAMES,
} from './tools';

const DEFAULT_ASSURLY_API_URL = 'https://assurly.dev';

// Read the version from package.json at runtime so it never drifts from the
// published npm version. In the bundled CJS output, __dirname is the dist/
// directory, so ../package.json resolves to the installed package manifest.
function getPackageVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf8')) as {
      version?: string;
    };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export function createAssurlyMcpServer(): McpServer {
  const server = new McpServer(
    {
      name: 'assurly',
      version: getPackageVersion(),
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
      title: 'Explain an Assurly rule',
      description:
        'Return a human-readable explanation and remediation steps for an Assurly Ship Gate rule id (e.g. supabase-rls).',
      inputSchema: {
        ruleId: z.string().describe('Assurly rule identifier'),
      },
    },
    async ({ ruleId }) => handleExplainRule({ ruleId }),
  );

  server.registerTool(
    'assurly_verdict',
    {
      title: 'Get the hosted Assurly ship verdict',
      description:
        'Pre-deploy ship gate: read the hosted Assurly verdict (Ready/Review/Blocked + ship score + ' +
        'top issue + one-line fix + per-rule fix outcomes with observation times) for a deployed URL or a repo. ' +
        'Fix outcomes reflect the last re-probe only — after claiming a fix, deploy and re-probe before treating ' +
        'it as done. Reads the hosted Assurly API — it does not scan locally and never triggers an active probe. ' +
        'Requires ASSURLY_API_KEY in the environment.',
      inputSchema: {
        url: z
          .string()
          .url()
          .optional()
          .describe('Deployed app URL to look up (exactly one of url/repo)'),
        repo: z
          .string()
          .optional()
          .describe('Repository in owner/name form to look up (exactly one of url/repo)'),
      },
    },
    async ({ url, repo }) =>
      handleVerdict(
        { url, repo },
        {
          apiUrl: process.env.ASSURLY_API_URL?.trim() || DEFAULT_ASSURLY_API_URL,
          apiKey: process.env.ASSURLY_API_KEY?.trim() || undefined,
        },
      ),
  );

  server.registerTool(
    'assurly_scan_agent',
    {
      title: 'Scan the agent stack',
      description:
        'Advisory audit of the AI agent setup only — MCP client configs (.cursor/mcp.json, etc.) and ' +
        'instruction files (README, CLAUDE.md, AGENTS.md, .cursorrules). Does not scan application ' +
        'source. Never blocks ship; isError stays false under all outcomes.',
      inputSchema: {
        path: z.string().describe('Absolute or relative path to the project root to scan'),
      },
    },
    async ({ path: projectPath }) => handleScanAgent({ path: projectPath }),
  );

  server.registerTool(
    'assurly_plant_canary',
    {
      title: 'Plant a silent alarm',
      description:
        'Mint an Assurly ASSURLY_CANARY_URL tripwire via the hosted API and append it to local ' +
        '.env.example. Requires ASSURLY_API_KEY. Never uploads source. Do not enable the decoy ' +
        'MCP server (assurly-cloud-auth) in Cursor — add it to disabledMcpjsonServers.',
      inputSchema: {
        path: z.string().describe('Absolute or relative path to the project root'),
        repo: z.string().describe('Connected Assurly repository in owner/name form'),
      },
    },
    async ({ path: projectPath, repo }) =>
      handlePlantCanary(
        { path: projectPath, repo },
        {
          apiUrl: process.env.ASSURLY_API_URL?.trim() || DEFAULT_ASSURLY_API_URL,
          apiKey: process.env.ASSURLY_API_KEY?.trim() || undefined,
        },
      ),
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
