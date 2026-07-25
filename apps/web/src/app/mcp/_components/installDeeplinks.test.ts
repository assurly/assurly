import { describe, expect, it } from 'vitest';
import {
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

  it('points the npm package URL and install command at @assurly/mcp-server', () => {
    expect(MCP_NPM_PACKAGE_URL).toBe('https://www.npmjs.com/package/@assurly/mcp-server');
    expect(MCP_INSTALL_COMMAND).toBe('npx -y @assurly/mcp-server');
  });
});
