# Assurly — Genius Rebuild: Cursor Execution Handoff

> **Audience:** Cursor (the AI coding agent that will continue this rebuild).
> **Purpose:** A self-contained, senior-level execution spec for **all remaining work** (Phases 6–8).
> **Companion:** The strategy/rationale lives in [`10-genius-rebuild-master-plan.md`](./10-genius-rebuild-master-plan.md).
> Read that once for the "why"; this file is the "what and how".
>
> **Owner:** Tibor Kútik · **Handoff date:** 2026-07-13 · **Last updated:** 2026-07-17 (Phase 5 landed)
>
> **Golden rule:** Phases **0 through 5** are **already built, tested, and browser-verified** — do **not**
> rebuild them. Start at **Phase 6**. Read Sections 1–3 first (current state + conventions + gotchas);
> they will save you hours and stop you from breaking working code.
>
> **Verification status (read this before claiming a phase is done):** Phases 0–5 are all browser-verified
> end-to-end (2026-07-17: ownership → active probe → verified-fix loop proven live against a controlled
> owned target; the `fix_outcome` migration is applied to prod). Phase 4's AI red-team planner now
> genuinely discovers app-specific tables (moat criterion resolved). See the Master Tracker in the
> companion file for the shipped shape of each. §1 documents what you **build on**.

---

## 1. What is already DONE (do not rebuild — this is your foundation)

Phases 0–5 are implemented, tested (**822 tests green, 113 files; `tsc --noEmit` clean**), and
browser-verified end-to-end. The following exists and works. **Build on it; do not recreate or "improve"
it unless a later phase explicitly says so.**

Fast orientation — the things Phase 6 leans on hardest:

| You need                     | It already exists at                                                                               |
| ---------------------------- | -------------------------------------------------------------------------------------------------- |
| The verdict per app          | `utils/shipGate.ts` (`resolveVerdict*`), `targets` table, `GET /api/targets`                       |
| A re-probe (ownership-gated) | `utils/reprobe.ts` → `reprobeTargetAndRecord` (§1.9) — **never write a second probe path**         |
| The gate for active probing  | `utils/ownership/gate.ts` → `isActiveProbeAllowed` — **the single gate; never route around it**    |
| Regression detect + email    | `utils/scanRegression.ts` (`detectNewBlockers`), `utils/notify.ts` (`sendRegressionAlert`, Resend) |
| Badge + public report        | `GET /api/badge/[token]` (SVG), `report/[token]/page.tsx` + `GET /api/reports/[token]`             |

### 1.1 Scan reliability & performance (done)

- **`POST /api/scans` persistence is fixed.** `dbAdapter.saveScan` normalises the `scan_findings`
  insert to a **uniform key set** (PostgREST rejects a bulk insert whose objects have different keys —
  error `PGRST102`). The prod DB was also two migrations behind; those are applied.
- **Batch file fetching for scans.** There is a shared helper
  `fetchGitHubFilesBatch(token, fullName, paths, ref, { concurrency, maxBytes })` in
  `apps/web/src/utils/githubApp.ts` (bounded concurrency; one unreadable file returns `null`, never
  fails the batch). Both scan proxies expose a **batch `POST`**:
  - `POST /api/github/public-scan` — `{ repo, branch?, paths[] }` (public repos, `csrf: true`, optional auth).
  - `POST /api/github/proxy` — `{ repoId, branch?, paths[] }` (installation repos, `csrf: true`, auth required).
  - The client (`DashboardClient.tsx` → `prefetchContents`) sends **one batch request** for either
    path, with a serial per-file fallback only for resilience.
- **`secureRoute` now logs the real error message/stack for unexpected 5xx** (server-side only, never
  returned to the client) in `apps/web/src/utils/apiSecurity.ts`. Use this when debugging: check the
  dev-server logs for `errorMessage` / `errorStack`.

### 1.2 Static analysis is FROZEN (do not add rules)

The 14 static rules in `packages/scanner-core` are a stable free funnel — **not** the differentiator.
Do **not** add net-new rules unless a change measurably raises trust/precision of the existing gate.
Depth comes from the runtime probe and the AI layer (Phases 2 & 4), not more rules. This is noted in
`packages/scanner-core/README.md`.

### 1.3 Generator fingerprinting (done — the moat's first sensor)

`apps/web/src/utils/generatorFingerprint.ts`:

- `detectGeneratorFingerprint({ filePaths?, packageJson?, pageText? }): GeneratorFingerprint`
  — infers `'lovable' | 'v0' | 'bolt' | 'cursor' | 'replit' | 'unknown'` from repo tree + package.json +
  live bundle. Conservative (returns `'unknown'` unless a signal is defensible).
- Exports `GENERATOR_FINGERPRINTS` (const tuple, includes `'unknown'` — use it to back zod enums) and
  `KNOWN_GENERATOR_FINGERPRINTS`.
- Already wired: the dashboard scan computes it and passes it to `saveScan`; it is persisted on the target.

### 1.4 The Verdict Object (Phase 1 — done)

This is the **core data model** everything else renders from.

- **`targets` table** — migration `apps/web/supabase/migrations/20260713000000_targets.sql`, applied to
  prod, org-scoped RLS. Columns: `id, organization_id, kind('repo'|'url'), identifier, display_name,
repository_id, generator_fingerprint, ownership_verified, ownership_method, current_verdict
('ready'|'review'|'blocked'|'unknown'), current_ship_score, verdict_evidence(jsonb), last_checked_at,
badge_token, created_at, updated_at`. Unique on `(organization_id, kind, identifier)`.
  **The ownership columns already exist but are NOT enforced yet — that is Phase 3.**
- **`dbAdapter`** (`apps/web/src/utils/dbAdapter.ts`): `Target` type + `getTargets(orgId)`,
  `getTargetById(id)`, `upsertTarget(input)` (partial upsert via PostgREST `merge-duplicates`, so
  unspecified columns are preserved on conflict).
- **`shipGate.ts`** (`apps/web/src/utils/shipGate.ts`): `resolveVerdict(report)` and
  `resolveVerdictFromScanFindings(findings, options?)` return a compact `Verdict` (status, shipScore,
  headline, counts, and the single dominant `topIssue`). **Reuse these everywhere you need a verdict.**
- **Scan-save syncs the target.** `POST /api/scans` calls `syncRepoTargetFromScan` (best-effort — a
  sync failure never fails the save) which recomputes the verdict from the persisted findings and
  upserts the repo's target (verdict + fingerprint + freshness). The route body accepts
  `generatorFingerprint` and `scannedFileCount`.
- **`GET /api/targets`** (`apps/web/src/app/api/targets/route.ts`) returns one `TargetCard` per app
  (synced target row is authoritative; otherwise derived from the latest scan so existing repos show
  state with no backfill), sorted most-urgent first (blocked → review → ready → unknown).
- **Frontend:** `VerdictCard.tsx` + `VerdictCardsSection.tsx` are the **primary dashboard surface**
  ("Your apps", one verdict per app with score + top issue + freshness + builder chip). The old repo
  list / scan flow is demoted below them; clicking a card opens the existing repo detail. Cards
  re-fetch when a scan finishes (`verdictRefreshKey`).
- **`clientApi`** (`apps/web/src/utils/clientApi.ts`): `clientApi.targets()` + `TargetCard` type;
  `findings` schema coerces PostgREST `null` optionals to `undefined` (see gotcha §3.4).

### 1.5 Deferred from Phase 1 (small, optional — pick up only if a later phase needs it)

- `GET /api/targets/[id]` was **not** built. The existing repo/scan detail already serves as the
  verdict detail. Build it only when a phase needs a stable per-target detail endpoint (e.g. a public
  trust page in Phase 6).
- `probe_evidence` (Phase 2) and `fix_outcome` (Phase 5) **both exist and are applied to prod**
  (see §1.6 and §1.9). `GET /api/targets/[id]` is still **not** built — Phase 6 is the phase most likely
  to need it (a public trust-page projection); build it there if you do.

### 1.6 Proof-first experience + the AI client (Phase 2 — done, browser-verified)

- **`utils/ai/claudeClient.ts` — the ONE AI abstraction. Reuse it; never add a second.**
  `callClaude({ model, system, messages, maxTokens })`, plus:
  - `MODELS = { fast, balanced, deep }` — the **only** place model ids live. Never inline a model string.
  - `asUntrustedData(text)` — wraps scanned content as data, not instructions (prompt-injection defense).
    **Every** piece of scanned content you pass to an LLM goes through this. Non-negotiable (§2.6).
  - `assertAiBudget(orgId)` / `recordAiUsage(orgId, tokens)` — per-org cost cap. Reuse; do not re-invent.
  - Content-hash cache (`clearAiCache()` in tests), 20s timeout, one retry on 5xx.
  - Throws `AiUnavailableError` when `ANTHROPIC_API_KEY` is unset — callers **must** degrade, never fail.
- **Consequence translation:** `utils/consequenceMap.ts` (pure, client-safe, curated sentence per rule id)
  - `utils/consequenceTranslator.ts` (AI fallback → curated → raw `message`; never on the critical path).
- **`probe_evidence` table** — migration `20260714000000_probe_evidence.sql`, org-scoped RLS, **applied to
  prod**. `dbAdapter.insertProbeEvidence(rows)` / `getProbeEvidenceForScan(scanId)`.
- **Redaction lives in the scanner.** `runtimeScanner` returns already-redacted `ProbeEvidence`
  (`redactCell`); raw PII never leaves it. RLS scale is proven with `limit=1` + `Prefer: count=exact` —
  we show _"we read 500 rows"_ **without** exfiltrating 500 rows. Keep that property in anything new.
- **FE:** `ProofEvidence.tsx` (proof headline) on the landing hero + dashboard URL scan;
  `ScanFindingCard` is consequence-first with the technical detail collapsed.

### 1.7 Ownership verification (Phase 3 — done, browser-verified)

- **`utils/ownership/gate.ts` → `isActiveProbeAllowed({ kind, ownershipVerified })` is the single
  server-side authority** for the passive/active boundary. `repo` = implicitly owned (GitHub App);
  `url` = requires `ownership_verified === true`. **Every probe entrypoint must consult this one
  function** — never re-implement, never route around it.
- `normalizeUrlIdentifier(url)` pins a `url` target to its **origin**. Ownership is therefore
  **origin-scoped**: `verifyOwnership` is called with the origin, so `meta_tag` reads the origin **root**
  and `file` reads `/.well-known/assurly-verify.txt` at the root. This is deliberate — it stops someone
  verifying a shared host (e.g. a gist) by uploading one file and then probing everyone else on it.
- `utils/ownership/verify.ts` — `meta_tag` / `dns_txt` / `file`, all via SSRF-safe GET, 1 MiB body cap.
  `utils/ownership/token.ts` — `deriveOwnershipToken(org + target + identifier)` (not transferable).
- `GET`/`POST /api/targets/[id]/verify-ownership` + `dbAdapter.setTargetOwnership`; FE `OwnershipVerify.tsx`.
- **Consequence for testing against real sites:** an active probe now needs an origin whose **root** the
  owner controls. Local targets are impossible by design — the SSRF guard blocks `localhost`/private IPs
  on every hop.

### 1.8 AI red-team planner + Layer 2 (Phase 4 — done, browser-verified; moat criterion resolved)

- **`utils/probes/*` — the whitelist + deterministic executor. This is the security model; respect it.**
  - `PROBE_PRIMITIVE_NAMES` (currently just `supabase_rls_table_read`) — **the LLM selects a primitive
    name + zod-validated params; it never emits a raw request.** Adding a primitive = a code change here.
  - `executor.ts` — `sanitizeProbePlan` drops unknown primitives/invalid params; the executor re-validates,
    enforces `PROBE_MAX_STEPS = 12` / `PROBE_MAX_DURATION_MS = 30_000`, and **fails closed** (a
    `UrlSafetyError` aborts the whole plan). **Hard rails live in code, never in the prompt.**
  - Host + anon key come from the **execution context** (scanner-extracted), never from LLM params.
- `utils/ai/redTeamPlanner.ts` — `MODELS.fast`; snippets wrapped in `asUntrustedData`; **deterministic
  fallback** on any AI failure so Layer 1 stays reproducible. The prompt instructs the model to **infer
  app-specific tables from the product described on the page** (this is what closed the moat criterion);
  `buildDeterministicProbePlan` probes heuristic `.from('…')` tables **first**, then fills from a curated
  18-table default list (`DEFAULT_SENSITIVE_SUPABASE_TABLES`), capped at `PROBE_MAX_STEPS`.
- `utils/ai/deepReview.ts` (`MODELS.deep`, paid only — `billing_plan === 'pro'`) and
  `utils/ai/contextualFix.ts`. Both return null / curated on failure — **AI is never on the critical path.**
- **Wiring:** the planner + executor run **only** inside `runtimeScanner`'s `if (options.activeProbe)`
  branch; `scan-url/route.ts` sets that from `isActiveProbeAllowed` and **fails closed** on any target
  lookup failure. `planSource: 'ai' | 'deterministic'` is returned to the client.
- **Security tests you must not weaken:** `probes/executor.security.test.ts`,
  `api/scan-url/aiPlanner.security.test.ts`, `api/scan-url/ownershipGate.security.test.ts`. The last one
  asserts **zero Claude API calls for an unverified target** (a side-effect assertion, with a positive
  control) — because `planRedTeamProbes` deliberately does not re-check ownership, so the property is
  non-local and a refactor that hoists the planner out of the gate branch must fail loudly.
- **Moat criterion resolved (2026-07-17):** the planner now genuinely infers non-hardcoded tables — proven
  with a real AI call (a distinctive logistics page yielded `driver_payouts`, `route_optimizations`,
  `drivers`, `routes`, none in the wordlist). **Positioning note:** the planner is a _coverage engine_, not
  the moat — table-name inference is commoditizable. The durable moat is the **verified-fix corpus** that
  Phase 5 feeds (see §1.9 and the master plan §0). Do not over-invest in planner cleverness.

### 1.9 Verified-fix loop + dataset (Phase 5 — done, browser-verified end-to-end)

**This is the retention hook AND the start of the moat corpus — build Phase 6 directly on it.**

- **`fix_outcome` table** — migration `20260716000000_fix_outcome.sql`, org-scoped RLS, **applied to prod**.
  Records `(finding_rule_id, generator_fingerprint, fix_strategy, outcome ∈ {verified_fixed, still_open,
regressed}, pr_url, deploy_id, …)`. Also created `private.vercel_webhook_deliveries` + claim/finish RPCs
  for webhook idempotency. `dbAdapter`: `insertFixOutcomes` (ignore-duplicates), `getFixOutcomesForTarget`,
  `getFixOutcomeCorpus` (reads **pattern columns only**, never customer data).
- **`utils/verifiedFix.ts`** — pure, I/O-free classifier: `resolveFixOutcome(before, after, ruleId)` →
  verified_fixed / still_open / regressed, plus the corpus rollup. Unit-testable in isolation.
- **`utils/reprobe.ts`** — the I/O orchestrator: `reprobeTargetAndRecord` + `recordReprobeOutcomes`.
  **A re-probe IS an active probe** — it goes through `isActiveProbeAllowed` and fails closed; the scanner
  is injectable; outcomes are written **only on a state change** (no `still_open` spam). Reuse this for any
  re-probe you add in Phase 6 — do not write a second probe path.
- **`utils/vercelWebhook.ts` + `POST /api/vercel/webhook`** — HMAC-SHA1 verified; the target is resolved
  from **our own DB** by origin, **never** from the payload (an unauth webhook that probes a payload-named
  host is an abuse vector); claim-first idempotency on `deploy_id`. **Mirror this shape for any new webhook.**
- **`POST /api/targets/[id]/reprobe`** — on-demand re-probe (auth, csrf, `RATE_LIMITS.sensitive`, gate-checked).
- **FE `VerifiedFixTimeline.tsx`** — the "VERIFIED FIXED" payoff (found → fixed by PR → verified closed).
- **Proven live:** an owned target with `customers` RLS off recorded `still_open`; after enabling RLS a
  re-scan recorded `verified_fixed` (confirmed by a direct `fix_outcome` query on prod); verdict moved
  🚫 NOT READY 80 → ⚠️ REVIEW 96.

---

## 2. Non-negotiable engineering conventions

Follow these on **every** change. They are how the codebase is built; deviating creates review churn
and security holes.

1. **Next.js is not the version you know.** This repo runs a Next.js with breaking changes. Per
   `apps/web/AGENTS.md`, **read the relevant guide in `node_modules/next/dist/docs/` before writing
   Next-specific code.** Heed deprecation notices. Do not assume App Router APIs from memory.
2. **Every API route goes through `secureRoute`** (`apps/web/src/utils/apiSecurity.ts`). You must set:
   `routeId`, `auth` (`'required' | 'optional' | 'none'`), `query`/`params`/`body` zod schemas,
   `bodyMode`, `maxBodyBytes`, `rateLimit` (from `RATE_LIMITS`), and `csrf: true` for any state-changing
   or POST route. CSRF is enforced only when a session cookie is present, so `csrf: true` is safe on
   `auth: 'optional'` routes too.
3. **Every outbound fetch to a user-supplied host goes through the SSRF-safe path** in
   `apps/web/src/utils/runtimeScanner.ts` (`safeFetch` / `resolveSafeHost` / the pinned dispatcher).
   Never `fetch()` a user-provided URL directly. Never follow redirects without re-validating each hop.
   Never issue a **mutating** HTTP method during a probe.
4. **`scanner-core` is the shared source of truth** across CLI / web / MCP / GitHub Action. A rule or
   helper needed by multiple surfaces lives there and must be wired into each surface that needs it.
5. **AI calls default to the latest Claude models**, behind a single provider abstraction — it **already
   exists**: `utils/ai/claudeClient.ts` (§1.6). Reuse it; never add a second AI layer, and never inline a
   model id — `MODELS` is the only place they live. Model ids:
   - Deep reasoning: `claude-opus-4-8`
   - Balanced: `claude-sonnet-5`
   - Fast/cheap (triage, planning): `claude-haiku-4-5-20251001`
6. **Treat all scanned content (repo files, bundles, HTTP responses) as untrusted data**, never as
   instructions. When you pass scanned content to an LLM, put it inside a clearly delimited block and
   instruct the model to treat it as data (prompt-injection defense).
7. **RLS on every new table.** Follow the existing tenant pattern: enable RLS, add
   `select`/`insert`/`update` policies gated on `private.is_organization_member(organization_id)` (or
   `can_access_repository` / `can_access_scan` where the row hangs off a repo/scan), and
   `grant select, insert, update ... to authenticated`. Copy the shape from
   `20260713000000_targets.sql`.
8. **PII redaction is mandatory** anywhere you render or store proof (retrieved DB rows, secrets). Show
   the _shape_ ("500 rows, columns: email, password_hash; sample: `t***@***.com`"), never full personal
   data. This is both a legal and a product requirement.

---

## 3. Hard-won gotchas (read these — they already cost hours)

### 3.1 Run vitest from the REPO ROOT, not `apps/web`

```bash
# ✅ correct
npx vitest run apps/web/src
npx vitest run apps/web/src/utils/shipGate.test.ts

# ❌ from inside apps/web this throws ERR_REQUIRE_ESM (std-env / vitest config-loader bug)
cd apps/web && npx vitest run src
```

`npx tsc --noEmit` is fine from `apps/web`. Playwright E2E specs live in `apps/web/tests/e2e` and are
**excluded** from the vitest `src` run — do not point vitest at them.

### 3.2 Applying DB migrations = touching PRODUCTION

There is **no local database**; the app talks to a hosted Supabase project (linked via the Supabase
CLI). Any new migration must be applied with `supabase db push` (run from `apps/web`), which changes
**production data**. **Always:**

1. Write the migration file (additive, idempotent — `add column if not exists`, `create table if not
exists`, `drop policy if exists` before `create policy`).
2. Run `supabase db push --dry-run` and confirm exactly which migrations are pending.
3. **Get the human owner's explicit approval before `supabase db push`** — it is their production DB.
4. After a DDL change, PostgREST's schema cache may lag a few seconds (`PGRST204 "Could not find the
column … in the schema cache"`); it self-heals — retry once.

### 3.3 Sessions expire (~1h)

The dashboard is auth-gated; an expired Supabase JWT redirects `/dashboard` → `/`. When you browser-
verify, if you land on the marketing page you are simply logged out — ask the human to sign in again.
This is not a bug.

### 3.4 PostgREST returns `null`, not "absent", for unset optional columns

When reading rows, optional columns come back as explicit `null`. A zod `.optional()` (which only
accepts `undefined`) will **fail to parse**. Use the `nullToUndefined` pattern already in
`clientApi.ts` (`.nullable().optional().transform(v => v ?? undefined)`) for any new nullable column
you read on the client.

### 3.5 Route-test mocking pattern

Route unit tests mock `requireUser` from `../…/utils/auth` and pass a plain `db` object of `vi.fn()`s.
See `apps/web/src/app/api/targets/route.test.ts` and `…/api/github/proxy/route.test.ts` for the exact
shape (hoisted `mocks`, `vi.mock('../…/auth', …)`, per-method `db.<method>.mockResolvedValue(…)`).
Dashboard component tests that mount `DashboardClient` must mock **`clientApi.targets`** (return
`{ targets: [] }`) or the verdict section will hit a real fetch — see any
`apps/web/src/app/dashboard/*.interaction.test.tsx`.

### 3.6 `window.open` after `await` may be popup-blocked

Auto-opening a tab after an async request is unreliable (blockers). Always pair it with a reliable,
clickable link (see the "View pull request →" toast action already implemented in `DashboardToast` +
`announcePrCreated` in `DashboardClient.tsx`). Reuse that pattern for any "we just did X on GitHub".

---

## 4. Definition of Done (applies to every phase)

A phase is **done** only when **all** of these hold:

1. Deliverables implemented following §2 conventions.
2. **Unit/route tests written** for new logic; `npx vitest run apps/web/src` is **green**.
3. `npx tsc --noEmit` (from `apps/web`) is **clean** (ignore only the pre-existing note, if any, that
   was there before you started — there should be none).
4. **Browser-verified end-to-end** in the real app (not just tests) — the phase's acceptance criteria
   observed working. Ask the human to sign in when auth is needed.
5. New migrations applied to prod **with the owner's approval** (§3.2).
6. The **Master Tracker in `10-genius-rebuild-master-plan.md` is updated** (check the phase off with a
   one-line "what landed" note). Scope changes are recorded there first, then in code.
7. Commit in **small, logical commits** with conventional-commit messages. End each commit message with:
   `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Commit only when the work is green.

---

## 5. REMAINING WORK — Phase 6

### Phase 6 — Continuous Guardian + Badge growth loop (do this next)

**Goal:** Turn one-shot scans into an **always-on guardian** (the subscription value) and make the
**badge a distribution engine**. This is the phase that turns "I scanned once" into "I pay every month
because Assurly watches my app", and turns every protected app into marketing.

**Why now, and the golden constraint:** the verdict (P1), proof (P2), ownership (P3), AI depth (P4), and
the verified-fix loop (P5) all exist and are browser-verified. **Nothing here is new probing machinery** —
you are _scheduling_ the probe you already have, _alerting_ on the regressions you already detect, and
_surfacing_ the badge/report you already render. Do NOT rebuild probing, the ownership gate, alerting, or
the verdict object.

**Context you already have — connect these, do not recreate:**

- **Re-probe** — `utils/reprobe.ts` → `reprobeTargetAndRecord` / `recordReprobeOutcomes` (Phase 5, §1.9).
  A scheduled or deploy-triggered guardian check IS a re-probe **through the ownership gate**. Reuse it
  verbatim — never write a second probe path, never route around `isActiveProbeAllowed`.
- **Regression detection** — `utils/scanRegression.ts`: `detectRegressions`, `detectNewBlockers`,
  `notifyIfRegressionBlockers(db, repository, prev, current)`. Wired today only into `api/github/webhook`
  for repo scans — you extend the same idea to `url` targets.
- **Email** — `utils/notify.ts`: `sendRegressionAlert(recipients, { name }, newBlockers)` via Resend;
  recipients from `db.getOrganizationAdminEmails(orgId)`. Reuse; add channels alongside, don't replace.
- **Badge + public report** — `GET /api/badge/[token]` already renders an SVG "Ship Score N/100"
  (`auth: 'none'`, `buildShipGateFromScanFindings`); `report/[token]/page.tsx` + `GET /api/reports/[token]`.
- **Deploy signal** — `POST /api/vercel/webhook` (Phase 5) already re-probes on deploy and records
  outcomes; Phase 6 adds the **alert** on top when a deploy introduces a new blocker.

**Deliverables**

1. **Scheduled guardian re-probe (daily baseline).**
   - Cron entrypoint via `apps/web/vercel.json` `crons` → a new `GET /api/cron/guardian`. It is
     unauthenticated by nature, so **verify a shared cron secret** (`CRON_SECRET` / the `Authorization`
     header) before doing any work; `secureRoute` `auth: 'none'`, `RATE_LIMITS.webhook`, and 401 on a bad
     secret.
   - For each monitored ownership-verified `url` target (and connected repos), run the existing re-probe
     (`reprobeTargetAndRecord`) **through `isActiveProbeAllowed`**. Bound concurrency and per-run wall time;
     one slow/failed target must never block or fail the batch.
   - Update the target's verdict + `last_checked_at` (the verdict object is already the store).

2. **Regression alerts for targets — productized and low-noise.**
   - On BOTH the scheduled run and the deploy webhook: diff new findings vs. the target's previous state and
     alert **only on NEW blockers / regressions** (reuse `detectNewBlockers`) — never on the steady state.
     Alert fatigue is the #1 failure mode; this is a hard product rule, not a preference.
   - Founder's language: _"Your app was safe yesterday; this morning's edit re-exposed `users`."_ Deliver via
     `sendRegressionAlert` (Resend) **plus an optional Slack/Discord incoming-webhook** per target.
   - **Per-target alert preferences** — a `target_alert_prefs` table (channel, webhook URL, enabled),
     org-scoped RLS (§2.7) via a new migration (prod push needs owner approval, §3.2) + FE
     `AlertPreferences.tsx`.

3. **Badge as a growth loop + public trust page.**
   - Promote `GET /api/badge/[token]` to a polished "Verified by Assurly · Ship Score N/100" founders embed
     on their own site; every badge links back to the trust page = the growth loop.
   - Turn `report/[token]` into a polished public **trust page** (verdict + redacted proof summary +
     "last checked" freshness + the badge). This is where a stable **`GET /api/targets/[id]` public
     projection** (deferred in Phase 1, §1.5) may finally be worth building — expose only safe public
     fields, **never raw evidence or PII**.

4. **FE "Guardian" state.**
   - On `VerdictCard`: a live monitoring status + "last checked" freshness + a regression indicator when the
     score dropped since the previous check.

**Tests (part of the deliverable, not a follow-up)**

- Cron route: valid secret runs the batch; **missing/invalid secret → 401 and NO probe**.
- Alert logic: new blocker → **exactly one** alert; unchanged findings → **zero** alerts (the fatigue rule);
  a newly-fixed finding → no alert. Mock `sendRegressionAlert`; assert call counts.
- Guardian re-probe honors the gate: an unverified `url` target gets **no active probe** — mirror the
  Phase 4/5 side-effect security tests (assert zero probe requests, not just a response field).
- Badge / trust projection exposes only whitelisted public fields (no evidence, no PII) — assert the shape.

**Acceptance criteria**

- A regression on an owned app (introduced between two guardian checks, or on a deploy) fires **exactly one**
  alert within the monitoring window — verified in a browser and a real inbox / webhook.
- The badge renders the **live** current score and links to a shareable trust page — verified in a browser.
- Steady state (no new blockers) produces **no** alerts.

**Risks / do-not:**

- **Alert fatigue** — only new blockers/regressions, never the steady state.
- No new probe path and nothing that skips `isActiveProbeAllowed` — the guardian must not become a way to
  probe unverified targets on a schedule.
- The public trust page / badge projection must never leak evidence rows or PII — public = shape only.
- The cron endpoint must reject any request without the shared secret before touching a single target.

---

## 6. REMAINING WORK — Phases 7–8 (senior specs)

Each phase still ends with the full Definition of Done (§4). Phase 6 above (§5) is the most detailed because
it is next; the specs below are precise but expect you to apply the same rigor and the conventions in §2.

> **Phases 3, 4, 5 and 6 are no longer specified here.** Phases 3–5 are **built** — their shipped shape is
> documented in **§1.7 / §1.8 / §1.9**, which is what you build on. Phase 6's spec is in **§5** because it is
> next. Do not re-implement any of them.

### Phase 7 — Agent-Native Distribution (MCP gate) + OEM

**Goal:** Be the ship-gate that **AI agents call themselves** before deploy, and the "security-checked"
layer **platforms embed**.

**Deliverables**

- **`packages/mcp-server`**: add an `assurly.verdict(url | repo)` tool returning a structured
  Ready/Blocked + top blocker + fix, callable pre-deploy by a coding agent. Position as "the standard
  ship-gate for AI agents."
- **Programmatic API + keys** for agent/OEM use, with plan-based rate limits.
- **OEM/B2B2C**: a white-label verdict + badge widget/API platforms (Lovable/Bolt/agencies) can surface
  to their own users.

**Acceptance:** a scripted MCP client gets a correct structured verdict pre-deploy; a working embeddable
"security-checked" widget backed by the badge/verdict.

### Phase 8 — Pricing, Business & Exit readiness

**Goal:** Align monetization with the new value; make the company legible to an acquirer.

**Deliverables**

- **Pricing realign** in `HomeClient.tsx` + Stripe products: Free = the scary proof-probe (viral top of
  funnel) + one guarded app; Paid (per-app) = continuous monitoring + AI deep review + auto-fix +
  verified badge; add an **OEM/platform tier** (usage/seat) for B2B2C. Revisit the current
  `$19 Guard / $49 Agency` framing.
- **Exit-readiness**: package the dataset story (AI-failure + verified-fix corpus), trust brand, and MCP
  distribution into a clean narrative + a metrics dashboard for a strategic buyer (Supabase / Vercel /
  builder).
- **Trust/compliance surface**: the public "security-checked" brand, a SOC2-lite trust page, clear
  data-handling/consent docs (leaning on Phase 3's ownership + privacy work).

**Acceptance:** new pricing live; OEM tier defined; corpus + distribution narrative documented.

---

## 7. Cross-cutting workstreams (run continuously, not a phase)

- **AI cost & safety:** the single provider abstraction from Phase 2 (`utils/ai/claudeClient.ts`), model
  routing, content-hash caching, per-org budget caps, timeouts, prompt-injection defense. Latest Claude
  models only.
- **Security & legal:** ownership gate enforced wherever active (from Phase 3); never a mutating probe;
  SSRF-safe fetch for every user host; PII redaction in all proof rendering/storage; consent + data
  handling docs.
- **Privacy-safe dataset:** capture patterns and outcomes, never customer data. Aggregate-only corpus.
- **Testing & verification:** keep `npx vitest run apps/web/src` green; add a **security test** for each
  new probe/AI path; **browser-verify every phase** end-to-end before sign-off; Playwright E2E for
  critical flows (`apps/web/tests/e2e`).
- **Observability:** structured logs already exist (`assurly-api`); add verdict/probe/AI-cost metrics.
- **Docs discipline:** keep the Master Tracker in `10-genius-rebuild-master-plan.md` current; write ADRs
  for the ownership model and the AI-layer architecture.

---

## 8. Execution order & final reminders

1. ~~**Phases 2–4**~~ (proof-first, ownership, AI red-team + deep review) — **done & browser-verified**
   (§1.6 / §1.7 / §1.8); Phase 4's moat criterion is resolved.
2. ~~**Phase 5**~~ (verified-fix loop + dataset) — **done & browser-verified end-to-end** (§1.9);
   `fix_outcome` migration applied to prod.
3. **Phase 6** (continuous guardian + badge growth loop) — **next; spec in §5.**
4. **Phase 7** (MCP gate + OEM).
5. **Phase 8** (pricing + exit).

Do not reorder without updating `10-genius-rebuild-master-plan.md` first.

**Carry into Phase 6 — do not silently inherit as "done":** two Phase-1 deferrals are still open and Phase 6
is the phase most likely to need them — `GET /api/targets/[id]` (a stable per-target endpoint for the public
trust page, §1.5) and per-target alert delivery beyond email. Neither is built. Also: the moat is the
**verified-fix corpus** (§0), not the planner — invest Phase-6 energy in monitoring/distribution, not in
more planner cleverness.

**Before you start each phase:** re-read §2 (conventions) and §3 (gotchas). **Before you finish each
phase:** run the full Definition of Done (§4), get owner approval for any prod migration, browser-verify,
and update the Master Tracker.

Build like a senior: root-cause empirically (read the real code, check real logs, verify against
reality — don't trust assumptions), keep the suite green throughout, and cut anything that dilutes the
proof-first verdict.
