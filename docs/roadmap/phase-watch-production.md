# Phase — Watch Production (D5c + D7)

> **Status:** implemented behind legal / feature gates · **Branch:** `feat/phase-4-watch-production`  
> **Date:** 2026-07-26

Two independent tracks that ship together:

| Track | Deliverable | Legal gate? |
| --- | --- | --- |
| **D7** CRA readiness | Scope assessment, reporting runbook, published-package SBOMs, contact-path consistency | No |
| **D5c** Prod Watch | Opt-in anon-key abuse-sequence monitor over customer Supabase logs (derived signals only) | **Yes** — see `docs/legal/DRAFT-prod-watch-privacy-terms-trust.md` |

## Feature flag

`ASSURLY_PROD_WATCH_ENABLED=1` enables D5c. Default is **off**. Do not enable in
production until legal sign-off on the draft Privacy / Terms / Trust text and
resolution of live-page legal-entity placeholders.

## Storage privacy

- Raw log lines: never persisted.
- IP addresses: never persisted (in any form).
- Retention of derived signals: **7 days** (`PROD_WATCH_SIGNAL_RETENTION_MS`).
- Opt-in per target; revoke purges credential + derived rows.

## Cron

`GET /api/cron/prod-watch` daily 06:15 UTC (after Guardian), `CRON_SECRET` auth.

## D5c is parked — what unblocks it

D5c is implemented and tested but is **not on `main`**. It lives on
`feat/phase-4-watch-production`. The code is sound; the credential model is not,
and that is upstream of everything else.

**The blocker.** The design asks the customer for a Supabase Management API
personal access token. The draft legal text calls this a "read-only credential".
No such credential exists — Supabase's own documentation states that *"scopes are
only available for OAuth apps"*. A PAT is account-wide: whoever holds it can
delete every project on that account. AES-256-GCM at rest protects against a
database breach, not against the scope of what the token permits.

Asking a pre-launch tool's customers — for a product whose Trust page correctly
states it holds no SOC 2 and no ISO 27001 — to hand over an account-wide
credential selects for the customers least able to judge the risk. That is the
wrong selection for a security product.

**Resolve in this order:**

1. **Verify a logs/analytics OAuth scope exists at all.** The published scope list
   (Auth, Database, Domains, Edge Functions, Environment, Organizations, Projects,
   Rest, Secrets, Storage) contains neither Analytics nor Logs. If none covers the
   log-analytics endpoint, the OAuth route is closed and D5c needs a different
   data source or should be dropped. Nothing else is worth doing before this
   answer.
2. Legal-entity placeholders resolved on the live Privacy and Terms pages, and
   counsel sign-off on `docs/legal/DRAFT-prod-watch-privacy-terms-trust.md`.
3. Evidence of real customer demand.

**Do not push `20260726120000_prod_watch.sql`.** If the credential model changes
from PAT to OAuth, `management_token_ciphertext` changes shape with it.

**What is not lost by waiting.** Canary tokens (Phase 3) already deliver
*confirmed* exposure — someone used a key they should not have — with no
credentials held and no processor relationship created. D5c offers an earlier but
weaker probabilistic signal at a materially higher cost. That trade may become
favourable at scale with an audit behind it. It is not favourable now.
