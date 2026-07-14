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
- [~] **Phase 2** — Proof-First Experience + consequence translation — **complete pending commit.**
  Tests green (704 pass), typecheck clean, prod migration applied, browser-verified end-to-end.
  - [x] AI provider abstraction `utils/ai/claudeClient.ts` (model ids centralised, 20s timeout, one
        retry on 5xx, content-hash cache, per-org budget guard, `asUntrustedData` injection defense) + tests
  - [x] `consequenceMap.ts` (pure, client-safe curated consequence for every rule id) +
        `consequenceTranslator.ts` (AI fallback → curated → message, never on critical path) + tests
  - [x] `probe_evidence` migration `20260714000000_probe_evidence.sql` (org-scoped RLS) — **dry-run OK,
        NOT yet pushed to prod (awaiting approval)**
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
- [ ] **Phase 3** — Ownership Verification
- [ ] **Phase 4** — AI Red-Team Planner + Layer 2 deep review
- [ ] **Phase 5** — Verified-Fix Loop + dataset
- [ ] **Phase 6** — Continuous Guardian + badge growth loop
- [ ] **Phase 7** — Agent-native (MCP gate) + OEM
- [ ] **Phase 8** — Pricing, business & exit readiness

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
