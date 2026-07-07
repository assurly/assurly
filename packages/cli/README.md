# assurly

**A pre-deploy ship gate for AI-built SaaS.** Scan a Next.js + Supabase + Stripe + Vercel project locally and get one trusted verdict — what will break in production, and what you can safely ignore — before you ship.

```sh
npx assurly scan --path .
```

No sign-up, no upload. **Your source code is analyzed on your machine and is never sent anywhere.**

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

## Usage

```sh
# scan the current project
npx assurly scan --path .

# JSON output for CI / tooling
npx assurly scan --path . --json

# scaffold a GitHub Actions workflow
npx assurly init
```

Requires Node.js >= 20.9.

## Related

- **Run it from your AI agent (Cursor / Claude Code):** [`@assurly/mcp-server`](https://www.npmjs.com/package/@assurly/mcp-server) — the same gate over MCP. See [assurly.dev/mcp](https://assurly.dev/mcp).
- **Full product (URL scan, auto-fix PRs, continuous monitoring):** [assurly.dev](https://assurly.dev).

## License

MIT
