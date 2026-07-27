# @assurly/scanner-core

The browser-safe static-analysis engine behind [Assurly](https://assurly.dev) — the rules that decide whether a Next.js + Supabase + Stripe + Vercel app is ready to ship. Shared by the web scanner, the CLI, the GitHub integration, and the MCP server so every surface produces the same Ship Gate verdict.

> **Most people don't install this directly.** If you want to _run_ a scan, use one of these instead:
>
> - **CLI:** [`assurly`](https://www.npmjs.com/package/assurly) — `npx assurly scan --path .`
> - **AI agents (Cursor / Claude Code):** [`@assurly/mcp-server`](https://www.npmjs.com/package/@assurly/mcp-server) — see [assurly.dev/mcp](https://assurly.dev/mcp)
>
> This package is the reusable rule engine those tools are built on.

## In short

`@assurly/scanner-core` is the offline rule engine behind Assurly. It exports pure
functions that take file contents and return findings, with no filesystem access, no
network calls and no telemetry, so the same rules run in Node and in a browser. Coverage
spans Supabase row-level security, Stripe webhook signature verification, secrets reaching
client bundles, React Server Component leaks, SQL migration safety, connection pooling,
edge-runtime compatibility, cold starts, AI agent configuration (MCP client configs and
instruction files), and install-time trust under npm 12 — the `allowScripts` allowlist,
lockfile packages that declare install scripts, and non-registry dependencies. Every rule
carries a confidence level so a gate can separate near-certain blockers from heuristics.

## What it does

Each rule carries an honest **confidence** so the Ship Gate can separate the three states that matter:

- **Blockers** — high-confidence, high-impact issues you must fix before deploying (e.g. a Supabase table with RLS disabled, a Stripe webhook without signature verification, a live secret in the bundle).
- **Review** — heuristic findings worth a look, never a hard stop.
- **Warnings** — lower-severity noise you can usually ship past.

Detection is intentionally **precise over exhaustive**: a rule that can't be defended to a senior engineer in 30 seconds is not a blocker.

> **Static rules stay high-trust and few.** Prefer raising precision of the existing gate over growing
> the rulebook. Net-new static surfaces (e.g. install-time trust / `supply-*`) are exceptions when they
> audit a durable local trust artefact with zero network and clear false-positive discipline. Depth
> otherwise comes from the runtime probe and the AI layer.

## Can these rules run in a browser?

Yes. Every export is a pure function that takes file contents as a string and returns
findings — no `fs`, no `child_process`, no network client. That is why the same rule set
backs the web dashboard, the CLI, the GitHub integration and the MCP server, and why a scan
in one surface matches a scan in another on the same project.

## What does a rule's confidence mean?

Confidence is the rule's own estimate of how certain the finding is, and it is what decides
whether something can stop a deploy:

> Only an `error` finding with `high` confidence can become a blocker. Everything else lands
> in review or warnings. A rule that cannot be defended to a senior engineer in thirty
> seconds does not get to block a deploy, because a gate that cries wolf is switched off,
> and a gate that is switched off protects nothing.

Two categories never block at all, whatever their severity: `agent-*` and `supply-*`. Those
audit the developer's own tooling rather than the application being deployed.

## What does it check for Supabase, Stripe and npm?

- **Supabase** — tables created without [row-level
  security](https://supabase.com/docs/guides/database/postgres/row-level-security), policies
  that grant unrestricted access via `USING (true)`, and service-role keys reachable from
  client code.
- **Stripe** — webhook endpoints that never call
  [`constructEvent`](https://docs.stripe.com/webhooks#verify-official-libraries) to verify
  the signature, missing idempotency, and live keys in development env files.
- **npm** — the [`allowScripts`
  allowlist](https://github.blog/changelog/2026-06-09-upcoming-breaking-changes-for-npm-v12/)
  introduced when npm 12 stopped running install scripts by default, lockfile packages that
  declare install scripts, and non-registry dependencies.

## Does it send anything anywhere?

No. The package makes no network requests and collects no telemetry. It has no filesystem
access either — callers read files and pass in the contents, which is what keeps it
browser-safe.

## Usage

```ts
import { scanSqlMigration, buildShipGateReport } from '@assurly/scanner-core';

const { findings } = scanSqlMigration(sqlSource, 'supabase/migrations/init.sql');
const report = buildShipGateReport(findings, { scannedFileCount: 1, cleanFileCount: 0 });

console.log(report.status); // 'blocked' | 'review' | 'ready'
console.log(report.shipScore); // 0–100
```

The package is browser-safe (no Node-only imports), so the same rules run in the web dashboard and on the server.

## License

MIT
