# 17 — Canary peak (three PRs)

> **Status:** implemented · **Priority:** trust / remediation

## Goal

Turn the V1 silent alarm (Copy `ASSURLY_CANARY_URL`) into the peak Assurly canary: a Ship Gate finding when nothing is planted, plant-without-thinking via GitHub PR / MCP / CLI, and the two trips V1 misses — canary leaked into a live client bundle, and a decoy MCP config that agents POST to.

This is **not** a Thinkst clone. Assurly wins on Ship Gate + live URL + MCP agent loop.

## Scope / Non-goals

**In scope (three focused PRs):**

1. **Missing plant is a Ship Gate action.** If `.env.example` exists and has no `ASSURLY_CANARY_URL` / canary plant line, emit warning `assurly-canary-missing` (high confidence). Never a blocker. Offline scanner cannot mint a live callback URL.
2. **Plant into the project.** `POST /api/targets/[id]/canary/plant` opens a GitHub PR that appends the public snippet to `.env.example`. MCP `assurly_plant_canary` and CLI `npx assurly canary plant` mint via org API key and write local `.env.example`. Same public snippet (`https://assurly.dev/api/canary/…`, key `ASSURLY_CANARY_URL`). Loopback origin still maps to `https://assurly.dev`.
3. **Missed trips.** Canary token or `/api/canary/` in live HTML/JS → warning `assurly-canary-in-client` (not a new blocker); do not fetch the callback during scan. Existing POST callback accepts a small JSON-RPC body with the same oracle-safe 200 body. Copy snippet #2 is a decoy `.cursor/mcp.json` server (`assurly-cloud-auth`) that must not be enabled in the operator's own Cursor.

**Not in scope (do NOT do):**

- Fake `sk_live_` / `NEXT_PUBLIC_SUPABASE_URL` / `DATABASE_URL` decoys that claim to trip Stripe or Supabase APIs.
- Wildcard DNS / `canary.assurly.dev` tokens.
- Word/PDF canaries.
- Auto-rotate of real credentials.
- Thinkst-clone of 20 token types.
- `/api/github/fix` / `createFix` as the plant engine (plant is not a finding auto-fix).
- DNS token, Vercel env API plant, fake AWS keys, Thinkst-level MCP tool-call honeypot (session + fake tools).

## Acceptance Criteria

### PR1 — `assurly-canary-missing`

1. `.env.example` without `ASSURLY_CANARY_URL` (and without a canary plant line) → warning `assurly-canary-missing`, confidence high.
2. `ASSURLY_CANARY_URL=` (or a planted canary line) → `assurly-canary-planted` informational; **not** missing.
3. A Stripe leak on another line is still `stripe-secret-leak` error.
4. `assurly-canary-missing` is **not** on `HIGH_CONFIDENCE_BLOCKER_RULE_IDS`.
5. Suggestion tells the operator to add a silent alarm in Assurly (dashboard / MCP plant). It must not include a fake token.
6. Ship Gate groups the finding with a CTA to the existing silent-alarm card (`#canary-silent-alarm`), not a second form.

### PR2 — Plant channels

1. `POST /api/targets/[id]/canary/plant` is `secureRoute` + ownership-gated. It issues a token if needed, appends the public snippet to `.env.example` via the Git Contents pattern (not `createFix`), and opens a **pull request** (never a commit on `main`). Idempotent if the key is already present.
2. Loopback `APP_URL` is never planted; origin is `resolveCanaryCallbackOrigin` → `https://assurly.dev`.
3. MCP `assurly_plant_canary` requires `ASSURLY_API_KEY`, mints via `POST /api/v1/canary`, writes local `.env.example`. No source upload.
4. CLI `npx assurly canary plant` is the same local-first write.
5. Silent-alarm card: primary **Open plant PR** when the GitHub App is connected; otherwise Copy. Agents use MCP.

### PR3 — Bundle + decoy MCP

1. `ask_canary_` or `/api/canary/` in live HTML/JS → `assurly-canary-in-client` warning + high. Not a new blocker. Scan must not HTTP-fetch the callback URL (no self-hit).
2. Copy: tripwire is in public JS; rotate real secrets; take the canary off the client.
3. `POST /api/canary/[token]` accepts a small JSON body and still returns the identical 200 body for valid, invalid, and malformed tokens (oracle-safe).
4. Second snippet is a decoy MCP server named `assurly-cloud-auth` whose `url` is the callback. Operators must **not enable** it (add the name to `disabledMcpjsonServers`) so their own Cursor does not false-hit.
5. Decoy MCP JSON is not an `agent-mcp-insecure-endpoint` Ship Gate blocker.
6. E2E Copy (or plant reveal) shows both the `.env.example` snippet and the MCP decoy snippet.

## Existing code to reuse

- [`packages/scanner-core/src/index.ts`](../../packages/scanner-core/src/index.ts) `scanEnvVariables` / `scanExampleFileSecrets`
- [`packages/scanner-core/src/canaryToken.ts`](../../packages/scanner-core/src/canaryToken.ts)
- [`packages/scanner-core/src/blockerAllowlist.ts`](../../packages/scanner-core/src/blockerAllowlist.ts) — do not add canary rules
- [`apps/web/src/utils/githubFixPipeline.ts`](../../apps/web/src/utils/githubFixPipeline.ts) Git Contents + PR pattern
- [`apps/web/src/utils/canaryPlant.ts`](../../apps/web/src/utils/canaryPlant.ts) `resolveCanaryCallbackOrigin`
- [`apps/web/src/app/api/targets/[id]/canary/route.ts`](../../apps/web/src/app/api/targets/[id]/canary/route.ts) issue
- [`apps/web/src/app/api/canary/[token]/route.ts`](../../apps/web/src/app/api/canary/[token]/route.ts) callback
- [`apps/web/src/utils/runtimeScanner.ts`](../../apps/web/src/utils/runtimeScanner.ts)
- [`packages/mcp-server/src/tools.ts`](../../packages/mcp-server/src/tools.ts) `assurly_verdict` API-key pattern

## Tests

- Unit: missing vs planted vs Stripe leak; missing is not a blocker; merge into `.env.example` is idempotent; bundle finding does not fetch the callback; decoy MCP JSON is not `agent-mcp-insecure-endpoint`.
- Route: plant payload + idempotency; `secureRoute` + ownership; POST JSON-RPC still oracle-safe; `POST /api/v1/canary` mints for an API key.
- MCP: `assurly_plant_canary` in `ASSURLY_MCP_TOOL_NAMES`; writes `.env.example` locally.
- Component / e2e: Ship Gate CTA to silent alarm; Open plant PR → PR URL; Copy shows both snippets.
