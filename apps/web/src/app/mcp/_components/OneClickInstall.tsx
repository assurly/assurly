import type { ReactElement } from 'react';
import {
  CLAUDE_ADD_CONNECTOR_HREF,
  CURSOR_MCP_INSTALL_HREF,
  VSCODE_MCP_INSTALL_HREF,
} from './installDeeplinks';

interface OneClickInstallProps {
  /**
   * Adds the hosted Claude connector next to the npm-server deeplinks. Off in
   * the Install section, which is about running `@assurly/mcp-server` locally.
   */
  includeClaude?: boolean;
}

/**
 * Genuine deeplink anchors for Cursor and VS Code. Middle-click, keyboard, and
 * assistive tech all work because these are real links with visible text — not
 * icon-only buttons. Tabs remain the manual fallback when deeplinks fail.
 *
 * Both share one style on purpose. A primary/secondary split implied Cursor was
 * the endorsed client and VS Code an afterthought; these are two equal targets,
 * so neither outranks the other visually.
 */
export function OneClickInstall({ includeClaude = false }: OneClickInstallProps): ReactElement {
  return (
    <div className="mcp-one-click" role="group" aria-label="One-click install">
      {includeClaude ? (
        <a href={CLAUDE_ADD_CONNECTOR_HREF} className="mcp-one-click-btn">
          Add to Claude
        </a>
      ) : null}
      <a href={CURSOR_MCP_INSTALL_HREF} className="mcp-one-click-btn">
        Add to Cursor
      </a>
      <a href={VSCODE_MCP_INSTALL_HREF} className="mcp-one-click-btn">
        Add to VS Code
      </a>
    </div>
  );
}
