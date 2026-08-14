# assurly

```
$ npx assurly scan --supply

⚠  7 packages can run code at install time
   package.json has no allowScripts — npm 12 blocks this by default
   you have not recorded which install scripts you trust
```

**A pre-deploy ship gate for AI-built SaaS.** Scan a Next.js + Supabase + Stripe + Vercel project locally and get one trusted verdict — what will break in production, and what you can safely ignore — before you ship. Install-time trust (`--supply`) audits the npm 12 `allowScripts` allowlist and lockfile install scripts from files you already have — no network, no registry calls.

```sh
npx assurly scan --path .
```

No sign-up, no upload. **Your source code is analyzed on your machine and is never sent anywhere.**

## In short

Assurly is a command-line ship gate for projects built with AI coding tools. It reads a
project's own files — source, `package.json`, `package-lock.json`, `.npmrc`, MCP client
configs and agent instruction files — and returns one verdict: ready to ship, review, or
blocked. Thirteen rule areas cover Supabase row-level security, Stripe webhook signature
verification, secrets reaching client bundles, React Server Component leaks, migration
safety, connection pooling, edge compatibility, cold starts, the agent's own tooling, and
install-time trust under npm 12. It runs entirely offline, makes no registry calls, and
sends nothing anywhere. Install with `npx assurly scan`.

## Which of my dependencies can run code when I install them?

Your lockfile already knows. `package-lock.json` v2 and v3 record `hasInstallScript: true`
on every package that declares a `preinstall`, `install` or `postinstall` script, so the
list needs no network call to produce:

```sh
npx assurly scan --supply
```

This matters because [npm 12 stopped running those scripts by
default](https://github.blog/changelog/2026-06-09-upcoming-breaking-changes-for-npm-v12/):
`allowScripts` now defaults to off, and `--allow-git` and `--allow-remote` default to
`none`. Install time is where credential stealers run, because it happens before any
application code loads and needs no interaction beyond `npm install`.

## What is `allowScripts` and why did npm 12 add it?

`allowScripts` is an object in `package.json` that records which dependencies you trust to
execute code during installation. npm writes it when you run `npm approve-scripts`. Before
npm 12 there was no such list: every dependency could run code on every install.

## Is a bare package name in `allowScripts` safe?

No, and this is the part most people get wrong.

> A bare name such as `"canvas": true` grants install-script execution to **every version of
> that package, forever** — including a release published tomorrow by whoever takes the
> package over. An exact pin such as `"canvas@1.2.3": true` grants it to that version only.
> npm accepts a bare name, `name@*`, or exact versions joined by `||`; it silently drops
> `^`, `~`, `>=`, `<` ranges and dist-tags like `@latest`, so those entries grant nothing
> their author expects.

`assurly scan --supply` reports each of these separately, including allowlist entries for
packages no longer in your lockfile — a dead entry means that if the name is ever re-added,
it installs with execution already approved.

## When should I use this?

Run it right before you deploy — especially if the app was built quickly with an AI tool (Lovable, v0, Bolt, Cursor, Replit). Those tools produce working code fast, but they routinely leave the deployment wiring unfinished: a table without row-level security, a webhook that never verifies its signature, a service key that ends up in the client bundle.

You should reach for it when you are asking:

- _"Is this safe to deploy?"_
- _"Did I leave my Supabase tables open to the public?"_
- _"Is my Stripe webhook actually verifying signatures?"_
- _"Did a secret end up in the client bundle?"_
- _"Which dependencies are allowed to run code at install time?"_

## What it checks

Thirteen rule areas, all evaluated against your source on your machine:

| Area                        | Examples                                                                                  |
| --------------------------- | ----------------------------------------------------------------------------------------- |
| Supabase security           | tables created without row-level security, service-role keys reachable from the client    |
| Stripe integration          | webhook endpoints that skip signature verification                                        |
| Environment variables       | undocumented or unvalidated env vars, secrets exposed via `NEXT_PUBLIC_`                  |
| React Server Components     | data leaking from server to client components                                             |
| SQL / migration safety      | destructive or unguarded migration steps                                                  |
| Database connection pooling | pooling misconfigured for serverless                                                      |
| Vercel edge compatibility   | code that will not run on the edge runtime                                                |
| Cold start                  | patterns that make serverless functions slow to boot                                      |
| TypeScript strictness       | `strict` disabled, hiding real type errors                                                |
| CI integration              | missing GitHub Actions checks                                                             |
| Deeper stack                | cross-cutting integration risks                                                           |
| Agent stack                 | MCP client configs and instruction files (shell MCP, inline secrets, hidden prompts)      |
| Install-time trust          | npm `allowScripts` pins, lockfile `hasInstallScript`, non-registry deps, npm &lt; 12 pins |

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
- **Warnings** — lower-severity noise (including install-time trust — advisory only).

Findings come with concrete remediation (the exact SQL or config change), and the exit code is non-zero when the gate is blocked — so it drops straight into CI.

## How is this different from ESLint, npm audit, or Semgrep?

They answer different questions, and you want all of them:

- **ESLint** checks how your code is written — style, correctness, obvious mistakes.
- **npm audit** checks your _dependencies_ for known CVEs.
- **Semgrep** and similar generic SAST tools match broad code patterns across many languages.
- **assurly** checks how your app is _wired up for production_ on a specific stack — whether your database rows are actually protected, whether your payment webhook can be forged, whether a key you meant to keep private ships to the browser. Then it collapses that into a single go / no-go verdict rather than a list you have to triage. Install-time trust checks the allowlist you wrote down for npm 12 — it does not inspect package code (tools like Socket do that).

## Usage

```sh
# scan the current project
npx assurly scan --path .

# JSON output for CI / tooling (versioned Ship Gate report: shipScore + findings)
npx assurly scan --path . --json

# Full Gate for large repos: scan locally, submit verdict only (never uploads source)
ASSURLY_API_KEY=ask_… npx assurly scan --path . --submit --repo owner/repo

# attempt safe automatic fixes for configuration issues
npx assurly scan --path . --fix

# focused mode: agent stack only (MCP configs + instruction files)
npx assurly scan --agent

# focused mode: install-time trust only (allowScripts / lockfile scripts)
npx assurly scan --supply

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
