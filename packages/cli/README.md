# assurly

**A pre-deploy ship gate for AI-built SaaS.** Scan a Next.js + Supabase + Stripe + Vercel project locally and get one trusted verdict — what will break in production, and what you can safely ignore — before you ship.

```sh
npx assurly scan --path .
```

No sign-up, no upload. **Your source code is analyzed on your machine and is never sent anywhere.**

## When should I use this?

Run it right before you deploy — especially if the app was built quickly with an AI tool (Lovable, v0, Bolt, Cursor, Replit). Those tools produce working code fast, but they routinely leave the deployment wiring unfinished: a table without row-level security, a webhook that never verifies its signature, a service key that ends up in the client bundle.

You should reach for it when you are asking:

- _"Is this safe to deploy?"_
- _"Did I leave my Supabase tables open to the public?"_
- _"Is my Stripe webhook actually verifying signatures?"_
- _"Did a secret end up in the client bundle?"_

## What it checks

Twelve rule areas, all evaluated against your source on your machine:

| Area                        | Examples                                                                               |
| --------------------------- | -------------------------------------------------------------------------------------- |
| Supabase security           | tables created without row-level security, service-role keys reachable from the client |
| Stripe integration          | webhook endpoints that skip signature verification                                     |
| Environment variables       | undocumented or unvalidated env vars, secrets exposed via `NEXT_PUBLIC_`               |
| React Server Components     | data leaking from server to client components                                          |
| SQL / migration safety      | destructive or unguarded migration steps                                               |
| Database connection pooling | pooling misconfigured for serverless                                                   |
| Vercel edge compatibility   | code that will not run on the edge runtime                                             |
| Cold start                  | patterns that make serverless functions slow to boot                                   |
| TypeScript strictness       | `strict` disabled, hiding real type errors                                             |
| CI integration              | missing GitHub Actions checks                                                          |
| Deeper stack                | cross-cutting integration risks                                                        |
| Agent stack                 | MCP client configs and instruction files (shell MCP, inline secrets, hidden prompts)   |

## What you get

```
🚫 NOT READY TO SHIP                            Ship Score: 72/100

Blockers (must fix):
  1. Supabase table 'profiles' is created but Row-Level Security is not enabled. → 1 file
     ↳ ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
  2. Stripe webhook endpoint lacks signature verification. → 1 file
     ↳ stripe.webhooks.constructEvent(body, sig, secret)

Review (heuristic — verify before blocking deploy):
  ...
```

- **Blockers** — high-confidence issues that will bite you in production (RLS gaps, unverified webhooks, secrets in the bundle, service-role leaks).
- **Review** — heuristic findings worth a look, never a hard stop.
- **Warnings** — lower-severity noise.

Findings come with concrete remediation (the exact SQL or config change), and the exit code is non-zero when the gate is blocked — so it drops straight into CI.

## How is this different from ESLint, npm audit, or Semgrep?

They answer different questions, and you want all of them:

- **ESLint** checks how your code is written — style, correctness, obvious mistakes.
- **npm audit** checks your _dependencies_ for known CVEs.
- **Semgrep** and similar generic SAST tools match broad code patterns across many languages.
- **assurly** checks how your app is _wired up for production_ on a specific stack — whether your database rows are actually protected, whether your payment webhook can be forged, whether a key you meant to keep private ships to the browser. Then it collapses that into a single go / no-go verdict rather than a list you have to triage.

## Usage

```sh
# scan the current project
npx assurly scan --path .

# JSON output for CI / tooling
npx assurly scan --path . --json

# attempt safe automatic fixes for configuration issues
npx assurly scan --path . --fix

# focused mode: agent stack only (MCP configs + instruction files)
npx assurly scan --agent

# scaffold a GitHub Actions workflow
npx assurly init
```

Requires Node.js `^20.19.0 || >=22.12.0`.

## Use it from your AI agent

If you build with Cursor or Claude Code, your agent can call the same gate itself and refuse to ship until it passes — install [`@assurly/mcp-server`](https://www.npmjs.com/package/@assurly/mcp-server). Setup for both editors is in that package's README and at [assurly.dev/mcp](https://assurly.dev/mcp).

## Related

- [`@assurly/scanner-core`](https://www.npmjs.com/package/@assurly/scanner-core) — the rules on their own, for building your own tooling.
- **Full product** (live URL scanning, auto-fix pull requests, continuous monitoring on every deploy): [assurly.dev](https://assurly.dev).

## License

MIT
