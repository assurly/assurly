/**
 * Verified one-click MCP install deeplinks.
 * Do not re-encode these by hand — byte-match tests lock the shipped strings.
 */
export const CURSOR_MCP_INSTALL_HREF =
  'cursor://anysphere.cursor-deeplink/mcp/install?name=assurly&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBhc3N1cmx5L21jcC1zZXJ2ZXIiXX0=';

export const VSCODE_MCP_INSTALL_HREF =
  'https://vscode.dev/redirect/mcp/install?name=assurly&config=%7B%22name%22%3A%22assurly%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40assurly%2Fmcp-server%22%5D%7D';

export const MCP_NPM_PACKAGE_URL = 'https://www.npmjs.com/package/@assurly/mcp-server';

export const MCP_INSTALL_COMMAND = 'npx -y @assurly/mcp-server';
