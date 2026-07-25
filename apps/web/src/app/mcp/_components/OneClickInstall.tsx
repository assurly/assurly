import type { ReactElement } from 'react';
import { CURSOR_MCP_INSTALL_HREF, VSCODE_MCP_INSTALL_HREF } from './installDeeplinks';

/**
 * Genuine deeplink anchors for Cursor and VS Code. Middle-click, keyboard, and
 * assistive tech all work because these are real links with visible text — not
 * icon-only buttons. Tabs remain the manual fallback when deeplinks fail.
 *
 * Both share one style on purpose. A primary/secondary split implied Cursor was
 * the endorsed client and VS Code an afterthought; these are two equal targets,
 * so neither outranks the other visually.
 */
export function OneClickInstall(): ReactElement {
  return (
    <div className="mcp-one-click" role="group" aria-label="One-click install">
      <a href={CURSOR_MCP_INSTALL_HREF} className="mcp-one-click-btn">
        Add to Cursor
      </a>
      <a href={VSCODE_MCP_INSTALL_HREF} className="mcp-one-click-btn">
        Add to VS Code
      </a>
    </div>
  );
}
