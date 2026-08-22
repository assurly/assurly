# 16 — Canary URL tripwire (V1)

> **Status:** shipped · **Branch:** `feat/canary-url-tripwire` · **Priority:** trust / remediation

## Goal

Turn today's `ask_canary_` string into a tripwire a vibe coder can plant in ~30 seconds: an HTTPS callback URL under `ASSURLY_CANARY_URL`, a post-scan **Add a silent alarm** card with Copy snippet, and hit copy that tells them to rotate real Stripe / Supabase / GitHub secrets — not the canary URL.

## Scope / Non-goals

**In scope:**

- Issue returns `https://<app-origin>/api/canary/<plaintext>` plus a three-line `.env.example` snippet keyed `ASSURLY_CANARY_URL`.
- Post-scan / app-workspace card: Add a silent alarm → Copy snippet. Armed · Never used after issue.
- Expert Issue / Revoke / Delete stays in Settings.
- Hit email, webhook, and dashboard copy: rotate real secrets on this target.
- Scanner allowlist: `ASSURLY_CANARY_URL`, `ask_canary_`, and `/api/canary/` are informational, never a leak/blocker.
- Reuse the existing oracle-safe callback. No new host, DNS, or tables.

**Not in scope (do NOT do):**

- Wildcard `canary.assurly.dev` / DNS tokens.
- GitHub PR plant (`/api/canary/plant` or reuse of `createFix`).
- MCP `assurly_plant_canary` / CLI `npx assurly canary plant`.
- Thinkst MCP `mcp.json` honeypot.
- Fake `sk_live_` / `NEXT_PUBLIC_SUPABASE_URL` / `DATABASE_URL` decoys that claim to trip Stripe or Supabase APIs.
- Auto-rotate of real credentials. Runtime "decoy in client bundle" as a hit.

## Acceptance Criteria

1. Snippet key is exactly `ASSURLY_CANARY_URL`. It never assigns `NEXT_PUBLIC_SUPABASE_URL`, `STRIPE_SECRET_KEY`, or `DATABASE_URL`.
2. GET/POST `/api/canary/<token>` still returns the identical body for valid, invalid, and malformed tokens.
3. App workspace shows Add a silent alarm + Copy; Settings still has Issue / Revoke.
4. A planted `.env.example` line is `assurly-canary-planted` (warning), never `stripe-secret-leak` / `public-secret`.
5. Hit alerts tell the operator to rotate real Stripe, Supabase, and GitHub secrets — not the canary URL.

## Existing code to reuse

- [`apps/web/src/utils/canaryTokens.ts`](../../apps/web/src/utils/canaryTokens.ts) — mint, hash, callback body, alerts.
- [`apps/web/src/app/api/canary/[token]/route.ts`](../../apps/web/src/app/api/canary/[token]/route.ts) — public hit.
- [`apps/web/src/app/api/targets/[id]/canary/route.ts`](../../apps/web/src/app/api/targets/[id]/canary/route.ts) — issue once.
- [`packages/scanner-core/src/canaryToken.ts`](../../packages/scanner-core/src/canaryToken.ts) — prefix recognition.
- [`apps/web/src/utils/env.ts`](../../apps/web/src/utils/env.ts) `getApplicationUrl()` — callback origin.

## Tests

- Unit: snippet shape, forbidden keys, scanner allowlist, hit copy.
- Route: issue returns `callbackUrl` + `snippet`; callback oracle-safety unchanged.
- Component: silent-alarm CTA Copy; Settings Issue/Revoke; hit playbook copy.
- E2E: after a scan fixture, Add a silent alarm is visible and Copy appears after issue.
