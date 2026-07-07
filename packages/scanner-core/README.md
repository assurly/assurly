# @shipready/scanner-core

The browser-safe static-analysis engine behind [ShipReady](https://shipready.dev) — the rules that decide whether a Next.js + Supabase + Stripe + Vercel app is ready to ship. Shared by the web scanner, the CLI, the GitHub integration, and the MCP server so every surface produces the same Ship Gate verdict.

> **Most people don't install this directly.** If you want to _run_ a scan, use one of these instead:
>
> - **CLI:** [`@shipready/cli`](https://www.npmjs.com/package/@shipready/cli) — `npx @shipready/cli scan --path .`
> - **AI agents (Cursor / Claude Code):** [`@shipready/mcp-server`](https://www.npmjs.com/package/@shipready/mcp-server) — see [shipready.dev/mcp](https://shipready.dev/mcp)
>
> This package is the reusable rule engine those tools are built on.

## What it does

Each rule carries an honest **confidence** so the Ship Gate can separate the three states that matter:

- **Blockers** — high-confidence, high-impact issues you must fix before deploying (e.g. a Supabase table with RLS disabled, a Stripe webhook without signature verification, a live secret in the bundle).
- **Review** — heuristic findings worth a look, never a hard stop.
- **Warnings** — lower-severity noise you can usually ship past.

Detection is intentionally **precise over exhaustive**: a rule that can't be defended to a senior engineer in 30 seconds is not a blocker.

## Usage

```ts
import { scanSqlMigration, buildShipGateReport } from '@shipready/scanner-core';

const { findings } = scanSqlMigration(sqlSource, 'supabase/migrations/init.sql');
const report = buildShipGateReport(findings, { scannedFileCount: 1, cleanFileCount: 0 });

console.log(report.status); // 'blocked' | 'review' | 'ready'
console.log(report.shipScore); // 0–100
```

The package is browser-safe (no Node-only imports), so the same rules run in the web dashboard and on the server.

## License

MIT
