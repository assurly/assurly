# Assurly 2026 — Roadmap & Transformation Plan

This directory contains **execution specs** that turn Assurly from a static CLI analyzer into a product
that has real value, sticky revenue, and a defensible position in 2026.

Every spec is written so a **Cursor Agent can implement it phase by phase without drifting**.

> **Cursor: read this file first, then read `.cursor/rules/assurly-2026.mdc`. Both are load-bearing.**

---

## 1. North Star (where we are going)

> From **"a static code analyzer for developers with a terminal"**
> to **"a trustworthy pre-deploy Ship Gate for people who had their SaaS built by AI."**

The single question the product answers for the user:

> **"Can I ship this to Vercel + Supabase + Stripe right now without embarrassing myself or leaking data?"**

Target users are no longer "developers with a terminal". They are:

1. **Vibe coders** (Lovable / Bolt / v0 / Cursor) — they have a deployed URL and fear of a breach, not a repo and a CLI.
2. **AI agents** (Cursor, Claude Code) — they need a ship-gate step before deploy, called over MCP.
3. **Agencies** — they need a white-label audit report to hand to a client.

Three principles behind every change:

- **Trust first.** Few, precise, defensible verdicts beat many noisy ones. If a rule cannot be defended to a
  senior engineer in 30 seconds, it must not be a blocker.
- **Runtime + static, not static only.** The customer has a URL; they do not always have a repo.
- **Remediation > detection.** Detection is a commodity (Supabase Advisor is free, Copilot review is bundled).
  People pay to have issues _fixed_, and distribution (free scan + shareable badge) is what gets us found.

---

## 2. The synthesis behind this plan (why the ordering is what it is)

This roadmap merges two independent analyses:

- A **market/business analysis** (competition, distribution, runtime scanning, MCP, pricing, exit).
- A **rule-quality/trust analysis** (noise, blocker discipline, monorepo correctness, AI-app security, deeper stack rules).

Both are correct and neither is sufficient alone:

- If we build the differentiated surfaces (URL scan, MCP) on top of **noisy, imprecise rules**, we only ship a
  louder version of a good idea — and a product that flags its own test files will never be trusted.
- If we perfect rule precision but never leave the **"scan a committed repo via PR"** model, we optimize a product
  fighting the wrong distribution battle — the scared vibe coder never finds us, and Supabase Advisor eats our
  strongest rule for free.

**Therefore: trust first, then reach.** Phase 0 (rule quality) is the cheapest phase with the highest impact on
trust, so it ships first.

---

## 3. Phases (order = impact priority)

| #   | Spec                                                                     | Goal                                                                                  |
| --- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| 0   | [00-rule-quality-and-trust.md](00-rule-quality-and-trust.md)             | Kill noise, reclassify blockers by confidence, monorepo-correct rules, self-scan gate |
| 1   | [01-url-runtime-scanner.md](01-url-runtime-scanner.md)                   | Scan a live deployed URL (RLS probe, secrets in bundle, headers) with no repo         |
| 2   | [02-autofix-and-ai-app-security.md](02-autofix-and-ai-app-security.md)   | Auto-fix as the core product + new AI-app security rules                              |
| 3   | [03-deeper-stack-rules.md](03-deeper-stack-rules.md)                     | Auth/session boundaries, deeper Supabase, Stripe lifecycle, Vercel deploy readiness   |
| 4   | [04-mcp-server.md](04-mcp-server.md)                                     | MCP server over `scanner-core` — a ship gate AI agents call before deploy             |
| 4b  | [04b-mcp-publish-and-positioning.md](04b-mcp-publish-and-positioning.md) | Publish the MCP packages to npm and give the "AI agents" segment a page to find them  |
| 5   | [05-monitoring-and-badge.md](05-monitoring-and-badge.md)                 | Continuous scans, regression alerts, shareable Ship Score badge                       |
| 6   | [06-positioning-pricing-cleanup.md](06-positioning-pricing-cleanup.md)   | Messaging, pricing, kill-list, landing reliability & SEO fixes                        |

**Recommended build order: 0 → 1 → 2 → (6 messaging, ongoing) → 3 → 4 → 4b → 5.**
Phase 4b has one human-only step (the actual `npm publish`) — see its "Scope / Non-goals" before starting.
Phase 6 runs continuously — update messaging for each shipped capability, not all at once at the end.

---

## 4. How to drive this in Cursor (workflow)

**Golden rule: one phase = one branch = one PR = one session.**
Never ask Cursor to "do all phases at once" — the agent drifts, invents APIs, and leaves half of it done.

For each phase:

1. Create a branch: `git checkout -b feat/phase-0-rule-quality`
2. Open **Agent / Composer** in Cursor.
3. Use this prompt (swap the number/name):
   ```
   Read docs/roadmap/00-rule-quality-and-trust.md and implement it in full.
   Obey the "Scope / Non-goals" and "Acceptance Criteria" sections exactly.
   Reuse the existing code listed under "Existing code to reuse" — do not invent new APIs.
   After implementing, write the tests described under "Tests" and run them.
   Do not change anything outside this phase's scope.
   ```
4. When Cursor finishes, verify locally (see "Definition of Done" below).
5. Only when the phase is green, move to the next. **Do not parallelize phases.**

**Tip:** If a phase is large, split it by its own "Tasks" section and run Cursor task by task
(Task 1, verify, Task 2, ...). Smaller scope = a more accurate agent.

---

## 5. Definition of Done (applies to every phase)

A phase is done only when ALL of these pass (run from `apps/web` unless noted):

- [ ] `npx tsc --noEmit` → 0 errors
- [ ] `npm run lint` → 0 errors
- [ ] `npm run test` (Vitest, unit) → green
- [ ] `npm run test:e2e` (Playwright) → green — mind the E2E constraints in section 7
- [ ] New behavior has its own tests (not just "worked manually")
- [ ] No `any`, no `@ts-ignore`, no upload of user source code to a third party
- [ ] Conventional commit (`feat(scanner): ...`)

---

## 6. Success metrics (not rule count)

The product wins on trust and outcomes, never on how many rules it has.

| Metric                                         | Target                                |
| ---------------------------------------------- | ------------------------------------- |
| Blocker false-positive rate on reference repos | < 5%                                  |
| Assurly self-scan (dogfood)                    | 0–2 blockers, not 19                  |
| Time to first actionable fix                   | < 2 min                               |
| "Would deploy after fixing blockers" (Pro NPS) | high                                  |
| Free → Guard conversion                        | track as the north-star funnel metric |

---

## 7. Immutable constraints (read BEFORE the first change)

These also live in `.cursor/rules/assurly-2026.mdc` (Cursor sees them automatically). Repeated here:

- **Next.js 16 has breaking changes.** Obey `apps/web/AGENTS.md`: read `node_modules/next/dist/docs/` before
  writing Next code. Do not rely on pre-16 patterns from memory.
- **Local-first is the product's identity.** Manual/browser scans run locally; the user's source code is never
  uploaded to a third party for analysis. (Runtime URL scanning of the user's own public URL is the one
  exception — read-only probes only, see `01-url-runtime-scanner.md` safety rails.)
- **One rule engine:** `@assurly/scanner-core`. Add rules there, not duplicated in web/CLI.
- **Blocker discipline:** if a rule cannot be defended to a senior in 30 seconds, it is a warning or "review",
  never a blocker. Max ~12 blocker rules total.
- **API routes:** always `zod`-validate input and rate-limit via `apps/web/src/utils/apiSecurity.ts`.
- **E2E:** Playwright starts its own dev server on port **3200** with `E2E_DASHBOARD_FIXTURE=1`. Next 16 refuses a
  second dev server in the same directory — kill any running `npm run dev` before `npm run test:e2e`, then restart it.
- **Design stays.** This transformation changes the engine, rules, and positioning — not the visual design.
  Reuse existing components (e.g. `ShipGatePanel`) for new surfaces.
- **Language:** reply to the user in **Slovak**; write all code, comments, and docs in **professional senior English**.

---

## 8. Existing code map (what we build on)

| Area                 | Path                                                                     | Note                                                                                                                                                                                      |
| -------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rule engine          | `packages/scanner-core/src/index.ts`                                     | `scanStripeWebhook`, `scanRscDataLeaks`, `scanColdStart`, `scanEdgeRuntime`, `scanSqlMigration(s)`, `scanSupabaseClientLeaks`, `scanEnvVariables`, `selectFiles`, `incompleteScanFinding` |
| Ship Gate            | `packages/scanner-core/src/shipGate.ts`                                  | `buildShipGateReport`, `buildIssueGroups`, `formatShipGatePlainText`, markdown export; blocker = group severity `error`, warning = `warning`                                              |
| Browser wrapper      | `apps/web/src/utils/browserScanner.ts`                                   | Re-exports scanner-core for the browser; `WebFinding` = `ScannerFinding`                                                                                                                  |
| CLI                  | `packages/cli/src/index.ts`, `packages/cli/src/detector.ts`              | `scan` (default) + `init`; detector lists files, ignores `node_modules` (but NOT tests today)                                                                                             |
| Auto-fix             | `apps/web/src/utils/githubAutoFix.ts`, `.../fixSummary.ts`               | `isAutoFixableFinding` (today only `.sql` RLS + `.env.example`)                                                                                                                           |
| Auth/session         | `apps/web/src/utils/{auth,authorization,scanProxy,sessionCookie}.ts`     | References for Phase 3 auth-boundary rules                                                                                                                                                |
| URL/tree/file proxy  | `apps/web/src/app/api/github/public-scan/route.ts`                       | Reference for Phase 1 (how to fetch remote content safely)                                                                                                                                |
| Stripe               | `apps/web/src/app/api/stripe/{checkout,portal,webhook,simulate-webhook}` | Billing infra already exists                                                                                                                                                              |
| GitHub App + webhook | `apps/web/src/app/api/github/{install,webhook,proxy,discover}`           | Channel for continuous monitoring (Phase 5)                                                                                                                                               |
| File selection       | `apps/web/src/app/dashboard/_components/DashboardClient.tsx:820`         | `selectFiles([...], 250)` today takes the FIRST 250 (Phase 0 fixes this)                                                                                                                  |
| DB model             | `apps/web/src/utils/dbAdapter.ts`                                        | `Organization`, `Repository`, `Scan`, `ScanFinding`                                                                                                                                       |
| ⚠️ Email/alert infra | —                                                                        | **DOES NOT EXIST** — Phase 5 must build it                                                                                                                                                |

Each phase has its own, more precise "Existing code to reuse" section.
