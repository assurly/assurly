# Phase 6 — Positioning, Pricing & Cleanup

> **Status:** proposed · **Branch:** `feat/phase-6-positioning` · **Priority:** 🟢 ongoing

## Goal

Align the product story with the new value (URL scan + auto-fix + monitoring + trust), reshape pricing so it sells
**peace of mind and remediation, not rule count**, and remove dead weight. Run this phase **continuously** — update
messaging for each shipped capability, not all at once at the end.

## Why

The landing today says "static analysis for developers" and the footer says "Prepared for B2B SaaS Exit Readiness".
The new customer (vibe coder / agency) does not see themselves in that, and it signals to an acquirer that the app is
built to be sold, not to serve customers. The story must match what the product actually does now.

## Scope / Non-goals

**In scope:** landing copy, pricing cards, the kill-list, and minor landing reliability/SEO fixes.
**Not in scope:** no new core capability (those are Phases 0–5). **Do not redesign the visual design** — copy,
structure, and metadata only.

## Tasks

### A) Messaging (landing — `HomeClient.tsx` and related)

- Rework the primary hook from "detection" to **remediation + runtime + trust**. Recommended headline:
  > "Before you ship your AI-built SaaS, Assurly tells you in 60 seconds what will break in production — and what
  > you can safely ignore."
- Add a "How it works" section: URL scan → Ship Score → 1-click fix / AI fix prompt → continuous monitoring.
- Add trust framing relevant to vibe coders (reference real 2025–2026 incident classes such as exposed Supabase RLS)
  — **without inventing our own metrics** (no fake "500+ teams" numbers).

### B) Pricing (sell peace of mind, not features)

| Plan       | Price  | What they get                                                                        |
| ---------- | ------ | ------------------------------------------------------------------------------------ |
| **Free**   | $0     | URL scan (limited result) + public repo + MCP server access — the acquisition funnel |
| **Guard**  | $19/mo | Monitoring on every deploy, private repos, auto-fix PRs, regression alerts           |
| **Agency** | $49/mo | + white-label PDF audit reports, 5 seats, Ship Score badge, priority                 |

> **MCP placement (decided in Phase 4b):** the MCP server is part of **Free** — it is a distribution/acquisition
> channel (agents call it before deploy), not a paid surface. Monetization is the Guard/Agency stickiness features
> above, not gating the gate itself.

- Emphasize that an **Agency bills the $49 to its client** as part of an audit (the most reliable paying segment).
- "Most Popular" on Guard.
- Fix EUR pricing to reflect an actual exchange rate, not a 1:1 copy of the USD numbers.

### C) Kill-list (remove dead weight)

- **VS Code extension** — pause/archive (low value; the target customer does not use it). Remove it from CI builds
  and mark it "paused" in the README. _Do not hard-delete code without confirmation — just drop it from active
  maintenance._
- **Footer "Prepared for B2B SaaS Exit Readiness"** — replace with a normal product footer.
- Stop presenting "number of rules" as the headline value anywhere.

### D) Landing reliability & SEO fixes (from the earlier QA audit)

- **OG / Twitter meta tags + canonical** — currently missing; add them (sharing on Slack/LinkedIn shows a blank card today).
- **Public scanner fails on the GitHub rate limit** — add a graceful fallback/message and, where possible, an
  authenticated proxy.
- **Alt text** on the testimonial avatars (WCAG).

## New / changed files

```
apps/web/src/app/_components/home/HomeClient.tsx     (messaging, pricing, hook)
apps/web/src/app/layout.tsx or the metadata source    (OG/Twitter/canonical)
apps/web/src/app/_components/home/HomeHeader.tsx / footer   (footer text)
apps/web/src/app/_components/CookieInventoryTable.tsx  (already fixed — verify unchanged)
README.md (root)                                       (VS Code extension → "paused")
```

## Acceptance criteria

- [ ] The landing hook is about URL scan + fixing, not static analysis for developers.
- [ ] Pricing cards read Free / Guard / Agency with value bullets (not "number of rules").
- [ ] The page has OG title/description/image, a Twitter card, and a canonical URL (verify in `<head>`).
- [ ] The footer no longer contains "Exit Readiness".
- [ ] EUR prices are not a 1:1 copy of USD.
- [ ] The public scanner shows a clear message on rate-limit instead of a silent failure.
- [ ] No fabricated metrics in the copy.
- [ ] Existing accessibility E2E (`accessibility.spec.ts`) and landing tests stay green.

## Tests

- **E2E:** extend/update the existing landing tests (pricing cards, meta tags via `page.evaluate` on `<head>`).
- **A11y:** `npm run test:e2e -- accessibility.spec.ts` must stay green after copy/layout changes.

## How to verify

```bash
# from apps/web
npx tsc --noEmit && npm run lint
npm run test:e2e -- accessibility.spec.ts
```
