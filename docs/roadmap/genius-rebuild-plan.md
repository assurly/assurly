# Assurly — Genius Rebuild: Cursor Execution Handoff

> **Audience:** Cursor (the AI coding agent that will continue this rebuild).
> **Purpose:** A self-contained, senior-level execution spec for **all remaining work** (Phases 5–8).
> **Companion:** The strategy/rationale lives in [`10-genius-rebuild-master-plan.md`](./10-genius-rebuild-master-plan.md).
> Read that once for the "why"; this file is the "what and how".
>
> **Owner:** Tibor Kútik · **Handoff date:** 2026-07-13 · **Last updated:** 2026-07-16 (Phase 4 landed)
>
> **Golden rule:** Phases **0, 1, 2, 3 and 4** are **already built and tested** — do **not** rebuild them.
> Start at **Phase 5**. Read Sections 1–3 first (current state + conventions + gotchas); they will save
> you hours and stop you from breaking working code.
>
> **Verification status (read this before claiming a phase is done):** Phases 0–2 are browser-verified.
> Phases 3 and 4 are **code-complete and safety-proven but NOT browser-verified** — see the Master
> Tracker in the companion file for exactly what is open and why. They are listed in §1 because you must
> **build on** them, not because their DoD is closed. Do not mark them verified on their behalf.

---

## 1. What is already DONE (do not rebuild — this is your foundation)

Phases 0–4 are implemented and tested (**767 tests green, 107 files; `tsc --noEmit` clean**). Phases 0–2
are additionally browser-verified; Phases 3–4 are not yet (see the note in the header). The following
exists and works. **Build on it; do not recreate or "improve" it unless a later phase explicitly says so.**

Fast orientation — the four things Phase 5 leans on hardest:

| You need                                   | It already exists at                                                                                 |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| The verdict per app                        | `utils/shipGate.ts` (`resolveVerdict*`), `targets` table, `GET /api/targets`                         |
| A live proof-probe (ownership-gated)       | `utils/runtimeScanner.ts` → `scanLiveUrlWithEvidence({ activeProbe })` + `utils/probes/*`            |
| The pass/fail authority for active probing | `utils/ownership/gate.ts` → `isActiveProbeAllowed` — **the single gate; never duplicate it**         |
| The fix pipeline                           | `utils/githubAutoFix.ts`, `utils/githubFixPipeline.ts`, `POST /api/github/fix`, `api/github/webhook` |

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
- `probe_evidence` **now exists** (created in Phase 2, applied to prod 2026-07-14 — see §1.6).
  `fix_outcome` still does **not** exist: **you create it in Phase 5** (§5).

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

### 1.7 Ownership verification (Phase 3 — code-complete, NOT browser-verified)

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

### 1.8 AI red-team planner + Layer 2 (Phase 4 — code-complete & safety-proven, moat criterion OPEN)

- **`utils/probes/*` — the whitelist + deterministic executor. This is the security model; respect it.**
  - `PROBE_PRIMITIVE_NAMES` (currently just `supabase_rls_table_read`) — **the LLM selects a primitive
    name + zod-validated params; it never emits a raw request.** Adding a primitive = a code change here.
  - `executor.ts` — `sanitizeProbePlan` drops unknown primitives/invalid params; the executor re-validates,
    enforces `PROBE_MAX_STEPS = 12` / `PROBE_MAX_DURATION_MS = 30_000`, and **fails closed** (a
    `UrlSafetyError` aborts the whole plan). **Hard rails live in code, never in the prompt.**
  - Host + anon key come from the **execution context** (scanner-extracted), never from LLM params.
- `utils/ai/redTeamPlanner.ts` — `MODELS.fast`; snippets wrapped in `asUntrustedData`; **deterministic
  fallback** on any AI failure so Layer 1 stays reproducible. `buildDeterministicProbePlan` unions the 9
  default tables with `.from('…')` regex hits (`extractHeuristicTableNames`), capped at 12.
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
- **Known gap (do not paper over):** the moat criterion — "the planner probes tables it was not hardcoded
  to know" — is **not demonstrated**, and the deterministic fallback already probes regex-found tables, so
  the AI's real edge is narrower than the criterion implies. See the Master Tracker's Phase 4 design note.

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

## 5. REMAINING WORK — Phase 5

### Phase 5 — Verified-Fix Loop + dataset (do this next)

**Goal:** Close the loop — found → fix → deploy → **automatic re-probe → "VERIFIED FIXED"** — and record
every outcome so the corpus starts accumulating.

**Why this phase matters more than it looks:** everything before it proves a _problem_. This is the first
phase that proves **we solved it** — the emotional payoff the subscription is sold on. And every row it
writes is a row of the moat: the master plan's §0 thesis puts the exit asset in the **corpus** (how
AI-built apps fail and which fixes actually closed them), not in the scanner or the planner.

**Context you already have — you are connecting existing parts, not building new machinery:**

- **The probe** — `scanLiveUrlWithEvidence(url, fetch, lookup, { activeProbe })` in `runtimeScanner.ts`
  (§1.8). A re-probe is _calling this again and diffing_. Do **not** write a second probe path.
- **The gate** — `isActiveProbeAllowed` (§1.7). **A re-probe IS an active probe** and must consult the
  same single authority: `repo` passes implicitly, `url` needs `ownership_verified`.
- **The fix pipeline** — `utils/githubAutoFix.ts` / `utils/githubFixPipeline.ts`, `POST /api/github/fix`,
  and `api/github/webhook/route.ts` (already verifies signatures and runs `scanRegression` /
  `notifyIfRegressionBlockers`). The fix PR already knows the rule id it addresses — that is your join key.
- **The target** — `dbAdapter.getTargetById(id)` / `getTargetByIdentifier(...)` maps an event back to the
  guarded app. **Resolve the target from your own DB — never from a webhook payload** (see risks).
- **Evidence** — `insertProbeEvidence` / `getProbeEvidenceForScan` already persist redacted proof (§1.6).

**Deliverables**

1. **`fix_outcome` table** — migration `apps/web/supabase/migrations/<timestamp>_fix_outcome.sql`,
   org-scoped RLS (copy the shape from `20260714000000_probe_evidence.sql`, §2.7):

   ```sql
   create table if not exists public.fix_outcome (
     id uuid primary key default gen_random_uuid(),
     organization_id uuid not null references public.organizations(id) on delete cascade,
     target_id uuid references public.targets(id) on delete cascade,
     scan_id uuid references public.scans(id) on delete set null,
     finding_rule_id text not null,
     generator_fingerprint text,
     fix_strategy text,
     outcome text not null check (outcome in ('verified_fixed','still_open','regressed')),
     pr_url text,
     created_at timestamptz not null default timezone('utc', now())
   );
   -- + enable RLS, member policies, grants, index on (organization_id), (target_id, finding_rule_id)
   ```

   **Apply only with the owner's explicit approval (§3.2) — there is no local DB; this is production.**

2. **`apps/web/src/utils/verifiedFix.ts`** — the pure decision logic, unit-testable with no HTTP:
   - `resolveFixOutcome(before, after, ruleId)` → `'verified_fixed'` (present before, gone after) /
     `'still_open'` (present in both) / `'regressed'` (absent before, present after).
   - Keep re-probe I/O **out** of this file so classification is testable in isolation.

3. **Deploy signal → re-probe** — `apps/web/src/app/api/vercel/webhook/route.ts`. **Mirror
   `api/github/webhook/route.ts` exactly; do not invent a new scheme:**
   - `secureRoute` with `auth: 'none'`, `bodyMode: 'raw'` (you need the exact bytes to verify),
     `maxBodyBytes`, `rateLimit: RATE_LIMITS.webhook`.
   - **Verify the signature** against the Vercel secret and throw `ApiError(401, 'invalid_signature', …)`
     on failure — an unauthenticated endpoint that triggers probes is an abuse vector.
   - **Idempotency:** a webhook can fire more than once per deploy. Key on the deploy id; never write
     duplicate `fix_outcome` rows.
   - On a verified deploy for a known target → re-probe (through the gate) → classify → write the row.

4. **`POST /api/targets/[id]/reprobe`** — on-demand re-probe. `secureRoute`, auth required, `csrf: true`,
   `rateLimit: RATE_LIMITS.sensitive`. **Must call `isActiveProbeAllowed` and fail closed**, exactly as
   `scan-url/route.ts` does — a re-probe endpoint that skips the gate re-opens everything Phase 3 closed.

5. **FE — the payoff.** A "**VERIFIED FIXED**" state on the finding plus a timeline ("found 14:03 → fixed
   by PR #12 → verified closed 14:40"). Reuse the design tokens and the `DashboardToast` /
   `announcePrCreated` pattern for the "we just verified your fix" moment (§3.6).

6. **Corpus aggregate (internal).** A rollup over `(generator_fingerprint, finding_rule_id, fix_strategy,
outcome)` — "Lovable+Supabase → RLS off in X%, fix Y closes it Z%". **Patterns only, never customer
   data** (§2.8). This is the exit asset; treat its privacy properties as a product requirement.

**Tests (part of the deliverable, not a follow-up)**

- `verifiedFix.test.ts` — every branch of `resolveFixOutcome`, including `regressed`.
- Webhook route: valid signature → re-probe runs; **invalid/absent signature → 401 and NO probe**;
  duplicate delivery → exactly one row.
- `reprobe` route: a **security test** proving the ownership gate holds — an unverified `url` target gets
  no active pull here either. Mirror `api/scan-url/ownershipGate.security.test.ts`, and assert the
  _side effect_ (zero probe requests), not just a response field.

**Acceptance criteria**

- Fixing an RLS finding via an Assurly PR on an owned app flips it to **VERIFIED FIXED** after deploy,
  with a timestamped trail — **verified in a browser**.
- A `fix_outcome` row is written per resolved finding (verify the row in the DB).
- A re-probe is impossible on an unverified `url` target (security test).

**Risks / do-not:**

- **Never probe a target named in a webhook payload.** The payload is untrusted input; resolve the target
  from your own DB by deploy/repo identity. Otherwise the webhook becomes an open probe-anything endpoint.
- Deploy signals are unreliable across hosts — fall back to a scheduled re-probe rather than blocking the
  loop on Vercel being correct.
- Never write customer data into the corpus — aggregate patterns only.
- Keep the gate authoritative: no new active path may exist that does not consult `isActiveProbeAllowed`.

---

## 6. REMAINING WORK — Phases 6–8 (senior specs)

Each phase still ends with the full Definition of Done (§4). Phase 5 above is the most detailed because
it is next; the specs below are precise but expect you to apply the same rigor and the conventions in §2.

> **Phases 3, 4 and 5 are no longer specified here.** Phase 3 (Ownership) and Phase 4 (AI red-team planner
>
> - Layer 2) are **built** — their shipped shape is documented in **§1.7** and **§1.8**, which is what you
>   build on. Phase 5's spec moved to **§5** because it is next. Do not re-implement any of them.

### Phase 6 — Continuous Guardian + Badge growth loop (subscription value + distribution)

**Goal:** Turn one-shot scans into an always-on guardian, and make the badge a growth engine.

**Deliverables**

- **Scheduled + event-driven re-probe** (daily baseline + on every deploy/PR). Productize regression
  alerts ("Your app was safe yesterday; this morning's edit re-exposed `users`") on top of the existing
  `scanRegression` / `notifyIfRegressionBlockers`. Alert via email (existing Resend) + optional
  Slack/Discord webhook; per-target alert prefs (`AlertPreferences.tsx`).
- **Badge as a first-class embeddable** — promote `GET /api/badge/[token]` to a polished "Verified by
  Assurly · Ship Score N/100" that founders show their own customers. Turn `report/[token]` into a
  polished public **trust page** (this is where a `GET /api/targets/[id]` public projection may finally
  be worth building). Every badge links back = growth loop.
- **FE**: "Guardian" state on the verdict card (live monitoring status + last check).

**Acceptance:** a regression on an owned app fires an alert within the monitoring window; the badge
renders the live score and links to a shareable trust page — verified in a browser.

**Do-not:** alert only on new blockers/regressions (avoid alert fatigue).

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

1. ~~**Phase 2** (proof-first + consequences + AI client)~~ — **done & browser-verified** (§1.6).
2. ~~**Phase 3** (ownership)~~ — **built** (§1.7); browser verification still open.
3. ~~**Phase 4** (AI red-team + deep review)~~ — **built & safety-proven** (§1.8); browser verification and
   the moat criterion still open.
4. **Phase 5** (verified-fix loop + dataset) — **next; spec in §5.**
5. **Phase 6** (continuous guardian + badge).
6. **Phase 7** (MCP gate + OEM).
7. **Phase 8** (pricing + exit).

Do not reorder without updating `10-genius-rebuild-master-plan.md` first.

**Open items carried into Phase 5 — do not silently inherit them as "done":** Phases 3 and 4 are not
browser-verified, and Phase 4's moat criterion ("the planner probes tables it was not hardcoded to know")
is unproven — the deterministic fallback already probes regex-found tables, so the AI's edge is narrower
than that criterion implies. Both are recorded in the Master Tracker. An active probe needs an origin
whose **root** the owner controls (§1.7), which is why this has not been verified against a synthetic
target: a page authored so the LLM infers the table name proves the mechanism can fire, not that it fires
on real AI-built apps. Verify against a real app when one is available.

**Before you start each phase:** re-read §2 (conventions) and §3 (gotchas). **Before you finish each
phase:** run the full Definition of Done (§4), get owner approval for any prod migration, browser-verify,
and update the Master Tracker.

Build like a senior: root-cause empirically (read the real code, check real logs, verify against
reality — don't trust assumptions), keep the suite green throughout, and cut anything that dilutes the
proof-first verdict.
