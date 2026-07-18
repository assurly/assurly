# Assurly — Exit Narrative & Asset Summary

> **Purpose:** A one-sitting, acquirer-legible summary of what Assurly is, what makes it
> defensible, and the assets a strategic buyer acquires. Companion to the strategy in
> [`10-genius-rebuild-master-plan.md`](./10-genius-rebuild-master-plan.md).
>
> **Audience:** A strategic buyer (Supabase, Vercel, or an AI builder such as Lovable/Bolt) and
> their technical diligence team.
>
> **Owner:** Tibor Kútik · **Created:** 2026-07-18 (Phase 8)

---

## 1. The one-line thesis

Assurly is the **proof-based trust layer for AI-built apps** — it answers, on one glance and always
current: _"Can I ship my live app right now without leaking data?"_ The buyer is a non-technical
founder who had their SaaS built by AI, has paying users, and cannot read a diff. We sell them
**proof and sleep**, not a findings table.

## 2. Why it is defensible (the moat)

The commoditizable part of security scanning (a fixed rulebook) is exactly what an LLM makes free.
Assurly's durable asset is elsewhere: a **proprietary corpus of how AI-generated apps
characteristically fail and which fixes actually closed the hole, verified at runtime.**

- Every scan captures the **AI builder fingerprint** (Lovable / v0 / Bolt / Cursor / Replit).
- Every fix is re-probed after deploy and recorded as `verified_fixed`, `still_open`, or
  `regressed` — a real runtime outcome, not a claim.
- The corpus grows as AI writes more code, and a chat-with-your-repo tool structurally cannot
  produce it, because it never runs the app or verifies the fix at runtime.

The corpus is **aggregate and privacy-safe by construction**: the exit metrics read
`(generator_fingerprint, finding_rule_id, fix_strategy, outcome)` only — never a finding message,
table name, PII, org/target id, or any per-customer row.

## 3. What a buyer acquires

1. **The AI-failure + verified-fix dataset** — the corpus above, the non-replicable asset.
2. **The trust brand in this segment** — the public "Verified by Assurly · Ship Score N/100" badge
   and shareable trust page (`report/[token]`), a built-in distribution loop where every guarded app
   markets Assurly.
3. **Distribution into where code is born** — the keyed verdict API (`GET /api/v1/verdict`), the
   `assurly_verdict` MCP ship-gate tool that AI agents call before deploy, and a white-label OEM
   widget for platforms to embed.

## 4. Product surface (already built and live-verified)

| Pillar                    | What it does                                                            | Status |
| ------------------------- | ----------------------------------------------------------------------- | ------ |
| Verdict object            | One persistent "is this app safe right now" per app                     | Live   |
| Proof-first probe         | Real, redacted runtime proof-of-exploit (RLS row-pull, exposed secrets) | Live   |
| Ownership gate            | Active probing only against apps the user provably owns; never mutating | Live   |
| AI red-team + deep review | Adaptive, ownership-gated probe planning + Layer 2 reasoning (paid)     | Live   |
| Verified-fix loop         | found → fix → deploy → auto re-probe → "VERIFIED FIXED" (+ corpus row)  | Live   |
| Continuous Guardian       | Daily + on-deploy re-probe; low-noise regression alerts                 | Live   |
| Agent/OEM distribution    | Keyed verdict API + MCP tool + white-label widget                       | Live   |

## 5. Monetization

- **Free** — the viral proof-probe + one guarded app. Top of funnel.
- **Pro** (per-app subscription) — continuous Guardian, AI deep review, verified badge, auto-fix PRs,
  regression alerts, private repos. "Founder pays for sleep."
- **OEM / Platform** (usage/seat) — the B2B2C keyed verdict API, MCP ship-gate, and white-label
  widget. The real revenue and exit lever.

Entitlements are **enforced server-side** (`utils/entitlements.ts` + `secureRoute`): the guarded-app
limit, API-key rate tier, and AI deep-review access are all derived from the org's plan and rejected
at the route, never merely hidden in the UI.

## 6. The metrics that tell the story

The internal exit-metrics surface (`GET /api/internal/metrics`, secret-gated) renders aggregate KPIs
straight from the corpus:

- **Apps monitored** — reach.
- **Corpus size** — the size of the moat, broken down by AI generator and by rule.
- **Fixes verified** and **regressions caught** — proof the loop works at runtime.
- **Verified-fix rate** — `verified_fixed / (verified_fixed + regressed)`, the headline quality
  number.

Every field is a count over pattern columns. No customer data can appear — this is asserted by the
same shape-only tests used for the public trust surface.

## 7. Security & compliance summary

Least-privilege, org-scoped Row-Level Security on every table; API keys stored hash-only;
non-mutating, ownership-gated, SSRF-safe probing; PII redacted at the scanner before storage or
display. The public posture is documented on the [Trust & Security page](/trust) and the
[Privacy Policy](/privacy). No new data collection was introduced to package the company.
