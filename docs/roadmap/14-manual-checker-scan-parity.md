# 14 — Manual Checker Scan Parity

> **Status:** shipped · **Branch:** `fix/manual-checker-scan-parity` · **Priority:** trust

## Goal

Manual Checker Project Folder / ZIP scans must use the same noise filter and env resolution as CLI / `@assurly/scanner-core`, so intentional fixtures and unit tests never become Ship Gate blockers.

## Scope

- Strengthen `isScannableFile` (`testing/`, `__mocks__/`, `coverage/`, `playwright.config.ts`).
- Load-time filter in Manual Checker `projectFiles.ts`.
- Scan-time filter + CLI-parity env (`allExamples`, `testOnlyKeys`) in `scanProject`.
- Regression tests proving Assurly self-scan fixtures do not block.

## Non-goals

- Snippet tabs (SQL / Stripe / Env paste) — user-selected content stays scannable.
- UI redesign or Ship Loop changes.
- New scanner rules.
- Other surfaces that still omit `isScannableFile` (e.g. some public GitHub scans) — follow-up.

## Acceptance Criteria

1. Loading `test-projects/**`, `*.test.*`, or `fixtures/**` via folder/ZIP does not put those files in the workspace.
2. `scanProject` produces zero findings for those paths even if a caller passes them programmatically.
3. Production SQL without RLS still blocks.
4. Nested `apps/web/.env.example` resolves for `apps/web` code (monorepo).
5. Manual Checker self-scan of Assurly is defensible next to `npx assurly scan -p .` (no fixture blockers).

## Existing code to reuse

- `packages/scanner-core/src/fileRelevance.ts` — `isScannableFile`
- `collectTestOnlyEnvKeys`, `resolveEnvExampleForPath`, `scanEnvVariables` options
- Dashboard load path already filters with `isScannableFile`
