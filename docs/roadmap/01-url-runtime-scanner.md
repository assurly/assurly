# Phase 1 — URL Runtime Scanner

> **Status:** proposed · **Branch:** `feat/phase-1-url-scanner` · **Priority:** 🔴 high

## Goal

Let a user **paste the URL of their deployed app** (e.g. `https://myapp.lovable.app`) and, with no access to the
source code, get a Ship Gate report from the **live runtime**: exposed Supabase tables (RLS probe), secrets/keys
in the production JS bundle, missing security headers, and exposed API surface.

This is a new entry point into the product — it opens ShipReady to the customer who has a URL, not a repo.

## Why

The competitors winning this niche (SafeToShip, Vibe App Scanner) win precisely here: the user pastes a URL, because
that matches reality — they have a deployment, not always a repo. Static analysis only sees code; **172 real apps
allowed anyone to delete rows using the public key**, and **170+ Lovable apps shipped with fully exposed databases**
— those are found by live probing, not repo scanning. Static (our strength) + runtime (new) differentiates us from
both competitor camps at once.

## Scope / Non-goals

**In scope:**

- A server-side endpoint that accepts a URL and runs safe, read-only runtime checks.
- A public section on the landing page and in the dashboard: "Scan a deployed URL".
- Output rendered through the **existing `buildShipGateReport` + `ShipGatePanel`** — no new report format, no redesign.

**Not in scope (do NOT do):**

- No destructive tests (never issue a real DELETE/INSERT against a third-party DB — read-probe only, see Safety rails).
- No logging into the target app, no auth bypass, no CAPTCHA solving.
- No full-site crawling and no load testing.
- Do not touch the CLI or MCP (other phases).

## Safety rails (CRITICAL — follow literally)

1. **Read-only.** Probes may only issue `GET`/`HEAD` and `SELECT`-equivalent calls (Supabase REST `GET` with
   `limit=1`). Never `POST`/`PATCH`/`DELETE`/`PUT` against the target. Write vulnerabilities are **inferred only**
   (e.g. "RLS missing → a write would likely succeed"), never actually tested.
2. **Only the user's own URL, entered in the UI/chat.** Never follow a URL that came from third-party content.
3. **SSRF protection:** reject `localhost`, `127.0.0.1`, `169.254.169.254`, private ranges (10/8, 172.16/12,
   192.168/16), `file://`, and non-http(s) schemes. Validate and resolve the host before fetching.
4. **Timeout + size limit** on every fetch (e.g. 8s, max 5 MB per bundle).
5. **Rate limit** the endpoint via `src/utils/apiSecurity.ts`, stricter than normal routes (it is expensive and abusable).
6. **Never store discovered secrets in plaintext** — mask them in the report (`sk_live_****1234`).

## Existing code to reuse

- **Report:** `packages/scanner-core/src/shipGate.ts` → `buildShipGateReport(findings, options)` and the
  `ShipGateReport` type. Wrap runtime findings as `ScannerFinding[]` and pass them in — you get the same Ship
  Score/verdict pipeline.
- **Finding type:** `ScannerFinding` (`ruleId`, `severity`, `message`, `suggestion?`, `file?`, `line?`,
  and now `confidence?` from Phase 0). In the web app import it as `WebFinding` from `src/utils/browserScanner.ts`.
- **Proxy pattern:** `apps/web/src/app/api/github/public-scan/route.ts` shows how to fetch remote content safely
  with `zod` validation and classified errors. Keep the new endpoint in the same style.
- **API security:** `src/utils/apiSecurity.ts` (zod middleware + rate limit).
- **UI panel:** `apps/web/src/app/_components/ship-gate/ShipGatePanel.tsx` already renders a `ShipGateReport`.
  Render the runtime report with the same component (design stays identical).

## New `ruleId`s (all runtime-prefixed; set `confidence` honestly)

| ruleId                                | severity | confidence | Detection (runtime)                                                                                           |
| ------------------------------------- | -------- | ---------- | ------------------------------------------------------------------------------------------------------------- |
| `runtime-supabase-rls-open`           | error    | high       | Supabase REST `GET .../rest/v1/<table>?select=*&limit=1` with the anon key returns rows for a sensitive table |
| `runtime-secret-in-bundle`            | error    | high       | The downloaded JS bundle matches `sk_live`, `sk_test`, `AKIA`, `AIzaSy`, or a service_role JWT pattern        |
| `runtime-missing-security-headers`    | warning  | high       | Missing `Strict-Transport-Security`, `X-Content-Type-Options`, or `Content-Security-Policy`                   |
| `runtime-supabase-anon-write-implied` | warning  | medium     | An RLS-open table implies write risk (inferred, NO real write attempted)                                      |

> Keep runtime rules separate from static ones (the `runtime-` prefix) so the report can distinguish finding origin.

## Tasks (in this order)

1. **SSRF guard util** — new `apps/web/src/utils/urlSafety.ts`:
   - `assertScannableUrl(raw: string): URL` — throws a typed error for non-http(s), private/loopback/link-local
     hosts, and malformed URLs. Pure and fully unit-testable (no network).
2. **Runtime scanner module** — new `apps/web/src/utils/runtimeScanner.ts`:
   - `scanLiveUrl(url: string): Promise<WebFinding[]>` — orchestrator.
   - Sub-functions, each pure where possible so they test without network:
     - `scanBundleForSecrets(bundleText: string): WebFinding[]`
     - `checkSecurityHeaders(headers: Headers): WebFinding[]`
     - `probeSupabaseRls(supabaseUrl: string, anonKey: string): Promise<WebFinding[]>` (read-only GET)
   - The orchestrator fetches the HTML, discovers script bundle URLs and the Supabase URL/anon key (commonly inlined
     in the client), then runs the sub-checks. Enforce timeout + size limits on every fetch.
3. **API endpoint** — new `apps/web/src/app/api/scan-url/route.ts` (`POST { url }`):
   - `zod`-validate the body, call `assertScannableUrl`, apply the rate limit.
   - Call `scanLiveUrl`, build the report via `buildShipGateReport`, return `{ report, findings }`.
4. **Landing UI** — a "Scan a deployed URL" section under the hero (reuse existing styles/components):
   - Input + button → calls `/api/scan-url` → renders `ShipGatePanel`.
   - No sign-up required, but **gate the full findings list behind sign-in** (show verdict + counts free) — this is
     the acquisition hook.
5. **Dashboard UI** — add URL scan as an input next to the existing public-repo scan (reuse the panel).
6. **Tests** (below).

## New / changed files

```
apps/web/src/utils/urlSafety.ts                 (new)
apps/web/src/utils/urlSafety.test.ts            (new)
apps/web/src/utils/runtimeScanner.ts            (new)
apps/web/src/utils/runtimeScanner.test.ts       (new)
apps/web/src/app/api/scan-url/route.ts          (new)
apps/web/src/app/api/scan-url/route.test.ts     (new)
apps/web/src/app/_components/home/HomeClient.tsx           (change — URL scan section)
apps/web/src/app/dashboard/_components/...                 (change — URL scan input)
```

## Acceptance criteria

- [ ] `POST /api/scan-url` with a valid public URL returns `{ report, findings }` where `report` is a `ShipGateReport`.
- [ ] The endpoint **rejects** `localhost`, private IPs, non-http(s), and malformed URLs with 4xx (SSRF guard tested).
- [ ] `scanBundleForSecrets('...sk_live_abc123...')` returns a `runtime-secret-in-bundle` finding with the value
      **masked** in the message.
- [ ] When an anon `GET` returns rows, `probeSupabaseRls` yields `runtime-supabase-rls-open` (error, high) →
      verdict `NOT READY TO SHIP`.
- [ ] No probe ever issues `POST/PATCH/DELETE/PUT` (verified by asserting the methods seen by a mocked `fetch`).
- [ ] Every fetch enforces the timeout and size limit.
- [ ] The landing section works logged-out, and the full findings list is gated behind sign-in.
- [ ] The report renders via the existing `ShipGatePanel` (no new report component, no design change).

## Tests

- **Unit (`urlSafety.test.ts`):** accept valid public URLs; reject loopback, private ranges, link-local, non-http(s), malformed.
- **Unit (`runtimeScanner.test.ts`):** `scanBundleForSecrets` (masking, multiple patterns), `checkSecurityHeaders`
  (each header), and `probeSupabaseRls` with a mocked read-only fetch.
- **Integration (`route.test.ts`):** mock `fetch`; assert response shape, SSRF rejections, rate limiting, and
  **assert the mocked fetch never received a mutating HTTP method**.
- **E2E (optional if time remains):** mock `/api/scan-url` via `page.route`, paste a test URL, assert the verdict
  renders. Follow the pattern in `tests/e2e/dashboard-full-suite.spec.ts`.

## How to verify

```bash
# from apps/web
npx tsc --noEmit && npm run lint
npm run test -- urlSafety
npm run test -- runtimeScanner
npm run test -- scan-url
```
