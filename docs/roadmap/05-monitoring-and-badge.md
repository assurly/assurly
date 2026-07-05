# Phase 5 — Continuous Monitoring, Regression Alerts & Ship Score Badge

> **Status:** proposed · **Branch:** `feat/phase-5-monitoring` · **Priority:** 🟡 medium (retention/revenue)

## Goal

Turn a one-off scan into a sticky, monthly product:

1. **Continuous monitoring** — scan on every deploy/PR (the GitHub App already supports this) and store the Ship
   Score trend over time.
2. **Regression alerts** — notify when a new blocker appears ("a new table without RLS in the latest commit").
3. **Ship Score badge** — a shareable SVG/link ("Ship Score 94/100 ✅") for a README or website = viral distribution.

## Why

A one-off scan is one-off revenue and churn. Monitoring + regression alerts are a reason to pay **every month**.
A badge on someone else's README/site is free advertising and an acquisition channel. The webhook infrastructure
already exists — only the trend, alerting, and badge rendering are missing.

## Scope / Non-goals

**In scope:**

- Store Ship Score history per repo (the model already carries counts on `Scan`).
- Detect regressions between consecutive scans (a new blocker that was not there before).
- A notification mechanism (email via a provider — the infra must be built).
- A public badge endpoint (SVG) + shareable report (partly exists via `share_token`).

**Not in scope (do NOT do):**

- No new rule types.
- No SMS/Slack/Discord (email only for now; others later).
- Do not change MCP or the runtime scanner.

## Verify before writing (email infra DOES NOT EXIST)

- There is **no** email/alert module under `apps/web/src/utils/`. Add a provider (e.g. Resend/Postmark) — check the
  current recommended API and add the key (e.g. `RESEND_API_KEY`) to the env schema (`src/utils/env.ts`) and
  `.env.example`. **Never hardcode the key.**
- Read `apps/web/src/app/api/github/webhook/route.ts` — this is where a scan runs on PR. Regression detection hooks
  in here.
- Read `apps/web/src/app/api/scans/share/route.ts` and `share_token` on `Scan` — the basis for the public report/badge.

## Existing code to reuse

- **Webhook scan:** `apps/web/src/app/api/github/webhook/route.ts` — runs a scan on PR/push.
- **DB model:** `apps/web/src/utils/dbAdapter.ts` — `Scan` (`error_count`, `warning_count`, `share_token`,
  `created_at`), `Repository`, `Organization`.
- **Ship Gate:** `buildShipGateReport` → Ship Score to store in the trend.
- **Share:** `share_token` + `/report/[token]` route — the badge builds on this.

## Tasks

1. **Regression detection** — new `apps/web/src/utils/scanRegression.ts`:
   - `detectRegressions(previous: ScanFinding[], current: ScanFinding[]): ScanFinding[]` — a pure function returning
     findings present in `current` but not in `previous` (keyed by `ruleId` + `file` + `line`). Easy to unit-test, no DB.
2. **Email/alert module** — new `apps/web/src/utils/notify.ts`:
   - `sendRegressionAlert(to, repo, regressions)` via the provider; env key via `env.ts`. Mock the provider in tests
     (no real send in tests).
3. **Wire into the webhook:** after a scan, load the repo's previous scan, call `detectRegressions`; if there is a
   new blocker, call `sendRegressionAlert`.
4. **Ship Score trend:** endpoint `GET /api/repositories/[id]/trend` → a series of `{ date, shipScore }` for a
   dashboard chart.
5. **Badge endpoint** — new `apps/web/src/app/api/badge/[token]/route.ts`:
   - Return **SVG** "Ship Score N/100" colored by verdict (green/amber/red), with cache headers.
   - Provide a copyable markdown snippet in the UI (`![Ship Score](https://.../api/badge/<token>)`).
6. **Tests.**

## New / changed files

```
apps/web/src/utils/scanRegression.ts            (new)
apps/web/src/utils/scanRegression.test.ts       (new)
apps/web/src/utils/notify.ts                    (new)
apps/web/src/utils/notify.test.ts               (new)
apps/web/src/utils/env.ts                        (change — RESEND_API_KEY etc.)
apps/web/src/app/api/github/webhook/route.ts     (change — regression detection + alert)
apps/web/src/app/api/repositories/[id]/trend/route.ts   (new)
apps/web/src/app/api/badge/[token]/route.ts      (new)
apps/web/src/app/dashboard/_components/...        (change — trend chart + "Copy badge")
```

## Acceptance criteria

- [ ] `detectRegressions(prev, curr)` returns only new findings; identical inputs → `[]`; edge cases tested.
- [ ] A new blocker between scans triggers the (mocked) `sendRegressionAlert` exactly once; no new blocker → no alert.
- [ ] `notify.ts` never sends a real email in tests (provider mocked); the env key is validated via `env.ts`.
- [ ] `GET /api/badge/<token>` returns valid SVG with `content-type: image/svg+xml` and verdict-based color.
- [ ] A non-existent token → 404 (no data leak).
- [ ] The trend endpoint returns a chronological Ship Score series for a repo.
- [ ] The dashboard shows the trend and offers a "Copy badge" markdown snippet.

## Tests

- **Unit:** `scanRegression.test.ts` (new/removed/unchanged findings), `notify.test.ts` (provider mock, error handling).
- **Integration:** badge route (SVG shape, 404), webhook route with two consecutive scans → alert fired once.

## How to verify

```bash
# from apps/web
npx tsc --noEmit && npm run lint
npm run test -- scanRegression
npm run test -- notify
npm run test -- badge
```
