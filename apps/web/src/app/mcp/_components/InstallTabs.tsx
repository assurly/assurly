'use client';

import { useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import { CodeBlock } from './CodeBlock';

type InstallClientId = 'cursor' | 'claude' | 'vscode' | 'windsurf' | 'other';

const CURSOR_MCP_JSON = `{
  "mcpServers": {
    "assurly": {
      "command": "npx",
      "args": ["-y", "@assurly/mcp-server"]
    }
  }
}`;

const VSCODE_MCP_JSON = `{
  "servers": {
    "assurly": {
      "command": "npx",
      "args": ["-y", "@assurly/mcp-server"]
    }
  }
}`;

const WINDSURF_MCP_JSON = `{
  "mcpServers": {
    "assurly": {
      "command": "npx",
      "args": ["-y", "@assurly/mcp-server"]
    }
  }
}`;

const OTHER_MCP_JSON = `{
  "command": "npx",
  "args": ["-y", "@assurly/mcp-server"]
}`;

const CLAUDE_MCP_COMMAND = 'claude mcp add assurly -- npx -y @assurly/mcp-server';

const tabs: ReadonlyArray<{ id: InstallClientId; label: string }> = [
  { id: 'cursor', label: 'Cursor' },
  { id: 'claude', label: 'Claude Code' },
  { id: 'vscode', label: 'VS Code' },
  { id: 'windsurf', label: 'Windsurf' },
  { id: 'other', label: 'Other' },
];

function InstallPanel({ client }: { client: InstallClientId }): ReactElement {
  switch (client) {
    case 'cursor':
      return (
        <>
          <p>
            Add this server to <code>.cursor/mcp.json</code> next to your other MCP entries:
          </p>
          <CodeBlock code={CURSOR_MCP_JSON} label="Cursor MCP configuration" />
          <p>
            After saving, restart Cursor (or reload MCP) and confirm the four <code>assurly_*</code>{' '}
            tools appear.
          </p>
        </>
      );
    case 'claude':
      return (
        <>
          <p>From your project directory:</p>
          <CodeBlock code={CLAUDE_MCP_COMMAND} label="Claude Code install command" />
          <p>
            Restart the session (or reload MCP) and confirm the four <code>assurly_*</code> tools
            appear.
          </p>
        </>
      );
    case 'vscode':
      return (
        <>
          <p>
            Add this server to <code>.vscode/mcp.json</code>. VS Code uses the top-level key{' '}
            <code>servers</code> (not <code>mcpServers</code>):
          </p>
          <CodeBlock code={VSCODE_MCP_JSON} label="VS Code MCP configuration" />
          <p>
            After saving, reload MCP and confirm the four <code>assurly_*</code> tools appear.
          </p>
        </>
      );
    case 'windsurf':
      return (
        <>
          <p>
            Add this server to <code>~/.codeium/windsurf/mcp_config.json</code>:
          </p>
          <CodeBlock code={WINDSURF_MCP_JSON} label="Windsurf MCP configuration" />
          <p>
            After saving, restart Windsurf (or reload MCP) and confirm the four{' '}
            <code>assurly_*</code> tools appear.
          </p>
        </>
      );
    case 'other':
      return (
        <>
          <p>
            Any stdio MCP client can launch the server with <code>npx</code>. Point the client at:
          </p>
          <CodeBlock code={OTHER_MCP_JSON} label="Generic stdio MCP configuration" />
          <p>
            Run via <code>npx -y @assurly/mcp-server</code> (bin <code>assurly-mcp</code>). Confirm
            the four <code>assurly_*</code> tools appear after the client reloads MCP.
          </p>
        </>
      );
    default: {
      const _exhaustive: never = client;
      return _exhaustive;
    }
  }
}

export function InstallTabs(): ReactElement {
  const [activeTab, setActiveTab] = useState<InstallClientId>('cursor');
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const moveFocus = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = (index + 1) % tabs.length;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = (index - 1 + tabs.length) % tabs.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = tabs.length - 1;
    }

    if (nextIndex === null) return;
    event.preventDefault();
    const nextTab = tabs[nextIndex];
    setActiveTab(nextTab.id);
    tabRefs.current[nextIndex]?.focus();
  };

  return (
    <div className="mcp-install">
      <div className="mcp-install-tabs" role="tablist" aria-label="MCP client install instructions">
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            ref={(element) => {
              tabRefs.current[index] = element;
            }}
            type="button"
            role="tab"
            id={`mcp-install-tab-${tab.id}`}
            aria-controls={`mcp-install-panel-${tab.id}`}
            aria-selected={activeTab === tab.id}
            tabIndex={activeTab === tab.id ? 0 : -1}
            className={`mcp-install-tab${activeTab === tab.id ? ' mcp-install-tab--active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
            onKeyDown={(event) => moveFocus(event, index)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          id={`mcp-install-panel-${tab.id}`}
          role="tabpanel"
          aria-labelledby={`mcp-install-tab-${tab.id}`}
          className="mcp-install-panel"
          hidden={activeTab !== tab.id}
        >
          <InstallPanel client={tab.id} />
        </div>
      ))}
    </div>
  );
}
