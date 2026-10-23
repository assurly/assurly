import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import mcpServerPackage from '../../../../../packages/mcp-server/package.json';
import { MCP_LIMITS } from '../../utils/mcp/limits';
import { MCP_TOOL_COUNT } from '../../utils/productFacts';
import { resolveSiteNavAuth } from '../../utils/siteNavAuth';
import { PRO_TRIAL_COPY, PRO_TRIAL_PERIOD_DAYS } from '../../utils/pricing';
import { SITE_OG_IMAGE } from '../../utils/siteMetadata';
import { subPageGraph } from '../../utils/structuredData';
import { SiteFooter } from '../_components/SiteFooter';
import { StructuredData } from '../_components/StructuredData';
import { AgentLoop } from './_components/AgentLoop';
import { CodeBlock } from './_components/CodeBlock';
import {
  CLAUDE_DIRECTORY_LISTING_HREF,
  CLAUDE_CONNECTOR_URL,
  MCP_INSTALL_COMMAND,
  MCP_NPM_PACKAGE_URL,
} from './_components/installDeeplinks';
import { InstallTabs } from './_components/InstallTabs';
import { McpHeader } from './_components/McpHeader';
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
    images: [SITE_OG_IMAGE],
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
Scanned repository · 0 of 0 source files
Warnings (review):
  · No .env.example file found at the root of the project. It is highly r… → 1 file
  · GitHub Actions workflow for Assurly is missing.     → 1 file
     ↳ Run: npx assurly init`;

const VERDICT_SAMPLE = `Assurly Live Lock: BLOCKED · Ship Score 59/100
Target: https://my-app.vercel.app
Commit: abc1234
BLOCKED (runtime_blocker). Do not deploy. Open the Assurly proof for this URL.`;

const GATE_RULES_SNIPPET = `# Assurly ship gate
Before deploying, pushing to production, or claiming the app is ready to ship:
1. Call assurly_scan_path (or assurly_scan_files) on the project.
2. Fix every blocker; re-scan until the verdict is READY TO SHIP.
3. Before deploy, call assurly_verdict with the deployed url and the gitSha of the commit. Live Lock runs a fresh read-only check. BLOCKED is returned with isError: true — stop and do not ship. READY applies only to that run.
4. After you claim a fix: deploy is allowed only when a new assurly_verdict call for that commit returns READY. A stored score is not a ship decision.
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
const ERR_VERDICT_ARGS =
  'Live Lock needs the deployed `url` and the `gitSha` of the commit being deployed. A stored score is not a ship decision.';

/** Published version from packages/mcp-server/package.json — bundled at build time. */
const MCP_SERVER_VERSION: string = mcpServerPackage.version;

export default async function McpPage(): Promise<ReactElement> {
  const { authenticated, loginUrl } = await resolveSiteNavAuth();

  return (
    <div className="mcp-container">
      <StructuredData graph={subPageGraph('/mcp', 'MCP Server', PAGE_DESCRIPTION)} />
      <McpHeader authenticated={authenticated} loginUrl={loginUrl} />

      <main className="mcp-content">
        <section className="mcp-hero" aria-labelledby="mcp-hero-heading">
          <h1 id="mcp-hero-heading">Assurly MCP Server</h1>
          <p className="mcp-hero-lead">
            A ship gate AI agents call before deploy — add it to Claude in one click, or run{' '}
            <code>@assurly/mcp-server</code> in Cursor, Claude Code and other MCP clients.
          </p>
          <CodeBlock code={MCP_INSTALL_COMMAND} label="Install command" />
          <OneClickInstall includeClaude />
          <p className="mcp-hero-meta">
            free · {MCP_TOOL_COUNT} tools · MIT ·{' '}
            <a href={MCP_NPM_PACKAGE_URL} rel="noopener noreferrer">
              v{MCP_SERVER_VERSION}
            </a>
          </p>
        </section>

        <section className="mcp-section" aria-labelledby="mcp-claude-heading">
          <h2 id="mcp-claude-heading">Use it in Claude — no install</h2>
          <p>
            Assurly is in the Claude connectors directory. Connect it on the web, desktop or mobile,
            then ask <em>“Is my app safe to launch? https://my-app.lovable.app”</em>. Its one tool,{' '}
            <code>check_live_app</code>, checks the deployed app from the outside and answers with a
            ship verdict, a Ship Score and a fix for each problem.
          </p>
          <CodeBlock code={CLAUDE_CONNECTOR_URL} label="Connector URL" />
          <div className="mcp-one-click">
            <a href={CLAUDE_DIRECTORY_LISTING_HREF} className="mcp-one-click-btn">
              Add Assurly to Claude
            </a>
          </div>
          <p>
            The button opens Assurly in the Claude connectors directory — click{' '}
            <strong>Connect</strong>. No Assurly account is needed. Other MCP clients, such as
            Claude Code, can connect to the URL above directly.
          </p>
          <p>
            The check is passive: it loads the public page and its scripts like a browser and never
            logs in, submits data or reads your database. Each site can be checked{' '}
            {MCP_LIMITS.scansPerTarget.limit} times per{' '}
            {MCP_LIMITS.scansPerTarget.windowSeconds / 60} minutes.
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
            <code>assurly_verdict</code> calls Live Lock. Pass the deployed <code>url</code> and the{' '}
            <code>gitSha</code> being deployed. The answer is READY or BLOCKED from that fresh
            read-only check, not from a stored score. Example:
          </p>
          <CodeBlock code={VERDICT_SAMPLE} label="Example assurly_verdict output" />
          <p>
            When Live Lock is <code>blocked</code>, the tool returns that text with{' '}
            <code>isError: true</code>, so the agent does not deploy. Call it again after the fix is
            on the URL. A previous READY does not cover a new commit.
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
                    Live Lock for a deployed URL. Requires <code>ASSURLY_API_KEY</code>,{' '}
                    <code>url</code>, and <code>gitSha</code>. READY or BLOCKED comes from a fresh
                    read-only check. BLOCKED is returned as an error so the agent does not deploy.
                  </td>
                </tr>
                <tr>
                  <td>
                    <code>assurly_scan_agent</code>
                  </td>
                  <td>
                    Advisory audit of MCP client configs and agent instruction files only. Never
                    blocks ship (<code>isError</code> stays false).
                  </td>
                </tr>
                <tr>
                  <td>
                    <code>assurly_plant_canary</code>
                  </td>
                  <td>
                    Mint <code>ASSURLY_CANARY_URL</code> via the hosted API and append it to local{' '}
                    <code>.env.example</code>. Requires <code>ASSURLY_API_KEY</code>. Never uploads
                    source.
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
              then confirm the six <code>assurly_*</code> tools are listed.
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
            AI deep review, and the white-label keyed verdict. {PRO_TRIAL_COPY.sectionHint} A
            payment method is required at checkout; cancel before day {PRO_TRIAL_PERIOD_DAYS} and
            you pay nothing.
          </p>
        </section>
      </main>
      <SiteFooter variant="full" />
    </div>
  );
}
