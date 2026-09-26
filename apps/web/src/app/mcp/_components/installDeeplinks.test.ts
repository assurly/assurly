import { describe, expect, it } from 'vitest';
import {
  CLAUDE_ADD_CONNECTOR_HREF,
  CLAUDE_CONNECTOR_URL,
  CURSOR_MCP_INSTALL_HREF,
  MCP_INSTALL_COMMAND,
  MCP_NPM_PACKAGE_URL,
  VSCODE_MCP_INSTALL_HREF,
} from './installDeeplinks';

describe('installDeeplinks', () => {
  it('byte-matches the verified Cursor deeplink', () => {
    expect(CURSOR_MCP_INSTALL_HREF).toBe(
      'cursor://anysphere.cursor-deeplink/mcp/install?name=assurly&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBhc3N1cmx5L21jcC1zZXJ2ZXIiXX0=',
    );
  });

  it('byte-matches the verified VS Code deeplink', () => {
    expect(VSCODE_MCP_INSTALL_HREF).toBe(
      'https://vscode.dev/redirect/mcp/install?name=assurly&config=%7B%22name%22%3A%22assurly%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40assurly%2Fmcp-server%22%5D%7D',
    );
  });

  it('prefills Claude’s add-connector dialog with the hosted connector URL', () => {
    const link = new URL(CLAUDE_ADD_CONNECTOR_HREF);
    expect(link.origin + link.pathname).toBe('https://claude.ai/customize/connectors');
    expect(link.searchParams.get('modal')).toBe('add-custom-connector');
    expect(link.searchParams.get('connectorName')).toBe('Assurly');
    expect(link.searchParams.get('connectorUrl')).toBe(CLAUDE_CONNECTOR_URL);
    expect(CLAUDE_CONNECTOR_URL).toBe('https://assurly.dev/api/mcp');
  });

  it('points the npm package URL and install command at @assurly/mcp-server', () => {
    expect(MCP_NPM_PACKAGE_URL).toBe('https://www.npmjs.com/package/@assurly/mcp-server');
    expect(MCP_INSTALL_COMMAND).toBe('npx -y @assurly/mcp-server');
  });
});
