import type { Metadata } from 'next';
import Link from 'next/link';
import React from 'react';
import { AssurlyMark } from '../_components/AssurlyMark';

const PAGE_TITLE = 'Assurly MCP Server | Ship Gate for AI Agents';
const PAGE_DESCRIPTION =
  'Connect Cursor or Claude Code to Assurly over MCP — a ship gate AI agents call before deploy.';

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  openGraph: {
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    type: 'website',
    url: '/mcp',
  },
  twitter: {
    card: 'summary_large_image',
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
  },
  alternates: {
    canonical: '/mcp',
  },
};

const CURSOR_MCP_JSON = `{
  "mcpServers": {
    "assurly": {
      "command": "npx",
      "args": ["-y", "@assurly/mcp-server"]
    }
  }
}`;

const CLAUDE_MCP_COMMAND = 'claude mcp add assurly -- npx -y @assurly/mcp-server';

export default function McpPage(): React.ReactElement {
  return (
    <div className="legal-container">
      <header className="legal-header">
        <Link href="/" className="back-link">
          ← Back to Home
        </Link>
        <div className="logo">
          <AssurlyMark className="site-logo-mark" />
          Ass<span>url</span>y
        </div>
      </header>

      <main className="legal-content">
        <h1>Assurly MCP Server</h1>
        <p className="last-updated">
          A ship gate AI agents call before deploy — expose Assurly scans to Cursor, Claude Code,
          and other MCP clients.
        </p>

        <section className="legal-section">
          <h2>Tools</h2>
          <table>
            <thead>
              <tr>
                <th>Tool</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <code>assurly_scan_path</code>
                </td>
                <td>Scan a local project directory</td>
              </tr>
              <tr>
                <td>
                  <code>assurly_scan_files</code>
                </td>
                <td>Scan in-memory {'{ path, content }[]'} files</td>
              </tr>
              <tr>
                <td>
                  <code>assurly_explain_rule</code>
                </td>
                <td>Explain a rule id and how to fix it</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section className="legal-section">
          <h2>Cursor</h2>
          <p>
            Add this server to <code>.cursor/mcp.json</code> next to your other MCP entries:
          </p>
          <pre>
            <code>{CURSOR_MCP_JSON}</code>
          </pre>
          <p>
            After saving, restart Cursor (or reload MCP) and confirm the three{' '}
            <code>assurly_*</code> tools appear.
          </p>
        </section>

        <section className="legal-section">
          <h2>Claude Code</h2>
          <p>From your project directory:</p>
          <pre>
            <code>{CLAUDE_MCP_COMMAND}</code>
          </pre>
        </section>

        <section className="legal-section">
          <h2>Typical agent loop</h2>
          <ol>
            <li>Agent writes or edits code.</li>
            <li>
              Call <code>assurly_scan_path</code> or <code>assurly_scan_files</code>.
            </li>
            <li>Read blockers from the Ship Gate summary.</li>
            <li>
              Call <code>assurly_explain_rule</code> for remediation hints.
            </li>
            <li>
              Fix issues and re-scan until the verdict is <strong>READY TO SHIP</strong>.
            </li>
          </ol>
        </section>

        <section className="legal-section">
          <h2>Pricing</h2>
          <p>
            The MCP server is <strong>free</strong>. Running the Ship Gate from your agent —
            scanning and explaining blockers before deploy — is part of the Free tier, the same way
            the URL scan is: it is how Assurly gets found, not what it charges for.
          </p>
          <p>
            Paid plans (Pro and OEM) add what makes the gate <em>stick</em> after adoption —
            continuous monitoring on every deploy, private repositories, auto-fix pull requests,
            regression alerts, AI deep review, and the white-label keyed verdict for platforms.
          </p>
        </section>
      </main>
    </div>
  );
}
