# Manual Checker Ship Loop

> **Status:** shipped · **Branch:** `feat/manual-checker-ship-loop` · **Priority:** remediation / trust

## Goal

Close the Manual Checker remediation loop for vibe coders and AI agents:

**Fix → Explain (plain language) → Handoff to Cursor/Claude → Ship Receipt when READY.**

Local-first: source never leaves the browser. No new API, no persisted badge tokens.

## Why

Detection is commodity; Assurly sells remediation and proof. After Auto-Fix, users need to trust
what changed without reading a diff, send remaining work to an agent, and copy a client-safe
receipt when the Ship Gate is green.

## Scope / Non-goals

**In scope:**

1. Applied-fix journal + Undo last (project + snippet tabs).
2. What changed panel (consequence-first before/after cards).
3. Continue in Cursor / Claude clipboard handoff when findings remain.
4. Ship Receipt markdown copy when Ship Gate status is `ready`.
5. Unit + jsdom tests.

**Not in scope:**

- Server share links / badges for Manual Checker scans.
- Visual redesign of Manual Checker.
- New scanner rules.
- LLM-generated fix text.

## Existing code to reuse

- `apps/web/src/utils/consequenceMap.ts` — plain-language risk copy
- `apps/web/src/utils/aiFixPrompt.ts` — remaining-finding prompt body
- `apps/web/src/app/_components/ship-gate/CopyButton.tsx` — clipboard UX
- `apps/web/src/app/dashboard/_components/manual-checker/projectAutoFix.ts` — apply transforms
- `DiagnosticTerminal` / `ShipGatePanel` — mount point under Ship Gate

## Acceptance Criteria

1. After Auto-Fix or Fix all, What changed lists plain-language before/after cards (no code diffs).
2. Undo last restores prior workspace content and journal; only the latest card exposes Undo.
3. Continue in Cursor / Claude is visible when findings remain; clipboard text includes READY TO SHIP goal, already-applied fixes, and remaining issues (secrets masked).
4. Copy Ship Receipt appears only when status is `ready`; markdown is metadata-only (no source paths/content).
5. Idle project (no files loaded) does not show the Ship Loop panel.
6. Targeted vitest + `tsc --noEmit` green.

## Human verify checklist

1. Project tab: load vulnerable demo → Fix all → What changed appears.
2. Undo → files/findings restore → Fix all again.
3. With remaining warnings: copy handoff → paste contains goal + remaining issues.
4. After clean scan: Copy Ship Receipt → markdown says READY TO SHIP and no-upload line.
