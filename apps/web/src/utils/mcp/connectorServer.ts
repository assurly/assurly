import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  CHECK_LIVE_APP_DESCRIPTION,
  CHECK_LIVE_APP_TOOL,
  checkLiveApp,
  checkLiveAppInputSchema,
  checkLiveAppOutputSchema,
  type CheckLiveAppDeps,
} from './checkLiveApp';

export const CONNECTOR_VERSION = '1.0.0';

/**
 * The public Claude connector. Stateless: one server per HTTP request, no
 * sessions, no sign-in, and only tools that are safe for an anonymous caller.
 */
export function createConnectorServer(deps: CheckLiveAppDeps): McpServer {
  const server = new McpServer({
    name: 'assurly',
    title: 'Assurly',
    version: CONNECTOR_VERSION,
    description: 'Checks whether a deployed web app is safe to launch.',
    websiteUrl: 'https://assurly.dev',
  });

  server.registerTool(
    CHECK_LIVE_APP_TOOL,
    {
      title: 'Check a live app',
      description: CHECK_LIVE_APP_DESCRIPTION,
      inputSchema: checkLiveAppInputSchema,
      outputSchema: checkLiveAppOutputSchema,
      annotations: {
        title: 'Check a live app',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    (args) => checkLiveApp(args, deps),
  );

  return server;
}
