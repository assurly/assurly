# Incomplete Instant Gate score floor

> **Status:** shipped · **Priority:** trust (P1 from production QA)

## Goal

Stop Instant Gate incomplete scans with **zero blockers** from displaying a dumpster-fire **0/100** Ship Score
when warning volume from a partial sample zeros the penalty math. Incomplete coverage must remain capped so it
never claims READY, but must stay in a defensible review band.

## Diagnosis

- Card / trend / detail SoT was aligned at `0` — not a projection drift bug.
- Engine: warning/review **groups** × `WARNING_PENALTY` (4) can exceed 100 → score `0`.
- Incomplete only applied `Math.min(score, 79)` (cap), never a floor.
- Result: `INCOMPLETE SCAN — REVIEW` + `0 blockers` + `0/100` reads as catastrophic failure.

## Scope / Non-goals

**In scope:**

- `INCOMPLETE_SCORE_CAP = 79` (unchanged).
- When `hasIncompleteCoverage && blockers.length === 0`:
  `shipScore = Math.min(79, Math.max(computed, 40))` (`INCOMPLETE_NO_BLOCKER_FLOOR = 40`).
- Unit tests in `@assurly/scanner-core`.
- Web display SoT (`shipScoreDisplay` + trend findings fetch) applies the same floor so
  pre-floor persisted `0` rows do not keep showing a dumpster-fire score.

**Not in scope:**

- Redesigning Instant vs Full Gate product model.
- Mass SQL backfill of historical `ship_score` rows (display floor + next rescan repairs).
- Changing blocker penalties or READY thresholds.

## Acceptance Criteria

1. Incomplete-only finding → status `review`, headline `INCOMPLETE SCAN — REVIEW`, score ≤ 79.
2. Incomplete + many warnings + 0 blockers → score ∈ [40, 79].
3. Incomplete + enough blockers → may score below 40; status `blocked`.
4. Complete scans (no `scan-completeness`) unchanged.
5. Dashboard card / trend / detail agree on the floored incomplete score.

## Existing code

- [`packages/scanner-core/src/shipGate.ts`](../../packages/scanner-core/src/shipGate.ts) — `buildShipGateReport`
- Web display SoT: [`apps/web/src/utils/shipScoreDisplay.ts`](../../apps/web/src/utils/shipScoreDisplay.ts)
