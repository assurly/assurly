# Phase 0 — Rule Quality & Trust

> **Status:** proposed · **Branch:** `feat/phase-0-rule-quality` · **Priority:** 🔴 highest (ship first)

## Goal

Make ShipReady's verdicts **trustworthy** before we expand its surface area. Concretely:

1. Stop scanning noise (test files, fixtures, vendored code).
2. Reclassify findings so **blockers are high-confidence only**; everything heuristic becomes a warning or "review".
3. Make rules **monorepo-correct** (per-app `.env.example`, accept existing CI).
4. Prove quality by **dogfooding**: ShipReady scanning itself must produce 0–2 blockers, not 19.
5. Make the scan **transparent** (report what was scanned and what was skipped).

## Why

Trust is the entry ticket. If ShipReady flags its own test files, reports 19 blockers on a clean app, or blocks a
deploy over a heuristic guess, the user stops believing the verdict — and then no feature matters. Detection is a
commodity in 2026 (Supabase Security Advisor detects RLS for free); our only durable edge is **being right, quietly**.
This phase is the cheapest work with the highest impact on trust, so it ships before anything else.

## Scope / Non-goals

**In scope:**

- A file-relevance filter (exclude tests/fixtures/vendor) shared by CLI and web.
- Smart file selection (prioritize `app/`, `api/`, `supabase/`, `db/` over alphabetical first-N).
- A **confidence** dimension on findings and a blocker/warning/review classification derived from it.
- Monorepo-aware `.env.example` matching and CI-rule relaxation.
- A scan-scope summary in the report.
- A dogfood CI gate (ShipReady scans itself).

**Not in scope (do NOT do here):**

- No new detection rules (Phases 2 and 3 add those).
- No UI redesign — reuse existing report components.
- No changes to auto-fix, URL scanning, or MCP.

## Key facts about the current code (verified — build on these)

- `selectFiles(files, maxFiles)` in `packages/scanner-core/src/index.ts` returns `files.slice(0, limit)` —
  i.e. the **first N in the given order**. In `DashboardClient.tsx:820` it is called with `250`, so today a large
  repo scans the first 250 files by list order, not by relevance. **This is the "250 first alphabetically" problem.**
- The CLI detector (`packages/cli/src/detector.ts`) ignores `node_modules` but does **not** exclude `*.test.*`,
  `*.spec.*`, `test-projects/**`, `__tests__`, `fixtures`, or `vendor`.
- In `packages/scanner-core/src/shipGate.ts`, `blockers = groups with severity 'error'` and
  `warnings = groups with severity 'warning'`. Blocker/warning is driven **purely by the rule's own severity today**
  — there is no confidence dimension. Phase 0 introduces one.

## Design: the `confidence` dimension

Add an optional `confidence: 'high' | 'medium' | 'low'` to `ScannerFinding` (default `'high'` for existing rules so
nothing regresses). Then change Ship Gate classification to:

| Rule severity | Confidence | Ship Gate bucket           |
| ------------- | ---------- | -------------------------- |
| error         | high       | **Blocker**                |
| error         | medium/low | **Review** (not a blocker) |
| warning       | any        | **Warning**                |

> Net effect: a finding can only block the ship if it is both severe AND high-confidence. This is the mechanical
> enforcement of the "defend it to a senior in 30 seconds" rule.

## Existing code to reuse

- **Finding type:** `ScannerFinding` in `packages/scanner-core/src/index.ts` — extend with `confidence?`.
- **Ship Gate:** `buildShipGateReport` and `buildIssueGroups` in `shipGate.ts` — change the blocker/warning split here.
- **File selection:** `selectFiles` in `index.ts` — add a relevance-ranking helper alongside it.
- **CLI file listing:** `packages/cli/src/detector.ts` — add the ignore filter here.
- **Web file selection:** `DashboardClient.tsx:820` — apply the same relevance ranking before `selectFiles`.
- **Env rule:** `scanEnvVariables` in `index.ts` — make example matching per-app-root.

## Tasks (in this order)

1. **Shared ignore filter** — new `packages/scanner-core/src/fileRelevance.ts`:
   - `isScannableFile(path: string): boolean` — returns false for `**/*.test.*`, `**/*.spec.*`, `**/__tests__/**`,
     `**/test-projects/**`, `**/fixtures/**`, `**/vendor/**`, `**/node_modules/**`, `**/dist/**`, `**/.next/**`.
   - `rankFilesByRelevance<T>(files, getPath): T[]` — stable sort that puts `app/`, `api/`, `supabase/`, `db/`,
     `middleware`, `route`, `schema.sql` first, deprioritizes everything else. Pure and unit-testable.
2. **Wire the filter into both channels:**
   - CLI `detector.ts`: exclude non-scannable files.
   - Web `DashboardClient.tsx`: rank by relevance before `selectFiles([...], 250)` so the 250 cap keeps the
     _most important_ files, not the alphabetically-first ones.
3. **Add `confidence` to `ScannerFinding`** (optional, default `'high'`). Update existing rule outputs only where a
   rule is genuinely heuristic (e.g. mark the RSC runtime-import heuristic `medium` if it cannot distinguish
   `import type`). Do not touch high-precision rules.
4. **Reclassify in Ship Gate** — in `buildShipGateReport`/`buildIssueGroups`, move `error + non-high-confidence`
   findings into a "review" bucket instead of blockers. Keep the existing `ShipGateReport` shape; add a `review`
   group array (or reuse warnings with a marker — choose the least disruptive; document the choice in code comments).
5. **Monorepo-correct `.env.example`** in `scanEnvVariables`:
   - Match a `.env.example` per app root (nearest ancestor), not one global file for the whole monorepo.
   - Ignore framework/CI vars: `NODE_ENV`, `CI`, `VERCEL`, `NEXT_RUNTIME`, and anything only referenced in test files.
6. **Relax the CI rule** (`github-actions-integration`): if a workflow exists that runs a ShipReady/scan step,
   pass; otherwise emit an onboarding **hint (warning)**, never a blocker.
7. **Scan-scope summary:** extend the report with `scanScope: { scanned: number; skipped: number; roots: string[] }`
   and surface a one-line summary ("Scanned apps/web, 312 files, skipped tests & fixtures") in CLI output and the
   `ShipGatePanel`.
8. **Dogfood gate:** add an npm script `scan:self` (root) that runs the CLI against this repo and fails CI if
   blockers > 2. Wire it into the existing GitHub Actions workflow.

## New / changed files

```
packages/scanner-core/src/fileRelevance.ts             (new)
packages/scanner-core/src/fileRelevance.test.ts         (new)
packages/scanner-core/src/index.ts                      (change — ScannerFinding.confidence)
packages/scanner-core/src/shipGate.ts                   (change — confidence-aware classification + scanScope)
packages/scanner-core/src/shipGate.test.ts              (change — new classification tests)
packages/cli/src/detector.ts                            (change — ignore filter)
packages/cli/src/reporter.ts (or shipGateReporter.ts)   (change — scan-scope line)
apps/web/src/app/dashboard/_components/DashboardClient.tsx  (change — relevance ranking before selectFiles)
apps/web/src/app/_components/ship-gate/ShipGatePanel.tsx    (change — scan-scope line + review bucket render)
package.json (root)                                     (change — scan:self script)
.github/workflows/*.yml                                 (change — run scan:self, fail if blockers > 2)
```

## Acceptance criteria

- [ ] `isScannableFile` returns false for `*.test.ts`, `test-projects/x/y.sql`, `vendor/*`, `dist/*`, `.next/*`,
      and true for `apps/web/src/app/api/foo/route.ts`.
- [ ] A repo with 1000 files where the important ones sort late still scans `app/`/`api/`/`supabase/` first
      (relevance ranking verified by unit test).
- [ ] A finding with `severity: 'error', confidence: 'low'` is classified as **review**, not a blocker.
- [ ] A finding with `severity: 'error'` and no confidence (legacy) still classifies as a blocker (no regression).
- [ ] `.env.example` matching is per-app-root; `NODE_ENV`/`CI` and test-only vars never produce `undocumented-env`.
- [ ] The CI rule never blocks; it warns/hints only, and passes when an existing workflow runs a scan step.
- [ ] The report exposes `scanScope` and both CLI and `ShipGatePanel` show a one-line scan-scope summary.
- [ ] `npm run scan:self` reports **0–2 blockers** on this repo, and CI fails if it exceeds 2.
- [ ] All existing scanner-core and web tests stay green (no regression).

## Tests

- **Unit (`fileRelevance.test.ts`):** ignore matching (positive + negative cases), relevance ranking stability.
- **Unit (`shipGate.test.ts`):** confidence-aware classification matrix (severity × confidence → bucket),
  legacy findings default to blocker, `scanScope` populated correctly.
- **Unit (env):** per-app-root example matching; framework/CI/test vars ignored.
- **Regression:** run the full existing suite; nothing that was a blocker for a high-precision rule may become non-blocking.

## How to verify

```bash
# from repo root
npm run build -w @shipready/scanner-core
npm run test -w @shipready/scanner-core
npm run scan:self          # must report 0–2 blockers
# from apps/web
npx tsc --noEmit && npm run lint && npm run test
```
