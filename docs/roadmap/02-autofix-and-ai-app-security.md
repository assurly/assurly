# Phase 2 — Auto-fix First + AI-App Security Rules

> **Status:** proposed · **Branch:** `feat/phase-2-autofix-ai-security` · **Priority:** 🟠 high

## Goal

Two moves that together make ShipReady worth paying for:

1. **Make remediation the core product** — from "we find issues" to "we find AND fix them for you":
   1-click Fix PR, batch Fix PR, and a **"copy fix prompt for AI"** output for users without a GitHub PR flow.
2. **Add AI-app security rules** — the vulnerability class specific to AI-built apps in 2026 that no one in the
   niche covers well: LLM keys in the client, prompt-injection surface, unauthenticated tool-calling routes,
   PII sent to model context, and missing spend/rate limits on chat-style routes.

## Why

Detection is a commodity: Supabase Advisor finds RLS for free, Copilot review is bundled. **Remediation is what
people pay for.** Our 1-click Fix PR / batch PR engine is the hardest-to-copy asset — it must become the core value.
Separately, "AI wrapper apps" are their own vulnerability category in 2026 (leaked LLM keys, prompt injection,
unguarded tool calls) and are largely un-served — this is genuine, defensible differentiation, not another generic rule.

## Scope / Non-goals

**In scope:**

- Extend `isAutoFixableFinding` and the fix generators with more deterministic, high-confidence fixes.
- A "copy fix prompt for AI" generator that turns current findings into paste-ready instructions.
- New AI-app security detection rules in `scanner-core`.
- UI: promote the fix action (make "Fix it" the primary CTA, reuse existing components — no redesign).

**Not in scope (do NOT do):**

- No backend LLM call to _generate_ fixes — the fix prompt is **assembled deterministically** from findings.
- No low-confidence auto-fixes — only high-confidence, idempotent fixes may open a PR.
- Do not touch billing, URL scanning, or MCP.

## Existing code to reuse

- **Fixability:** `apps/web/src/utils/githubAutoFix.ts` → `isAutoFixableFinding(finding)` (today: `.sql` +
  "row-level security", and `.env.example` + "environment variable"). Add new cases here.
- **Fix summary:** `apps/web/src/utils/fixSummary.ts` → `buildFixSummary`, `findingFixPrUrl`.
- **Fix PR flow (server):** `apps/web/src/app/api/github/fix/route.ts` and client `clientApi.createFix`.
- **UI card:** `apps/web/src/app/dashboard/_components/ScanFindingCard.tsx` ("Create Fix PR" / "View Fix PR").
- **Fix summary panel:** `ScanDetailsPanel.tsx` (`data-testid="scan-details-fix-summary"`).
- **Rule engine:** `packages/scanner-core/src/index.ts` — add the new AI-app security scanners here (one engine).
- **Markdown export:** `packages/scanner-core/src/shipGate.ts` — a reference for the fix-prompt text format.

## New `ruleId`s — AI-app security (set `confidence` honestly per Phase 0)

| ruleId                        | severity | confidence | Detection                                                                                                                   |
| ----------------------------- | -------- | ---------- | --------------------------------------------------------------------------------------------------------------------------- |
| `ai-llm-key-in-client`        | error    | high       | `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `sk-`, `sk-ant-` referenced in a `'use client'` file or `NEXT_PUBLIC_*`              |
| `ai-route-missing-authz`      | error    | medium     | A route handler that calls an LLM/tool-calling endpoint with no auth/session check                                          |
| `ai-missing-rate-limit`       | warning  | medium     | A `/api/chat`-style route (streams to an LLM) with no rate-limit/spend guard                                                |
| `ai-pii-to-model-context`     | warning  | low        | User PII fields (email, address, phone) passed into a prompt/model call without redaction (heuristic → review, not blocker) |
| `ai-prompt-injection-surface` | warning  | low        | User-controlled input concatenated directly into a system/tool prompt (heuristic → review)                                  |

> Note the confidences: only `ai-llm-key-in-client` is a blocker. The heuristic ones are review/warning by design
> (Phase 0 discipline). Do not promote a heuristic to blocker.

## Tasks

1. **New AI-app security scanners** in `scanner-core`:
   - `scanAiLlmKeyLeak(content, file)` — detect LLM keys in client scope / `NEXT_PUBLIC_*` (high confidence).
   - `scanAiRouteAuthz(content, file)` — detect LLM/tool routes without an auth/session guard (medium).
   - `scanAiRateLimit(content, file)` — detect chat-style routes without a rate limit (medium).
   - `scanAiPromptInjection(content, file)` — detect raw user input concatenated into prompts (low → review).
   - Export them and include them in the standard scan set.
2. **Extend auto-fix coverage** in `githubAutoFix.ts` (only deterministic, idempotent, high-confidence):
   - `undocumented-env` → append the missing `KEY=` line to the correct per-app `.env.example`.
   - `github-actions-integration` → generate the CI workflow snippet.
   - (Only add a fix where you can produce a safe, idempotent change — no code deletion, additions or clearly-marked
     replacements only.)
3. **"Fix prompt for AI" generator** — new `apps/web/src/utils/aiFixPrompt.ts`:
   - `buildAiFixPrompt(findings: WebFinding[]): string` — deterministic text: a header + one block per finding
     ("File X, line Y: <problem> → <exact fix instruction>"). Use each finding's `suggestion` where present,
     otherwise derive from `ruleId`. Stable ordering. Mask secrets.
4. **UI: "Copy fix prompt" button** in `ScanDetailsPanel` (copies to clipboard, shows a toast).
5. **UI: promote remediation** — make the primary post-scan CTA "Fix these issues", not just a findings list
   (reuse existing components; no redesign).
6. **Tests.**

## New / changed files

```
packages/scanner-core/src/aiAppSecurity.ts             (new — the 4 AI-app scanners)
packages/scanner-core/src/aiAppSecurity.test.ts        (new)
packages/scanner-core/src/index.ts                     (change — export + include new scanners)
apps/web/src/utils/aiFixPrompt.ts                      (new)
apps/web/src/utils/aiFixPrompt.test.ts                 (new)
apps/web/src/utils/githubAutoFix.ts                    (change — more fixable cases)
apps/web/src/utils/githubAutoFix.test.ts               (change — tests for new cases)
apps/web/src/app/dashboard/_components/ScanDetailsPanel.tsx   (change — Copy fix prompt CTA)
apps/web/src/app/dashboard/_components/ScanFindingCard.tsx    (change — emphasize fix action)
```

## Acceptance criteria

- [ ] `scanAiLlmKeyLeak` flags `OPENAI_API_KEY` used in a `'use client'` file as `ai-llm-key-in-client` (error, high).
- [ ] The prompt-injection and PII scanners emit **review/warning**, never blockers (verified in Ship Gate output).
- [ ] `buildAiFixPrompt([...])` returns deterministic text with file, line, and a concrete instruction per finding.
- [ ] Empty input → a "no issues" prompt (no crash).
- [ ] At least two new `ruleId`s are now `isAutoFixableFinding === true` with a covered, idempotent fix generator.
- [ ] Fix generators are idempotent — applying twice does not change the result (tested).
- [ ] "Copy fix prompt" button copies the text (verified via a `navigator.clipboard` mock) and shows a toast.
- [ ] Existing fix-PR flow and `fixSummary` tests stay green.

## Tests

- **Unit (`aiAppSecurity.test.ts`):** each scanner — positive and negative fixtures; correct severity + confidence.
- **Unit (`aiFixPrompt.test.ts`):** finding combinations → expected text; stable order; secret masking; empty input.
- **Unit (`githubAutoFix.test.ts`):** new fixable cases → `true`; fix generator diff; idempotency.
- **Component:** "Copy fix prompt" calls clipboard and shows confirmation.

## How to verify

```bash
# scanner-core
npm run test -w @shipready/scanner-core
# apps/web
npx tsc --noEmit && npm run lint
npm run test -- aiFixPrompt
npm run test -- githubAutoFix
```
