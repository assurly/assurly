# Assurly — Genius Rebuild Master Plan

> **Status:** Active master plan. This is the single source of truth for the rebuild.
> Supersedes the emphasis of specs `00`–`06` (they remain valid as detail references,
> but ordering, focus, and the definition of "core" are now set by this document).
>
> **Owner:** Tibor Kútik · **Created:** 2026-07-13 · **Horizon:** 2026–2027
>
> **How to use this file:** We follow it phase by phase, top to bottom. Do not skip
> ahead. Every phase has a Definition of Done (DoD) and must be verified end-to-end in
> a real browser (not just tests) before the next phase starts. Check items off in the
> Master Tracker at the bottom as they land.

---

## 0. Why this plan exists (the one-paragraph thesis)

Assurly today is a **well-built scanner arranged as a scanner**. Its crown jewels — a
real runtime proof-of-exploit probe, an auto-fix PR pipeline, PR-level regression
monitoring, an MCP server, and a shareable badge — already exist in the codebase, but
they sit as secondary features while the **most commoditizable part (14 static rules)**
occupies the center. In 2026, a fixed rulebook is exactly what an LLM makes free.

This plan flips the center of gravity. We rebuild Assurly around **one persistent
"verdict object" per app** — _"Is my live app safe to ship right now? Yes / No — and
here is the proof"_ — and around **one AI-native loop**:

> **AI builds → Assurly breaks → AI fixes → Assurly verifies.**

The buyer is **not** a senior developer. It is a **non-technical founder who had their
SaaS built by AI** (Lovable / v0 / Bolt / Cursor), has paying users, and cannot read a
diff. We sell them **proof and sleep**, not a findings table. The defensible moat is a
**proprietary corpus of how AI-generated apps characteristically fail and which fixes
actually closed the hole, verified at runtime** — an asset that grows as AI writes more
code, and that a chat-with-your-repo tool structurally cannot produce.

---

## 1. North Star & positioning

**From:** "A static code analyzer for developers with a terminal."
**To:** "The proof-based trust layer for AI-built apps — for people who can't read code."

The single question the product answers, on one glance, always current:

> **"Can I ship my live app right now without leaking data or embarrassing myself?"**

Three audiences, in priority order:

1. **Vibe-coding founders** (primary buyer) — have a deployed URL and fear, not a repo and a CLI.
2. **AI coding agents** (Cursor / Claude Code / platform agents) — need a ship-gate step before deploy, called over MCP.
3. **Agencies & platforms (OEM/B2B2C)** — need a white-label "security-checked" verdict to hand to their own clients/users.

**Exit thesis:** become the default safety/trust layer of the vibe-coding stack, then be
acquired by a platform whose brand is at risk from insecure AI apps (**Supabase** — "Supabase
leak" headlines are _their_ reputational problem — Vercel, or a builder like Lovable/Bolt).
The acquirer buys **(a)** the AI-failure + verified-fix dataset, **(b)** the trust brand in
this segment, **(c)** distribution into AI builders via MCP.

---

## 2. Guiding principles (apply to every phase)

1. **Proof over opinion.** Wherever possible, show a real runtime consequence ("we pulled
   these rows from your live DB") instead of a static warning ("RLS may be missing").
2. **Verdict over report.** The product is one always-current answer per app, not a list
   of scans. Findings are evidence behind the verdict, not the headline.
3. **Consequences in money & reputation, not CVSS.** Every finding must render a plain
   sentence a non-engineer feels ("Anyone can read your customers' emails → GDPR fine + churn").
4. **Determinism for the gate, AI for the depth.** The pass/fail gate stays deterministic
   and reproducible (existing high-confidence blockers). AI adds a reasoning/red-team layer
   _on top_, never as the gate's source of truth.
5. **Safety & consent first.** Active probing only against apps the user provably owns.
   Never a mutating probe. Ownership verification is a hard gate, not an afterthought.
6. **Every scan feeds the moat.** Findings, generator fingerprint, and fix outcomes are
   captured (privacy-safe, aggregated) from day one, even before we monetize the corpus.
7. **Cut ruthlessly.** Anything that dilutes the "proof-first verdict" focus is frozen or
   deleted. A smaller, sharper product beats a broad, noisy one.
8. **Test + verify discipline.** No phase is "done" on green tests alone — each must be
   driven end-to-end in a real browser and shown to work. Keep the suite green throughout.

### Engineering guardrails (non-negotiable)

- **Next.js is not the one you know.** Per `apps/web/AGENTS.md`, read the relevant guide in
  `node_modules/next/dist/docs/` before writing Next-specific code. Heed deprecation notices.
- **All new API routes go through `secureRoute`** (`apps/web/src/utils/apiSecurity.ts`):
  auth mode, zod query/params/body, `bodyMode`, `maxBodyBytes`, `rateLimit`, `csrf`.
- **All outbound fetches to user-supplied hosts go through the SSRF-safe path**
  (`safeFetch` / `resolveSafeHost` / pinned dispatcher in `runtimeScanner.ts`).
- **AI calls default to the latest Claude models** (Opus 4.8 / Sonnet 5 / Haiku 4.5), behind
  a single provider abstraction, with cost caps, caching, and timeouts. No model IDs scattered
  across the codebase.
- **Scanner-core stays the shared source of truth** across CLI / web / MCP / Action
  (`packages/scanner-core`). A rule wired in one surface must be wired in all that need it.

---

## 3. Target architecture (before → after)

### 3.1 The Verdict Object — the new core data model

Today, the DB stores **scans** (per-commit records) and **findings**. There is no persistent
"current state of an app." We introduce a first-class entity.

**New entity: `target`** — a monitored app.

| Field                       | Type                                                         | Notes                                              |
| --------------------------- | ------------------------------------------------------------ | -------------------------------------------------- |
| `id`                        | uuid                                                         | PK                                                 |
| `organization_id`           | uuid                                                         | FK                                                 |
| `kind`                      | enum(`repo`,`url`)                                           | a connected repo or a verified live URL            |
| `identifier`                | text                                                         | `owner/repo` or the origin URL                     |
| `display_name`              | text                                                         | human label                                        |
| `ownership_verified`        | bool                                                         | required before active probing of a `url` target   |
| `ownership_method`          | enum(`github_app`,`dns_txt`,`meta_tag`,`file`,`deploy_link`) | how ownership was proven                           |
| `generator_fingerprint`     | enum(`lovable`,`v0`,`bolt`,`cursor`,`replit`,`unknown`)      | detected AI builder                                |
| `current_verdict`           | enum(`ready`,`review`,`blocked`,`unknown`)                   | the always-current answer                          |
| `current_ship_score`        | int                                                          | 0–100                                              |
| `verdict_evidence`          | jsonb                                                        | top blocker + proof summary for one-glance display |
| `last_checked_at`           | timestamptz                                                  | freshness                                          |
| `badge_token`               | text                                                         | stable public token for the badge/report           |
| `created_at` / `updated_at` | timestamptz                                                  |                                                    |

**`scan` becomes an event that updates a `target`.** A scan/probe run writes findings and then
recomputes and updates the target's `current_verdict`, `current_ship_score`, `verdict_evidence`,
`last_checked_at`. History (the trend rail) is the ordered list of scan events for a target.

**New entity: `probe_evidence`** — proof artifacts (e.g. redacted rows returned, open table
name, exposed secret fingerprint, screenshot reference) linked to a finding, so the UI can
render "here is what we actually retrieved."

**New entity: `fix_outcome`** (Phase 5) — links a finding → the fix PR → the post-deploy
re-probe result (`verified_fixed` | `still_open` | `regressed`). This is the dataset seed.

### 3.2 The two-layer scanner

```
                         ┌─────────────────────────────────────────┐
  live URL / repo  ──▶   │  Layer 1: Deterministic Gate            │  ◀─ scanner-core (existing)
                         │  - 14 high-confidence rules             │     fast, free, reproducible
                         │  - runtime probe (headers, RLS, secrets)│     → pass/fail verdict
                         └───────────────────┬─────────────────────┘
                                             │ verdict + evidence
                         ┌───────────────────▼─────────────────────┐
                         │  Layer 2: AI Depth (paid)               │  ◀─ NEW (Phase 4)
                         │  - red-team planner (adaptive probes)   │     app-specific threat model
                         │  - consequence translation              │     reasoning, not regex
                         │  - contextual fix explanation           │
                         └─────────────────────────────────────────┘
```

Layer 1 is the gate (never blocked on AI availability/cost). Layer 2 deepens and explains.

### 3.3 The AI-native loop

```
   AI builds the app  ──▶  Assurly BREAKS it (runtime proof + AI red-team)
          ▲                                   │
          │                                   ▼
   Assurly VERIFIES  ◀──  AI FIXES it (Assurly-generated PR / prompt applied in their tool)
   (post-deploy re-probe → "VERIFIED FIXED" + dataset row)
```

---

## 4. Phases (strict order — each depends on the previous)

> Legend: **BE** = backend, **FE** = frontend, **AI** = AI layer, **DATA** = data model,
> **DoD** = Definition of Done. File paths are relative to repo root.

---

### Phase 0 — Groundwork, decommission, and instrumentation

**Goal:** Clear the deck, fix the one blocking bug, and start capturing the dataset before we
build anything new. Cheap, high-leverage, unblocks everything.

**Why now:** We must stop investing in the commodity core and fix persistence before any new
surface relies on it. Dataset capture must exist from the first new scan or the moat starts late.

**Deliverables**

- **Fix the save-500** (`POST /api/scans` → "Internal server error" locally). Root-cause the
  failing `context.db.saveScan(...)` in `apps/web/src/app/api/scans/route.ts` /
  `apps/web/src/utils/dbAdapter.ts`. A verdict product cannot lose results on reload.
- **Freeze static-rule expansion.** Add a note to `packages/scanner-core/README` and this plan:
  the 14 rules are a stable free funnel; no new rules unless they raise trust/precision. Stop
  net-new rule work.
- **Manual Checker: KEEP (scope decision, 2026-07-13).** Originally slated for removal to sharpen
  focus, but the owner decided to retain it — the local/offline file-checker is genuinely useful to
  some users (no repo/URL required). It stays as a **secondary** surface (behind the primary verdict
  flow), not featured as the hero. Do not invest new roadmap effort in it, but do not delete it.
- **Demote the dashboard GitHub repo-scan** → **folded into Phase 1 (sequencing decision
  2026-07-13).** Phase 1 reframes the whole dashboard around verdict cards, which inherently
  demotes the repo-scan; a standalone Phase 0 UI demotion would be immediately overwritten, so it
  is done there instead of as throwaway work now.
- **Telemetry/corpus groundwork (DATA):**
  - **DONE:** `generator_fingerprint` detector shipped — `apps/web/src/utils/generatorFingerprint.ts`
    (+ 14 tests). Infers the AI builder (Lovable / v0 / Bolt / Cursor / Replit / unknown) from repo
    file paths, `package.json`, and live page/bundle text. Conservative (returns `unknown` unless a
    signal is defensible) so a wrong attribution never poisons the corpus.
  - **Folded into Phase 1:** the `target` / `probe_evidence` / `fix_outcome` tables and _persisting_
    the fingerprint. Their schemas are defined by the phases that use them (`target` is Phase 1's
    core object and will carry `generator_fingerprint`; `probe_evidence` is Phase 2; `fix_outcome`
    is Phase 5). Creating empty tables now would need a premature prod migration and wiring capture
    now would risk re-breaking saves (sending a column absent from prod). The detector is ready to
    plug in the moment Phase 1 adds the `target` table.

**Files**

- Modify: `apps/web/src/app/api/scans/route.ts`, `apps/web/src/utils/dbAdapter.ts`.
- Create: DB migrations for `target` / `probe_evidence` / `fix_outcome`;
  `apps/web/src/utils/generatorFingerprint.ts` (+ test).
- (Manual Checker retained — see scope decision above; no deletion.)

**Acceptance criteria**

- A dashboard scan persists and survives a reload (save-500 gone), verified in a real browser.
- Manual Checker no longer reachable; no dead imports; full suite green.
- New tables exist; a scan writes a `generator_fingerprint` value (verify via DB row).

**Risks:** save-500 may be a local Supabase/env/RLS config issue — reproduce against the real
adapter, don't paper over it. **DoD:** all acceptance criteria met + suite green + browser-verified.

---

### Phase 1 — The Verdict Object (data + API + surfacing)

**Goal:** Make "the current safety verdict of an app" a real, persistent, queryable object that
the whole product renders from.

**Why now:** Every later surface (proof-first hero, badge, monitoring, MCP gate) reads this one
object. Build it before the UX that depends on it.

**Deliverables**

- **BE/DATA:** Scans update their `target`'s `current_verdict` / `current_ship_score` /
  `verdict_evidence` / `last_checked_at`. Introduce a `resolveVerdict(findings)` helper (wraps
  `buildShipGateReport`) that also selects the single most important blocker + its proof for
  one-glance display.
- **BE:** New endpoint `GET /api/targets` (list org's monitored apps + current verdicts) and
  `GET /api/targets/[id]` (one verdict + evidence + history). `secureRoute`, auth required.
- **FE:** Dashboard reframed from "repo list + scan tabs" to **"my apps and their current
  verdicts"** — each card shows the app, a big Ready/Review/Blocked state, ship score, and
  freshness ("checked 2h ago"). Clicking opens the verdict detail (evidence + history + fix).
- **FE:** Keep existing `ShipGatePanel` / `ScanDetailsPanel` as the detail view, but the
  top-level object is now the verdict card, not the scan.

**Files**

- Modify: `apps/web/src/utils/shipGate.ts` (add `resolveVerdict`), `dbAdapter.ts`,
  `DashboardClient.tsx`, `RepoListPanel.tsx` → evolve into `TargetListPanel`.
- Create: `apps/web/src/app/api/targets/route.ts`, `apps/web/src/app/api/targets/[id]/route.ts`,
  `apps/web/src/app/dashboard/_components/VerdictCard.tsx` (+ tests).

**Acceptance criteria**

- Dashboard shows one verdict per app, always current, with freshness — verified in browser.
- A new scan updates the same target's verdict in place (no duplicate app rows).

**Risks:** migration of existing scans to targets (backfill script). **DoD:** verdict object drives
the dashboard; history preserved; suite green; browser-verified.

---

### Phase 2 — Proof-First Experience (Pillar A)

**Goal:** Make the **live proof-of-exploit** the hero of both landing and dashboard, and translate
every finding into a **business consequence** a non-engineer feels. This is the highest-leverage
phase for conversion.

**Why now:** The verdict object exists (Phase 1); now we make the scariest, most viral surface the
front door. Runs on the existing `runtimeScanner` — mostly FE + a light AI/consequence layer.

**Deliverables**

- **FE (landing hero):** Replace the developer-oriented hero (`npx assurly scan` + repo list) in
  `apps/web/src/app/_components/home/HomeClient.tsx` with: **"Paste your app's URL. We'll show you
  what a hacker can steal right now."** One input → one verdict → real proof.
- **FE (proof rendering):** When `probeSupabaseRls` returns rows, render the **actual (redacted)
  retrieved data** as the headline evidence ("We just read 500 rows from your `users` table
  including emails — here's a sample"), not a warning line. Add `probe_evidence` rendering.
- **AI (consequence translation):** New `apps/web/src/utils/consequenceTranslator.ts` — maps each
  `ruleId`/finding to a plain-language business consequence (money + reputation + regulation).
  Curated map first (deterministic, free), AI-generated fallback for novel/contextual findings
  (Layer 2, cached). Surface it as the primary line under each finding everywhere.
- **FE (verdict-first detail):** Reorder detail so the story is: **Verdict → the one thing that
  hurts + proof → consequence in plain words → one-click fix.** Findings table becomes a
  collapsible "for your developer" section.

**Files**

- Modify: `HomeClient.tsx`, `DeployedUrlScan.tsx`, `ShipGatePanel.tsx`, `ScanFindingCard.tsx`,
  `ScanDetailsPanel.tsx`, `runtimeScanner.ts` (return richer `probe_evidence`),
  `apps/web/src/app/api/scan-url/route.ts` (persist evidence).
- Create: `consequenceTranslator.ts` (+ test); `ProofEvidence.tsx` component (+ test);
  AI provider client `apps/web/src/utils/ai/claudeClient.ts` (+ cost caps, caching).

**Acceptance criteria**

- Landing: paste a URL of an app you own → within seconds, a Yes/No verdict + real evidence +
  a money-consequence sentence. Verified in browser against a real target you own.
- Every finding renders a consequence sentence, not CVSS. No developer jargon in the primary view.

**Risks:** proof rendering must **redact** PII (show shape, not full personal data); legal line —
until Phase 3, restrict the public unauth hero to **owned/connected** targets or a safe demo, and
gate arbitrary-URL active probing behind Phase 3. **DoD:** proof-first verdict is the front door
for owned apps; consequences everywhere; browser-verified; suite green.

---

### Phase 3 — Ownership Verification (Pillar B)

**Goal:** Safely unlock **active probing of any URL** by proving the user owns the app — turning the
proof-probe into a public, viral lead magnet without becoming an attack tool.

**Why now:** Phase 2's scary probe must not run against arbitrary third-party sites at scale without
consent. This is the legal/safety prerequisite to opening the funnel publicly.

**Deliverables**

- **BE:** Ownership challenge system with multiple methods (pick easiest for vibe coders):
  1. **`github_app`** — already-connected repo mapped to its deployment (implicit ownership).
  2. **`dns_txt`** — add a `assurly-verify=<token>` TXT record.
  3. **`meta_tag`** — add `<meta name="assurly-verify" content="<token>">` to the site.
  4. **`file`** — host `/.well-known/assurly-verify.txt`.
  5. **`deploy_link`** — OAuth link to Vercel/Netlify to confirm ownership of the deployment.
- **BE:** `POST /api/targets/[id]/verify-ownership` (issues + checks challenge, via SSRF-safe fetch).
  Active/deep probing endpoints require `ownership_verified = true` for `url` targets.
- **FE:** A crisp verification flow ("Prove this is your app — paste one line into your site").
  Non-owned URLs get a **passive, safe preview** (headers, public bundle secrets) + a clear
  "verify ownership to run the full data-exfiltration test."
- **Policy:** Passive checks (safe, non-intrusive) allowed unauth; **active/mutating-adjacent
  checks (RLS row pull, auth probing) require verified ownership.** Document the boundary.

**Files**

- Create: `apps/web/src/utils/ownership/*` (challenge issue/verify), `verify-ownership` route,
  `OwnershipVerify.tsx` (+ tests).
- Modify: `scan-url/route.ts` and probe entrypoints to enforce the ownership gate;
  `runtimeScanner.ts` to split **passive** vs **active** probe tiers.

**Acceptance criteria**

- An unverified arbitrary URL gets only the safe passive preview.
- After verifying (e.g. meta tag), the full active proof-probe runs. Verified in browser.
- No active data-pull is possible without `ownership_verified`. Covered by a security test.

**Risks:** verification friction vs. virality — make the meta-tag/DNS path 60 seconds. **DoD:**
ownership gate enforced + tested; public passive preview live; browser-verified.

---

### Phase 4 — AI Red-Team Planner + Layer 2 (Pillar C)

**Goal:** Replace the fixed probe list with an **AI that plans probes adaptively** based on what it
detects, and add the paid **AI deep-reasoning pass** that understands _this_ app's threat model.
This is the biggest long-term moat.

**Why now:** Ownership is enforced (safe to probe deeply); the verdict + proof surfaces exist to
render richer results. Now we deepen the "break" step of the loop.

**Deliverables**

- **AI (red-team planner):** `apps/web/src/utils/ai/redTeamPlanner.ts` — given detected signals
  (Supabase present, auth provider, public API routes, framework, generator fingerprint), an LLM
  **plans a bounded sequence of safe probes**: Supabase → probe RLS on tables it infers from the
  bundle/schema; Clerk/Auth → test auth-boundary weaknesses; public API route → IDOR-style read
  checks. **All probes non-mutating, ownership-gated, time/rate-bounded, and logged.**
- **BE (probe orchestrator):** deterministic executor that runs only planner-approved, whitelisted
  probe _types_ (LLM chooses among safe primitives; it never emits raw requests). Hard safety rails
  independent of the LLM.
- **AI (Layer 2 deep reasoning):** `apps/web/src/utils/ai/deepReview.ts` — reasons about the app's
  business context and surfaces high-value, app-specific risks beyond the 14 rules. Paid tier only.
- **AI (contextual fix explanation):** per-finding "why this matters / fix it for me" that plugs
  into the existing auto-fix (`githubAutoFix.ts`) and "copy fix prompt" surfaces.
- **Cost/safety:** provider abstraction with model routing (cheap model for planning/triage, strong
  model for deep review), caching by content hash, per-org budget caps, graceful degradation to
  Layer 1 if AI is unavailable.

**Files**

- Create: `apps/web/src/utils/ai/redTeamPlanner.ts`, `deepReview.ts`, extend `claudeClient.ts`;
  probe-primitive registry `apps/web/src/utils/probes/*`; tests incl. safety tests (LLM cannot
  cause a mutating or out-of-scope request).
- Modify: `runtimeScanner.ts` (pluggable probe execution), `scan-url/route.ts`, verdict pipeline.

**Acceptance criteria**

- On an owned Supabase app, the planner discovers and probes tables it was not hardcoded to know,
  and reports real open tables with proof. Verified in browser.
- Safety tests prove the LLM path can never issue a mutating or non-owned request.
- Layer 1 gate still returns a deterministic verdict with AI disabled.

**Risks:** LLM safety (prompt injection from scanned content → treat all scanned content as
untrusted data), cost blow-ups (hard caps). **DoD:** adaptive probing live + safety-proven; deep
review behind paywall; browser-verified; suite green.

---

### Phase 5 — Verified-Fix Loop + Dataset (Pillar D)

**Goal:** Close the loop: found → fix → deploy → **automatic re-probe → "VERIFIED FIXED"** — and
record every outcome to seed the proprietary corpus.

**Why now:** The break (Phase 4) and fix pipeline exist; connecting them creates the retention
hook _and_ the exit-defining dataset.

**Deliverables**

- **BE:** After an Assurly fix PR merges/deploys (via existing `github/webhook` + a deploy signal),
  automatically re-run the relevant probe and set the finding's `fix_outcome` to
  `verified_fixed` / `still_open` / `regressed`.
- **FE:** A "**VERIFIED FIXED**" state on the finding and a timeline ("found 14:03 → fixed by PR #12
  → verified closed 14:40"). This is the emotional payoff and the proof the fix worked.
- **DATA (moat):** every `(generator_fingerprint, ruleId, fix strategy, outcome)` row lands in
  `fix_outcome`. Build an internal aggregate view: "Lovable+Supabase → RLS off in X%, fix Y closes
  it Z% of the time." Privacy-safe (no customer data, only patterns).
- **BE:** deploy detection — Vercel deploy webhook / redeploy signal to trigger re-probe.

**Files**

- Create: `apps/web/src/utils/verifiedFix.ts`; deploy webhook route (Vercel);
  `apps/web/src/app/api/targets/[id]/reprobe/route.ts`; internal corpus aggregate query.
- Modify: `github/webhook/route.ts`, `githubFixPipeline.ts`, verdict pipeline, finding UI.

**Acceptance criteria**

- Fix an RLS finding via Assurly PR on an owned app → after deploy, the finding auto-flips to
  VERIFIED FIXED with a timestamped trail. Verified in browser.
- A `fix_outcome` row is written per resolved finding (verify via DB).

**Risks:** deploy-signal reliability across hosts (fallback to scheduled re-probe). **DoD:** verified
loop works end-to-end; dataset rows accumulating; browser-verified.

---

### Phase 6 — Continuous Guardian + Badge Growth Loop

**Goal:** Turn one-shot scans into an **always-on guardian** (the subscription value) and make the
**badge a distribution engine**.

**Why now:** The verdict, proof, and verified-fix all exist; now we keep them fresh automatically and
turn every protected app into marketing.

**Deliverables**

- **BE:** Scheduled + event-driven re-probe (daily baseline + on every deploy/PR). Regression alerts
  productized ("Your app was safe yesterday; this morning's edit re-exposed `users`").
  Build on existing `scanRegression` / `notifyIfRegressionBlockers`.
- **FE/BE:** Alerts via email (existing Resend) + optional Slack/Discord webhook; per-target alert prefs.
- **FE (badge loop):** Promote the existing `GET /api/badge/[token]` badge to a first-class,
  embeddable "**Verified by Assurly · Ship Score N/100**" that founders show their own customers.
  Public report page (`report/[token]`) becomes a polished trust page. Every badge links back = growth.
- **FE:** "Guardian" dashboard state — the verdict card shows live monitoring status + last check.

**Files**

- Modify: `apps/web/src/utils/scanRegression.ts`, `badge/[token]/route.ts`, `report/[token]/*`,
  verdict card; add scheduler (cron) + alert prefs; alert delivery utilities.
- Create: scheduled re-probe job; `AlertPreferences.tsx`; upgraded public trust/report page.

**Acceptance criteria**

- A regression on an owned app triggers an alert within the monitoring window. Verified.
- Badge renders live current score and links to a shareable trust page. Verified in browser.

**Risks:** alert fatigue (only alert on new _blockers_/regressions, not noise). **DoD:** continuous
monitoring + regression alerts + badge/trust page live; browser-verified.

---

### Phase 7 — Agent-Native Distribution (MCP gate) + OEM

**Goal:** Be the ship-gate that **AI agents call themselves** before deploy, and the "security-checked"
layer **platforms embed** for their users.

**Why now:** The full verdict + proof + fix loop exists; now we distribute it where code is born.

**Deliverables**

- **MCP:** Extend `packages/mcp-server` so a coding agent can, pre-deploy, call `assurly.verdict(url|repo)`
  and get a structured Ready/Blocked + top blocker + fix. Position as "the standard ship-gate for AI agents."
- **BE:** Programmatic/API access + keys for agent and OEM use; rate/plan tiers.
- **OEM/B2B2C:** A white-label verdict + badge platforms (Lovable/Bolt/agencies) can surface to their
  own users. "Security-checked by Assurly" as an embeddable widget/API.

**Files**

- Modify: `packages/mcp-server/*` (verdict tool), API auth for programmatic keys;
  create OEM widget/embed + docs.

**Acceptance criteria**

- An agent (or a scripted MCP client) gets a correct structured verdict pre-deploy. Verified.
- A working embeddable "security-checked" widget backed by the badge/verdict. Verified.

**DoD:** MCP verdict tool shipped + documented; OEM embed working; browser/CLI-verified.

---

### Phase 8 — Pricing, Business & Exit Readiness

**Goal:** Align monetization with the new value and make the company legible to an acquirer.

**Deliverables**

- **Pricing realign:** Free = the scary proof-probe (viral top of funnel) + one guarded app.
  Paid (per-app subscription) = continuous monitoring + AI deep review + auto-fix + verified badge
  ("founder pays for sleep"). Add an **OEM/platform tier** (usage/seat based) for B2B2C — the real
  revenue and exit lever. Revisit the current `$19 Guard / $49 Agency` framing in `HomeClient.tsx`.
- **Exit-readiness:** package the dataset story (AI-failure + verified-fix corpus), the trust brand,
  and MCP distribution into a clean narrative + metrics dashboard for a strategic buyer
  (Supabase / Vercel / builder).
- **Trust/compliance surface:** the public "security-checked" brand, SOC2-lite trust page, and clear
  data-handling/consent docs (leaning on the ownership + privacy work).

**Files**

- Modify: `HomeClient.tsx` pricing section, Stripe products/prices (`stripe/*`), plan gating across
  AI features; internal metrics/corpus dashboard.

**DoD:** new pricing live; OEM tier defined; corpus + distribution narrative documented.

---

## 5. Cross-cutting workstreams (run continuously, not a phase)

- **AI cost & safety:** single provider abstraction (`utils/ai/claudeClient.ts`), model routing,
  content-hash caching, per-org budget caps, timeouts, and **treat all scanned content as untrusted
  data** (prompt-injection defense). Latest Claude models only.
- **Security & legal:** ownership gate (Phase 3) enforced everywhere active; never a mutating probe;
  SSRF-safe fetch for every user host; PII redaction in all proof rendering; consent + data-handling docs.
- **Privacy-safe dataset:** capture patterns and outcomes, never customer data. Aggregate-only corpus.
- **Testing & verification:** keep `npx vitest run src` green; add security tests for each new probe
  path; **every phase browser-verified end-to-end** before sign-off. E2E (Playwright) for critical flows.
- **Observability:** structured logs already exist (`assurly-api`); add verdict/probe/AI-cost metrics.
- **Docs discipline:** update `docs/roadmap/README.md` to point here as the master plan; ADRs for
  the verdict object, ownership model, and AI-layer architecture.

---

## 6. What we cut or freeze (explicit)

| Item                           | Decision                             | Rationale                                                                                   |
| ------------------------------ | ------------------------------------ | ------------------------------------------------------------------------------------------- |
| Manual Checker (drag-drop zip) | **Keep** (owner decision 2026-07-13) | Useful offline file-checker for some users; kept secondary, not featured, no new investment |
| Net-new static rules           | **Freeze**                           | Commodity; LLMs make a fixed rulebook free                                                  |
| Dashboard GitHub repo-scan     | **Demote** to free funnel            | Structurally a demo (250-file cap, rate limits)                                             |
| CVSS/jargon-first finding UI   | **Replace** with consequence-first   | Buyer can't read code                                                                       |
| Scan-centric data model        | **Replace** with verdict object      | Product is a status, not a run                                                              |

---

## 7. Sequencing rationale (why this order)

1. **Phase 0** removes drag and fixes persistence — nothing works reliably without it.
2. **Phase 1** builds the object everything else renders from.
3. **Phase 2** flips the front door to proof-first — highest conversion leverage, uses existing probe.
4. **Phase 3** makes that front door legally scalable (public virality without becoming an attack tool).
5. **Phase 4** deepens the "break" with AI — the durable moat, only safe after ownership.
6. **Phase 5** closes the loop + starts the dataset — retention + exit asset.
7. **Phase 6** makes it always-on + turns users into distribution.
8. **Phase 7** puts us where code is born (agents/platforms).
9. **Phase 8** monetizes and packages for exit.

Leverage and dependency both point to this order. We do not reorder without updating this file.

---

## 8. Master tracker

> Update as items land. A phase is only checked when its DoD is met **and** browser-verified.

- [ ] **Phase 0** — Groundwork, decommission, instrumentation
  - [x] Fix `POST /api/scans` save-500 — **done & browser-verified.** Root cause: prod DB was 2
        migrations behind (`confidence`, `share_token` columns missing), plus a PGRST102 key-mismatch
        from `undefined` optional fields. Fixed by (a) normalising the findings payload to a uniform
        key set in `dbAdapter.saveScan`, (b) applying the 2 pending migrations to prod via
        `supabase db push` (also un-broke badge/share, which silently 500'd without `share_token`),
        (c) logging real 5xx error detail server-side in `secureRoute` (was hidden behind a generic
        message). Regression test in `dbAdapter.test.ts`. **Note:** run vitest from repo root
        (`npx vitest run apps/web/src`) — running it from `apps/web` hits an ESM/CJS config-loader bug.
  - [x] Freeze static-rule expansion — documented in `packages/scanner-core/README.md`
  - [x] ~~Delete Manual Checker~~ — **KEEP** (owner decision 2026-07-13); retained as secondary surface
  - [x] `generatorFingerprint` detector shipped + 14 tests (`apps/web/src/utils/generatorFingerprint.ts`)
  - [→] Demote dashboard repo-scan — **folded into Phase 1** (dashboard reframe demotes it inherently)
  - [→] `target` / `probe_evidence` / `fix_outcome` tables + fingerprint _persistence_ — **folded into
    Phase 1 / 2 / 5** (schemas belong to those phases; detector is ready to plug in)

  **Phase 0 status: complete.** All durable groundwork landed (save-500 fixed & verified, prod DB
  synced, observability improved, rules frozen, moat instrumentation shipped). Two items deliberately
  sequenced into Phase 1 to avoid throwaway work and premature prod migrations.

- [x] **Phase 1** — Verdict Object (data + API + surfacing) — **complete & browser-verified.**
      Dashboard leads with "Your apps" verdict cards ("3 apps not safe to ship right now"), sorted
      blocked→review→ready→unknown, each showing verdict + score + top issue + freshness. Confirmed
      end-to-end: cards render from prod, card→detail navigation works, and a live scan upserts the
      target (no sync error) then refreshes the card to "Checked just now".
  - [x] `targets` table (migration `20260713000000_targets.sql`) with org-scoped RLS — **applied to prod**
  - [x] `resolveVerdict` / `resolveVerdictFromScanFindings` (top-issue projection) + tests
  - [x] `dbAdapter`: `getTargets` / `getTargetById` / `upsertTarget` (PostgREST merge-duplicates)
  - [x] Scan-save syncs the repo target (verdict projection + generator fingerprint), best-effort
  - [x] `generator_fingerprint` captured client-side during scan → persisted on the target (folded-in item)
  - [x] `GET /api/targets` (verdict per app; target row authoritative, else derived from latest scan) + tests
  - [x] FE `VerdictCard` + `VerdictCardsSection` as the **primary dashboard surface** (repo-scan
        demoted below — the folded-in "demote repo-scan" item) + tests
  - [x] Browser-verified: verdict cards render, card→detail, live scan → target upsert → card refresh
  - [→] `GET /api/targets/[id]` deferred: the existing repo/scan detail already serves as the verdict
    detail (cards open it), so a separate endpoint is not needed for the Phase 1 DoD
- [x] **Phase 2** — Proof-First Experience + consequence translation — **complete & browser-verified.**
      Tests green (704 pass), typecheck clean, `probe_evidence` migration applied to prod (`supabase db push`
      → remote up to date), browser-verified end-to-end.
  - [x] AI provider abstraction `utils/ai/claudeClient.ts` (model ids centralised, 20s timeout, one
        retry on 5xx, content-hash cache, per-org budget guard, `asUntrustedData` injection defense) + tests
  - [x] `consequenceMap.ts` (pure, client-safe curated consequence for every rule id) +
        `consequenceTranslator.ts` (AI fallback → curated → message, never on critical path) + tests
  - [x] `probe_evidence` migration `20260714000000_probe_evidence.sql` (org-scoped RLS) — **applied to prod**
  - [x] `runtimeScanner` returns already-redacted `ProbeEvidence` (RLS row count via `count=exact`
        header — proves scale without exfiltration; masked secrets; missing headers) + `redactCell` + tests
  - [x] Active Supabase RLS row-pull gated: passive-only by default, `activeProbe` only for signed-in
        users (`scan-url` route); security test asserts SSRF guard on the active path
  - [x] `dbAdapter.insertProbeEvidence` / `getProbeEvidenceForScan`; `scan-url` persists evidence for
        authenticated scans (best-effort) + returns evidence for anonymous previews + route tests
  - [x] FE `ProofEvidence` (proof headline: "we read N rows from `users`", redacted) on landing hero +
        dashboard URL scan; `ScanFindingCard` consequence-first with collapsible technical detail;
        `VerdictCard` + `ShipGateGroupRow` surface consequences + tests
  - [x] Push `probe_evidence` migration to prod — **applied 2026-07-14**
  - [x] Browser-verify end-to-end: passive URL scan (fastshare.cz — Live proof + probe_evidence
        persist); authenticated active RLS probe (controlled gist target — „We read 5 rows from
        `posts`" + redacted sample in probe_evidence, 2026-07-14)
- [x] **Phase 3** — Ownership Verification — **complete & browser-verified (2026-07-17).** Shipped in
      `5bc838c`. Verified live end-to-end against a controlled owned target (a throwaway Vercel page +
      Supabase): an unverified URL got the passive preview + exposure hook only; after adding the
      `meta_tag` and redeploying, the challenge passed, `ownership_verified` flipped true, and the active
      probe unlocked. The gate held (passive-only until proven ownership).
  - [x] `utils/ownership/gate.ts` — `isActiveProbeAllowed({ kind, ownershipVerified })` is the single
        server-side authority for the passive/active boundary (`repo` implicitly owned; `url` requires
        proven ownership); `normalizeUrlIdentifier` pins a target to its **origin** + tests
  - [x] `utils/ownership/verify.ts` — `meta_tag` / `dns_txt` / `file` challenges. All HTTP goes through
        the SSRF-safe, GET-only `safeFetch`; body reads capped at 1 MiB; DNS path issues no HTTP + tests
  - [x] `utils/ownership/token.ts` — `deriveOwnershipToken(org + target + identifier)`, so a token is
        not transferable between orgs or targets + tests
  - [x] `GET`/`POST /api/targets/[id]/verify-ownership` (`secureRoute`, auth required, `csrf: true`,
        `RATE_LIMITS.sensitive`); persists `ownership_verified` **only** on a passing challenge + tests
  - [x] FE `OwnershipVerify.tsx` (paste-one-line flow) + `DeployedUrlScan.tsx` wiring; `dbAdapter.setTargetOwnership`
  - [→] No migration needed — the ownership columns shipped with Phase 1's `20260713000000_targets.sql`
  - [→] **Acceptance criterion "no active data-pull without `ownership_verified`, covered by a security
    test" was NOT satisfied by this phase.** Phase 3 built the machinery but did not wire it into the
    scan path; enforcement in `scan-url/route.ts` + `ownershipGate.security.test.ts` landed in Phase 4
    (`4fe4b0c`). Recorded here so the sequencing is not mis-read later.
  - [x] **Design note (verified 2026-07-16):** ownership is **origin-scoped** — `verifyOwnership` is
        called with `target.identifier` (the origin), so `meta_tag` reads the origin **root** and `file`
        reads `/.well-known/…` at the root. A shared host (e.g. `gist.githubusercontent.com`) therefore
        **cannot** be verified by uploading one file, which closes an origin-takeover hole. Consequence:
        Phase 2's controlled **gist** target can no longer be used for active probes — Phase 2 gated the
        active pull on _sign-in_, Phase 3 tightened it to _ownership_. Any future active-probe
        verification needs an origin whose **root** the owner controls.
  - [x] Browser-verified 2026-07-17: `meta_tag` → `ownership_verified = true` → active probe ran.
- [x] **Phase 4** — AI Red-Team Planner + Layer 2 deep review — **complete (2026-07-17): core
      browser-verified, moat criterion resolved.** Shipped in `3a6acbd`, `3777495`, `4fe4b0c`, `48b0328`
  - the 2026-07-17 planner-sharpening commit. Suite green (822), `tsc --noEmit` clean.
  * [x] `utils/probes/*` — whitelist registry (`PROBE_PRIMITIVE_NAMES`, currently the single
        `supabase_rls_table_read`), zod-validated params (table name pinned to `[A-Za-z_][A-Za-z0-9_]*`,
        unknown keys like `method`/`url` stripped before the handler), and a **deterministic executor**
        with hard caps in code (`PROBE_MAX_STEPS = 12`, `PROBE_MAX_DURATION_MS = 30_000`)
  * [x] `probes/supabaseRls.ts` — the old `probeSupabaseRlsWithEvidence` logic extracted into a primitive:
        GET-only via the injected SSRF-safe `safeFetch`, `limit=1` + `Prefer: count=exact` (proves scale
        without exfiltrating rows), host/anon key from **context** (scanner-extracted), never from LLM params
  * [x] `utils/ai/redTeamPlanner.ts` — `MODELS.fast`; scanned content wrapped in `asUntrustedData`;
        output sanitised against the whitelist; **deterministic fallback** on any AI failure/budget/parse
        error, so Layer 1 stays reproducible + tests
  * [x] `utils/ai/deepReview.ts` (`MODELS.deep`, paid tier only — `billing_plan === 'pro'`) and
        `utils/ai/contextualFix.ts`; both degrade to null/curated — AI is never on the critical path
  * [x] `runtimeScanner.ts` — pluggable probe execution; the planner + executor run **only** inside the
        `if (options.activeProbe)` branch; `scan-url/route.ts` sets that from `isActiveProbeAllowed` and
        **fails closed** on any target-lookup failure; `planSource: 'ai' | 'deterministic'` surfaced to the client
  * [x] Security tests: `probes/executor.security.test.ts` (adversarial plans — `http_raw`, `shell_exec`,
        `../etc/passwd`, `a; DROP TABLE users;--`, forged `supabaseUrl` in params — never become a mutating
        or out-of-scope request); `scan-url/aiPlanner.security.test.ts` (gate blocks planner + probe;
        adversarial LLM JSON yields GET-only to the owned host; Layer 1 deterministic with AI disabled);
        `scan-url/ownershipGate.security.test.ts` (real scanner, zero REST calls when unverified)
  * [x] **Gate assertion hardened (2026-07-16):** `aiPlanner.security.test.ts` asserted the planner was
        blocked via `planSource === undefined` — an _output artifact_. A mutation (planner hoisted out of
        the `activeProbe` branch, result unused) **kept every existing security test green** while the
        scanned content of an unverified target was already sent to the LLM. Added a pair to
        `ownershipGate.security.test.ts` asserting the _side effect_ — zero Claude API calls for an
        unverified target, plus a **positive control** proving the assertion is not vacuous. Both fail
        under that mutation. This matters because `planRedTeamProbes` deliberately does not re-check
        ownership (its docstring defers to the caller), so the property is **non-local**.
  * [x] Cost/safety reuses the Phase 2 abstraction (`assertAiBudget` / `recordAiUsage` / content-hash
        cache); deep review additionally skipped when there is nothing to reason about (no findings and
        no active probe) rather than spending tokens on an empty verdict
  * [x] **Core browser-verified 2026-07-17.** On an owned, ownership-verified Supabase target the active
        probe pulled **5 real rows** from `customers` via the anon key (redacted proof: `a***@***.com`,
        columns + `count=exact` scale), producing a BLOCKER + LIVE PROOF and flipping the verdict to
        🚫 NOT READY. Deep review ran **only** after ownership (locked teaser on the passive scan → live
        analysis after verify). No console/server errors.
  * [x] **MOAT CRITERION — resolved & proven (2026-07-17).** Root cause of the earlier failure was
        diagnosed empirically, not guessed: the planner **did** run (`planSource: ai`) and **did** have the
        prose in its input, but the prompt only told it to "include heuristic table names", so the fast model
        just echoed the one `.from()` hit and inferred nothing. Fix (three parts): (1) the planner prompt now
        explicitly instructs the model to **INFER** the app's tables from the described product entities;
        (2) `DEFAULT_SENSITIVE_SUPABASE_TABLES` expanded to a curated 18 and the deterministic plan now probes
        heuristic tables **first** so an app-specific `.from()` table is never crowded out; (3) tests pin the
        inference instruction and the ordering. Proven with a real AI call through the production
        `planRedTeamProbes`: given a distinctive logistics page, it inferred `driver_payouts`,
        `route_optimizations`, `drivers`, and `routes` — none in the wordlist, only one a `.from()` hit — vs.
        the pre-fix output of `["customers"]`. So the planner now genuinely discovers tables it was not
        hardcoded to know.
  * [→] **Positioning reframe (decided 2026-07-17): the moat is the CORPUS, not the planner.** Even
    sharpened, table-name inference is commoditizable (a good wordlist + entity extraction gets most of
    it), so the planner is a **probe-coverage engine**, not a defensible moat — we improved it because
    coverage = more real holes found = more product value and more corpus data, **not** as a moat bet.
    The durable, non-replicable asset is the `(generator_fingerprint, ruleId, fix_strategy, outcome)`
    corpus that Phase 5 now feeds — exactly where §0 locates it. Do not over-invest further in planner
    cleverness; invest in the corpus aggregates.
- [x] **Phase 5** — Verified-Fix Loop + dataset — **complete & browser-verified end-to-end (2026-07-17).**
      Shipped in `f5a90fc`, `ab7fcc9`, `a181f2b`, `054483d` + `9fabf19`.
  - [x] `fix_outcome` migration `20260716000000_fix_outcome.sql` (org-scoped RLS + `private.vercel_webhook_deliveries`
        idempotency infra) — **applied to prod 2026-07-17** (`supabase db push`, owner-approved; additive/idempotent).
  - [x] `utils/verifiedFix.ts` (pure `resolveFixOutcome` + rollup), `utils/reprobe.ts` orchestrator (goes
        through `isActiveProbeAllowed`, fails closed, writes only on a state change), `utils/vercelWebhook.ts`
        (HMAC-SHA1 verified, target resolved from our DB never the payload, claim-first idempotency),
        `POST /api/targets/[id]/reprobe`, VERIFIED FIXED timeline UI + tests.
  - [x] **Loop proven in prod:** scan #1 of an owned target with `customers` RLS off wrote
        `runtime-supabase-rls-open → still_open`; after enabling RLS (the fix) a re-scan wrote
        `runtime-supabase-rls-open → verified_fixed` (confirmed via a direct `fix_outcome` query on prod).
        UI verdict moved 🚫 NOT READY 80 → ⚠️ REVIEW 96, "No blockers detected". Satisfies the acceptance
        criterion "a fix_outcome row is written per resolved finding (verify via DB)".
  - [x] `9fabf19` fixed the persistence bug found during this verification (`return=minimal` 201 empty
        body threw "Unexpected end of JSON input"), so evidence + outcomes now persist.
- [x] **Phase 6** — Continuous Guardian + badge growth loop — **complete & browser-verified end-to-end (2026-07-18).**
      Shipped in `ec3b8b1`, `5fb1ae1`, `064acd7`; hardened by `2fbbd52` + `5fa1c64`.
  - [x] `target_alert_prefs` migration `20260718000000_target_alert_prefs.sql` (org-scoped RLS mirroring
        `targets`, `unique(target_id,channel)`) — **applied to prod 2026-07-18** (`supabase db push`,
        owner-approved; additive/idempotent).
  - [x] Guardian cron `GET /api/cron/guardian` + `vercel.json` (daily 06:00 UTC). `utils/cronAuth.ts`
        verifies `Authorization: Bearer $CRON_SECRET` **fail-closed + timing-safe BEFORE any DB/probe**;
        missing/wrong secret → 401, zero work. `utils/guardian.ts` batches through `reprobeTargetAndRecord`
        → `isActiveProbeAllowed` (never a second probe path), verified-url targets only, bounded
        concurrency (3) + wall time (50s).
  - [x] Low-noise alerts: `notifyIfTargetRegressionBlockers` fires ONLY on `detectNewBlockers` (new
        blockers) — baseline/steady-state/newly-fixed = zero. Email (Resend) default-on; optional
        Slack/Discord incoming-webhook per target with host-allowlist SSRF guard. Deploy webhook applies
        `applyGuardianAfterReprobe` (new blockers only) after its re-probe.
  - [x] Badge + public trust growth loop: `GET /api/badge/[token]` renders the live "Verified by Assurly
        · Ship Score N/100" SVG linking to `report/[token]`; `GET /api/trust/[token]` + trust page are a
        whitelisted shape-only projection. FE `VerdictCard` shows the Guardian chip, "last checked"
        freshness, and a "score dropped since last check" regression indicator.
  - [x] **Verified live end-to-end on the dogfood target** (`assurly-test-target…vercel.app`): cron auth
        401 (missing/wrong secret) → authorized run seeded the baseline (badge_token, verdict, score) with
        zero alerts; a real regression (RLS disabled on a table between checks) produced **exactly one**
        alert email to the org admin (`errors:0`, which also proves the new migration — `getTargetAlertPrefs`
        no longer errors) and flipped the verdict 96 → 80 with the dashboard "score dropped" indicator;
        steady-state re-run = zero alerts; every check also fed the `fix_outcome` corpus
        (`regressed`/`verified_fixed`).
  - [x] **`2fbbd52` (security):** the public trust page/badge projection surfaced the raw finding message,
        naming the exact exploitable table (e.g. `invoices`) of a still-`blocked` app. Now exposes only a
        coarse category (`toPublicIssueCategory`, derived from the group-key prefix — never the tail) +
        severity; anti-leak test asserts the table name/raw message are absent. Verified live: trust JSON +
        rendered page show only "Database access control (RLS)".
  - [x] **`5fa1c64` (correctness):** RLS-open findings shared one `rule_id`+`file_path` with the table only
        in the message, so `regressionKey` collapsed N exposed tables to one key and a second exposed table
        never alerted. `supabaseTableLocation(table)` now scopes the finding location per table (stable, no
        volatile data). Verified live: exposing two tables yields two distinct table-scoped blockerSnapshot
        entries; unit tests prove `detectNewBlockers` flags a newly-exposed second table while the known one
        does not re-alert. **Note:** this changes the stored `file_path` shape — a target with a _live_
        exposure re-classifies once on the first post-deploy check (a true positive), not a false alert.
- [x] **Phase 7** — Agent-native distribution (MCP gate) + OEM — **complete & live-verified end-to-end (2026-07-18).**
      Shipped in `0ba799d`, `13498dd`, `d194324`, `1a50abd`, `e876553`.
  - [x] `api_keys` migration `20260718100000_api_keys.sql` (org-scoped RLS mirroring `targets`, hash-only
        storage, soft-revoke, `plan in (free,pro)`) — **applied to prod 2026-07-18** (`supabase db push`,
        owner-approved; additive/idempotent). Verified on prod: table present, RLS on, 3 policies
        (select/insert/update — no delete).
  - [x] **API-key auth foundation** — `utils/apiKeys.ts`: 192-bit CSPRNG key, sha256 hash (unsalted is safe
        at that entropy), plaintext returned exactly once and NEVER stored/logged, `parseBearerApiKey`
        rejects malformed before any DB hit. `secureRoute` gains an `auth: 'apiKey'` mode (no second wrapper)
        with plan-based `RATE_LIMITS` (`apiKeyFree`/`apiKeyPro`) keyed on the key id, layered under the IP guard.
  - [x] **Keyed verdict API** `GET /api/v1/verdict` (`auth: 'apiKey'`) — READ-ONLY, SHAPE-ONLY via
        `toPublicTrustProjection` + `categoryRemediation` (coarse category + generic fix, never a table name
        or evidence). Uses the service role but scopes the lookup with an explicit `organization_id` filter
        (`getTargetByIdentifier`), so no cross-org read; consults `isActiveProbeAllowed` but has NO
        probe/scan/re-probe path, so a stranger/unverified URL only ever gets the passive verdict.
  - [x] **API-key management** — `GET/POST /api/api-keys` + `POST /api/api-keys/[id]/revoke` (soft flag,
        RLS-scoped via the user adapter → no IDOR) + dashboard `ApiKeys.tsx`. Plan snapshotted from the org
        billing plan.
  - [x] **`assurly_verdict` MCP tool** (`packages/mcp-server`) — added alongside the three existing local-scan
        tools; READS the hosted `GET /api/v1/verdict` via `ASSURLY_API_KEY` (a single GET, no local scan/probe).
        A blocking verdict is surfaced as a ship-gate failure.
  - [x] **OEM white-label widget** `GET /api/widget/[token]` — embeddable SVG from the badge token +
        projection, sanitized (SVG-injection-safe) branding label, shape-only.
  - [x] **Tests + independent review:** web 886 pass / 126 files, mcp-server 11 pass, `tsc --noEmit` (apps/web)
        clean (the pre-existing mcp-server `tsc` TS2589/module-resolution errors are unchanged and unrelated;
        mcp validates via vitest + esbuild). Every non-negotiable was re-verified by reading the code, not the
        report: zero active-probe path, org-scoped lookup, shape-only payloads, hash-only key storage, 401 on
        missing/malformed/revoked, no revoke IDOR.
  - [x] **Live-verified end-to-end (2026-07-18):** against the prod-migrated table — a minted key returns a
        shape-only owned-target verdict (`review/96`, coarse "Missing security headers", no table name); no key
        / garbage key / revoked key → 401; a stranger URL → passive `unknown` with `activeProbeAllowed:false`
        and no probe (target `last_checked_at` unchanged); the OEM widget renders white-label ("Security-checked
        by Acme Platform · 96/100"). The dashboard create-key UI (plaintext-once) is covered by unit tests;
        not driven live because it needs an interactive login.
- [x] **Phase 8** — Pricing, business & exit readiness — **complete & live-verified end-to-end (2026-07-18).**
      Shipped in `b63d567`, `a2fb174`, `7a40512`, `bcc5720`.
  - [x] `billing_plan` OEM-tier migration `20260718200000_billing_plan_oem_tier.sql` (additive/idempotent;
        adds a DB check on `organizations.billing_plan` and widens `api_keys.plan` to include `'oem'`) —
        **applied to prod 2026-07-18** (`supabase db push`, owner-approved). Pre-push verified prod had no
        dirty plan values; post-push confirmed both check constraints are `in ('free','pro','oem')`.
  - [x] **Server-enforced entitlements** — `utils/entitlements.ts` (pure, exhaustive over `BillingPlan`,
        compile-fails if a plan is added without a mapping) is the single source of truth. Enforced in
        routes, not just shown: `scan-url` rejects a NEW `url` target past the plan's guarded-app limit
        (Free = 1) with `402 plan_required` (re-scans always pass; fails open only on a DB error); deep
        review is gated by `deepReviewEnabled`; an API key's rate tier is snapshotted from the org
        entitlement. Enum kept in sync across `entitlementsForPlan`, `apiKeyRateLimitForPlan`
        (exhaustive + `apiKeyOem`), and the DB checks.
  - [x] **Pricing realign** in `HomeClient.tsx` — Free / Pro / OEM-Platform matching the entitlements; OEM is
        "Contact Sales" with **no Stripe checkout** (owner-provisioned). Stripe `planForStatus` still maps
        only `free`/`pro`, so a webhook can never set `'oem'` — no live billing change was made.
  - [x] **Exit-readiness** — `GET /api/internal/metrics`, an aggregate-only surface from `getFixOutcomeCorpus`
        (pattern columns only) + a scalar `countMonitoredApps` (HEAD + `count=exact`, no rows), gated by a
        shared `METRICS_SECRET` via the new timing-safe, fail-closed `verifyBearerSecret` (401 before any DB
        access). `rollupExitMetrics` is pure with an anti-leak test. Plus `docs/roadmap/11-exit-narrative.md`.
  - [x] **Trust/compliance** — a public, static SOC2-lite `/trust` page (posture, ownership-gated probing,
        PII redaction, subprocessors); no new data collection.
  - [x] **Tests + independent review:** web 908 pass / 130 files, mcp-server 11 pass, `tsc --noEmit`
        (apps/web) clean. Reviewed by reading the code, not the report: entitlements enforced server-side,
        enum in sync, money is owner-only (no live financial op, OEM never set from a webhook), corpus/metrics
        aggregate-only, metrics secret fail-closed.
  - [x] **Live-verified (2026-07-18):** against prod — the metrics endpoint returns aggregate KPIs with a
        valid secret (real corpus: 9 apps, verifiedFixRate 0.5714) and **401** with a missing/wrong secret and
        no DB work; the realigned Free/Pro/OEM pricing renders; the SOC2-lite trust page renders. The 402
        guarded-app-limit is unit-verified (a live check needs an interactive login on a Free org).

**The genius rebuild is complete — Phases 0–8 are all shipped and browser/live-verified. There is no Phase 9.**

### Post-rebuild — Watch Production (D5c + D7) · 2026-07-26

Not part of the original 0–8 sequence. Spec: [`phase-watch-production.md`](./phase-watch-production.md).

- [x] **D7 CRA readiness** — `docs/cra-scope-assessment.md`, CRA reporting runbook, `npm run sbom:published`
      (CycloneDX for published packages), `disclosureContact` shared by Trust §13 / `security.txt` / runbook
      (+ consistency test). No claim of CRA compliance.
- [x] **D5c Prod Watch** — derived-signal anon-key abuse monitor; opt-in off by default; feature flag
      `ASSURLY_PROD_WATCH_ENABLED` off by default; no raw logs / no IPs persisted (proven by test);
      migration `20260726120000_prod_watch.sql` written — **not applied to prod until owner approves**.
- [ ] **Legal gate (open)** — draft proposals in `docs/legal/DRAFT-prod-watch-privacy-terms-trust.md`
      await counsel sign-off; live Privacy/Terms still contain `[LEGAL ENTITY NAME]` placeholders.
      Do not set `ASSURLY_PROD_WATCH_ENABLED=1` in production until that gate closes.

---

## 9. Glossary

- **Verdict object / target** — the persistent "is this app safe right now" state per monitored app.
- **Proof-of-exploit** — a real, non-mutating runtime demonstration (e.g. rows actually returned
  from a live DB via the anon key) shown as evidence, redacted for PII.
- **Layer 1 / Layer 2** — deterministic gate (free, reproducible) vs. AI depth (paid, reasoning).
- **Red-team planner** — the LLM that adaptively plans safe, ownership-gated probes.
- **Generator fingerprint** — the detected AI builder (Lovable/v0/Bolt/Cursor…) behind an app.
- **Verified fixed** — a finding re-probed after deploy and confirmed closed at runtime.
- **Corpus / moat** — aggregate dataset of AI-failure patterns and which fixes actually closed them.

---

_This document is load-bearing. Changes to scope, ordering, or the definition of "core" must be
made here first, then reflected in code._
