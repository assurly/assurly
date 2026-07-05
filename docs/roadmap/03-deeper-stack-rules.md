# Phase 3 — Deeper Stack Rules

> **Status:** proposed · **Branch:** `feat/phase-3-deeper-stack` · **Priority:** 🟠 high (depth = defensibility)

## Goal

Add the high-value, stack-native rules that make ShipReady deeper than a generic scanner — the checks a senior
engineer would actually run before shipping a Next.js + Supabase + Stripe app: auth/session boundaries, deeper
Supabase misconfigurations, Stripe lifecycle correctness, and Vercel deploy readiness.

## Why

Detection breadth is a losing game vs Snyk/Semgrep. Detection **depth in one stack** is not — it is exactly where a
focused product beats a generalist. These rules answer "will this specific stack break or leak in production?"
better than any general tool, which is the whole positioning. They are also high-precision by nature, so most can be
blockers (unlike the heuristic AI rules in Phase 2).

## Scope / Non-goals

**In scope:**

- New detection rules in `scanner-core`, grouped into four areas (below).
- Each rule carries an honest `confidence` (Phase 0) so only high-precision ones block.

**Not in scope (do NOT do):**

- No CVE/dependency database (that is a future OSV/Socket integration, not this phase).
- No auto-fix for these (auto-fix stays high-confidence and lives in Phase 2 scope).
- No new UI — findings render in the existing report.

## Existing code to reuse

- **Rule engine:** `packages/scanner-core/src/index.ts` — add scanners here; follow the shape of existing ones
  (`scanStripeWebhook`, `scanSupabaseClientLeaks`, `scanSqlMigrations`).
- **Auth references (for accurate detection):** `apps/web/src/utils/{auth,authorization,scanProxy,sessionCookie}.ts`
  show what a real auth/session check looks like in this codebase — use them to avoid false positives.
- **Ship Gate:** `buildShipGateReport` — no change needed; new findings flow through, classified by confidence.

## New `ruleId`s

### Area A — Auth & Session boundaries (Next.js App Router)

| ruleId                           | severity | confidence | Detection                                                                               |
| -------------------------------- | -------- | ---------- | --------------------------------------------------------------------------------------- |
| `auth-server-action-no-check`    | error    | high       | A Server Action (`'use server'`) that mutates data with no auth/session check           |
| `auth-route-handler-unprotected` | error    | medium     | A route handler under a protected area with no session/`authorization` check            |
| `auth-service-role-bypass`       | error    | high       | Server code uses the Supabase `service_role` client to bypass RLS without a clear guard |

### Area B — Supabase (deeper than "RLS missing")

| ruleId                                  | severity | confidence | Detection                                                                 |
| --------------------------------------- | -------- | ---------- | ------------------------------------------------------------------------- |
| `supabase-policy-permissive`            | error    | high       | An RLS policy exists but is effectively `USING (true)` (open to everyone) |
| `supabase-storage-public-default`       | warning  | high       | A storage bucket created `public` by default                              |
| `supabase-migration-auth-linked-no-rls` | error    | high       | A migration creates a table linked to `auth.users` without enabling RLS   |

### Area C — Stripe lifecycle (real-world)

| ruleId                               | severity | confidence | Detection                                                                            |
| ------------------------------------ | -------- | ---------- | ------------------------------------------------------------------------------------ |
| `stripe-webhook-no-idempotency`      | warning  | medium     | A webhook handler with no idempotency/replay protection                              |
| `stripe-live-key-in-dev`             | error    | high       | A `sk_live_` key referenced in a dev/test env file committed to the repo             |
| `stripe-missing-subscription-events` | warning  | low        | Subscription billing present but key lifecycle events unhandled (heuristic → review) |

### Area D — Vercel deploy readiness

| ruleId                       | severity | confidence | Detection                                                                                           |
| ---------------------------- | -------- | ---------- | --------------------------------------------------------------------------------------------------- |
| `vercel-edge-node-mismatch`  | error    | high       | Code declares `runtime = 'edge'` but imports Node-only modules (extends existing `scanEdgeRuntime`) |
| `vercel-maxduration-missing` | warning  | low        | A long-running route with no `maxDuration` configured (heuristic → review)                          |

> Confidence discipline: only the high-precision rules are blockers. Anything the scanner cannot prove stays a
> warning or review. Do not promote a heuristic to blocker to look thorough.

## Tasks

1. **Area A scanners** — new `packages/scanner-core/src/authBoundary.ts`:
   - `scanServerActionAuth`, `scanRouteHandlerAuth`, `scanServiceRoleBypass`. Use the auth-util references above to
     recognize a legitimate check and avoid false positives (e.g. presence of a `getSession`/`requireUser`-style call).
2. **Area B scanners** — extend `scanSqlMigrations`/add `supabasePolicies.ts`:
   - Parse policy statements; flag `USING (true)`; detect `public` storage buckets; detect auth-linked tables without RLS.
3. **Area C scanners** — extend `stripeRules`/add `stripeLifecycle.ts`:
   - Idempotency detection, live-key-in-dev, subscription-events heuristic.
4. **Area D scanners** — extend `scanEdgeRuntime` and add `maxDuration` heuristic.
5. **Register** all new scanners in the standard scan set (`index.ts`) with correct severity + confidence.
6. **Tests** for every rule (positive AND negative fixtures — negative fixtures prevent false positives).

## New / changed files

```
packages/scanner-core/src/authBoundary.ts              (new)
packages/scanner-core/src/authBoundary.test.ts         (new)
packages/scanner-core/src/supabasePolicies.ts          (new)
packages/scanner-core/src/supabasePolicies.test.ts     (new)
packages/scanner-core/src/stripeLifecycle.ts           (new)
packages/scanner-core/src/stripeLifecycle.test.ts      (new)
packages/scanner-core/src/index.ts                     (change — export + register new scanners)
packages/scanner-core/src/vercelRules(...)             (change — edge/node + maxDuration)
```

## Acceptance criteria

- [ ] Each new rule has both a **positive** fixture (fires) and a **negative** fixture (does NOT fire when the code
      is correct) — negative fixtures are mandatory to keep the false-positive rate < 5%.
- [ ] `auth-service-role-bypass` does NOT fire when a legitimate guard is present (verified by negative fixture).
- [ ] `supabase-policy-permissive` fires on `USING (true)` and not on a scoped `auth.uid()` policy.
- [ ] `stripe-live-key-in-dev` fires on `sk_live_` in a committed dev env file, masked in the message.
- [ ] High-precision rules are blockers; heuristic rules (`stripe-missing-subscription-events`,
      `vercel-maxduration-missing`, etc.) are review/warning.
- [ ] Total blocker rules across the product stay at ~12 or fewer (count them; document the list in a code comment).
- [ ] ShipReady self-scan still reports 0–2 blockers (Phase 0 gate not regressed).

## Tests

- **Unit:** one test file per area, each rule with positive + negative fixtures; assert severity AND confidence.
- **Integration:** run the full scan set over `test-projects/broken-project` and `test-projects/clean-project`
  (existing fixtures) → broken yields the expected blockers, clean yields none.

## How to verify

```bash
npm run test -w @shipready/scanner-core
npm run scan:self          # must still be 0–2 blockers
```
