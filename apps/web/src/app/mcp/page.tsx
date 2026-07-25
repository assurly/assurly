import type { Metadata } from 'next';
import Link from 'next/link';
import React from 'react';
import mcpServerPackage from '../../../../../packages/mcp-server/package.json';
import { AssurlyMark } from '../_components/AssurlyMark';
import { SiteFooter } from '../_components/SiteFooter';
import { AgentLoop } from './_components/AgentLoop';
import { CodeBlock } from './_components/CodeBlock';
import { MCP_INSTALL_COMMAND, MCP_NPM_PACKAGE_URL } from './_components/installDeeplinks';
import { InstallTabs } from './_components/InstallTabs';
import { OneClickInstall } from './_components/OneClickInstall';

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

const SCAN_PATH_SAMPLE = `⚠️ REVIEW RECOMMENDED                            Ship Score: 88/100
Scanned repository, 0 files, skipped tests & fixtures
Warnings (review):
  · No .env.example file found at the root of the project. It is highly r… → 1 file
  · GitHub Actions workflow for Assurly is missing.     → 1 file
     ↳ Run: npx assurly init`;

const VERDICT_SAMPLE = `Assurly verdict: BLOCKED · Ship Score 42/100
Target: my-app.vercel.app
Top issue: Database exposure — Enable RLS on public tables
Trust page: https://assurly.dev/trust/my-app`;

const GATE_RULES_SNIPPET = `# Assurly ship gate
Before deploying, pushing to production, or claiming the app is ready to ship:
1. Call assurly_scan_path (or assurly_scan_files) on the project.
2. Fix every blocker; re-scan until the verdict is READY TO SHIP.
3. If a deployed URL or repo is in scope, call assurly_verdict. A blocked verdict is returned with isError: true — stop and do not ship.
Do not skip this gate or ask the user whether to run it.`;

const HOSTED_VERDICT_ENV = `{
  "mcpServers": {
    "assurly": {
      "command": "npx",
      "args": ["-y", "@assurly/mcp-server"],
      "env": {
        "ASSURLY_API_KEY": "ask_your_key_here"
      }
    }
  }
}`;

/** Exact MCP tool error strings from packages/mcp-server/src/tools.ts — do not paraphrase. */
const ERR_API_KEY_MISSING =
  'ASSURLY_API_KEY is not set. Create a key in the Assurly dashboard (Settings → API keys) and expose it to this MCP server as ASSURLY_API_KEY.';
const ERR_API_KEY_INVALID = 'The Assurly API key is invalid or revoked (401). Issue a new key.';
const ERR_VERDICT_ARGS = 'Provide exactly one of `url` or `repo`.';

const MCP_NAV_LINKS = [
  { href: '/#features', label: 'Features' },
  { href: '/#pricing', label: 'Pricing' },
  { href: '/mcp', label: 'MCP Server', current: true },
  { href: '/#contact', label: 'Contact' },
] as const;

/** Published version from packages/mcp-server/package.json — bundled at build time. */
const MCP_SERVER_VERSION: string = mcpServerPackage.version;

export default function McpPage(): React.ReactElement {
  return (
    <div className="mcp-container">
      <header className="mcp-header">
        <div className="mcp-header-inner">
          <Link href="/" className="logo mcp-header-logo">
            <AssurlyMark className="site-logo-mark" />
            Ass<span>url</span>y
          </Link>
          <nav className="mcp-header-nav" aria-label="Product navigation">
            {MCP_NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                {...('current' in link && link.current ? { 'aria-current': 'page' as const } : {})}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <main className="mcp-content">
        <section className="mcp-hero" aria-labelledby="mcp-hero-heading">
          <h1 id="mcp-hero-heading">Assurly MCP Server</h1>
          <p className="mcp-hero-lead">
            A ship gate AI agents call before deploy — expose Assurly scans to Cursor, Claude Code,
            and other MCP clients via <code>@assurly/mcp-server</code>.
          </p>
          <CodeBlock code={MCP_INSTALL_COMMAND} label="Install command" />
          <OneClickInstall />
          <p className="mcp-hero-meta">
            free · 4 tools · MIT ·{' '}
            <a href={MCP_NPM_PACKAGE_URL} rel="noopener noreferrer">
              v{MCP_SERVER_VERSION}
            </a>
          </p>
        </section>

        <section className="mcp-section">
          <h2>What your agent gets back</h2>
          <p>
            Local scans return a Ship Gate summary the agent can read inline. Example output from{' '}
            <code>assurly_scan_path</code>:
          </p>
          <CodeBlock code={SCAN_PATH_SAMPLE} label="Example assurly_scan_path output" />
          <p>
            The same tool also returns a markdown report and a JSON payload with{' '}
            <code>verdict</code>, <code>status</code>, <code>shipScore</code>, <code>blockers</code>
            , <code>reviews</code>, <code>warnings</code>, <code>findings</code>,{' '}
            <code>detectedStack</code>, and <code>scanScope</code>.
          </p>
          <p>
            <code>assurly_verdict</code> reads the hosted API only — it never scans locally and
            never triggers an active probe. Pass exactly one of <code>url</code> or{' '}
            <code>repo</code> (<code>owner/name</code>). Example:
          </p>
          <CodeBlock code={VERDICT_SAMPLE} label="Example assurly_verdict output" />
          <p>
            When the hosted status is <code>blocked</code>, the tool returns that text with{' '}
            <code>isError: true</code>, so the agent stops instead of shipping.
          </p>
        </section>

        <section className="mcp-section">
          <h2>Tools</h2>
          <div className="mcp-table-wrap" role="region" aria-label="MCP tools" tabIndex={0}>
            <table className="mcp-table">
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
                <tr>
                  <td>
                    <code>assurly_verdict</code>
                  </td>
                  <td>
                    Read the hosted ship verdict (status, Ship Score, top issue) for a deployed URL
                    or repository. Requires <code>ASSURLY_API_KEY</code>; a blocked verdict is
                    returned as an error so the agent stops instead of shipping.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="mcp-section" id="install">
          <h2>Install</h2>
          <OneClickInstall />
          <p className="mcp-install-note">
            One-click install exists only where the client offers it: Cursor and VS Code each accept
            a server config over a URL handler. <strong>Claude Code</strong> installs with a single
            terminal command and <strong>Windsurf</strong> with a config file — no less supported,
            just one copy away in the tabs below.
          </p>
          <p className="mcp-prerequisites">
            Prerequisites: Node.js <code>^20.19.0 || &gt;=22.12.0</code>. Run via{' '}
            <code>npx -y @assurly/mcp-server</code> (package <code>@assurly/mcp-server</code>, bin{' '}
            <code>assurly-mcp</code>).
          </p>
          <InstallTabs />
        </section>

        <section className="mcp-section">
          <h2>Make the gate automatic</h2>
          <p>
            A ship gate nobody remembers to invoke is not a gate. Paste this into{' '}
            <code>.cursorrules</code>, <code>CLAUDE.md</code>, or <code>AGENTS.md</code> so the
            agent calls Assurly before every deploy without being asked:
          </p>
          <CodeBlock code={GATE_RULES_SNIPPET} label="Agent rules for automatic ship gate" />
        </section>

        <section className="mcp-section">
          <h2>Connect the hosted verdict</h2>
          <p>
            <code>assurly_verdict</code> requires <code>ASSURLY_API_KEY</code>. Create a key in the
            dashboard under <strong>Settings → API keys</strong> (shown once), then expose it to the
            MCP server. Optional: <code>ASSURLY_API_URL</code> defaults to{' '}
            <code>https://assurly.dev</code>.
          </p>
          <p>
            Example Cursor <code>.cursor/mcp.json</code> with the key set (VS Code uses{' '}
            <code>servers</code> instead of <code>mcpServers</code>):
          </p>
          <CodeBlock code={HOSTED_VERDICT_ENV} label="MCP env with ASSURLY_API_KEY" />
        </section>

        <section className="mcp-section">
          <h2>Typical agent loop</h2>
          <AgentLoop />
        </section>

        <section className="mcp-section">
          <h2>Troubleshooting</h2>
          <ul>
            <li>
              <strong>Node too old.</strong> The server requires Node{' '}
              <code>^20.19.0 || &gt;=22.12.0</code>. Upgrade, then retry{' '}
              <code>npx -y @assurly/mcp-server</code>.
            </li>
            <li>
              <strong>Tools not appearing after install.</strong> Restart the client or reload MCP,
              then confirm the four <code>assurly_*</code> tools are listed.
            </li>
            <li>
              <strong>Missing API key.</strong> <code>{ERR_API_KEY_MISSING}</code>
            </li>
            <li>
              <strong>Invalid or revoked key.</strong> <code>{ERR_API_KEY_INVALID}</code>
            </li>
            <li>
              <strong>Wrong verdict arguments.</strong> <code>{ERR_VERDICT_ARGS}</code>
            </li>
          </ul>
        </section>

        <section className="mcp-section">
          <h2>Pricing</h2>
          <p>
            The MCP server is <strong>free</strong>. Local scans and explaining blockers before
            deploy are part of the Free tier — the same distribution model as the URL scan.
          </p>
          <p>
            Paid plans (Pro and OEM) add monitoring, private repos, auto-fix PRs, regression alerts,
            AI deep review, and the white-label keyed verdict.
          </p>
        </section>
      </main>
      <SiteFooter variant="full" />
    </div>
  );
}
