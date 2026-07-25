# Runbook: Live verification of `fix_outcome` writes

Supervised check that a **real** Vercel deploy webhook or Guardian cron run
persists a `fix_outcome` row for an owned URL target. Intended for the throwaway
Supabase dogfood project — not production customer data.

Do **not** commit secrets. Read credentials only from your local env / password
manager; this runbook never embeds them.

---

## 1. Prerequisites

### Projects

| Piece              | What to use                                                                                                                      |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Assurly app        | Your local or preview deployment of `apps/web` with admin DB access to the **dogfood** Supabase project                          |
| Dogfood target URL | A throwaway app you control (e.g. a Vercel preview/production URL) with a reachable origin                                       |
| Tables             | `public.targets`, `public.fix_outcome`, `private.vercel_webhook_deliveries` (migration `20260716000000_fix_outcome.sql` applied) |

### Environment variables (Assurly app)

| Variable                                                                  | Role                                                                                   |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL` / service-role key used by `getAdminDbAdapter` | Admin reads/writes for targets + `fix_outcome`                                         |
| `VERCEL_WEBHOOK_SECRET`                                                   | HMAC verification for `POST /api/vercel/webhook`                                       |
| `CRON_SECRET`                                                             | Bearer secret for `GET /api/cron/guardian`                                             |
| `ANTHROPIC_API_KEY` (optional)                                            | Only if you want the active AI planner path; deterministic probes still run without it |

### Target row (dogfood)

The URL target must exist and be **ownership-verified**:

```sql
select id, organization_id, kind, identifier, ownership_verified, generator_fingerprint
from public.targets
where kind = 'url'
  and identifier = 'https://YOUR-DOGFOOD-ORIGIN';  -- exact origin, no path
```

Required: `kind = 'url'`, `ownership_verified = true`. If false, stop and complete
ownership verification (meta tag / DNS / well-known file) first — active probes
and outcome writes are gated on that.

Note the `id` (target UUID) for later queries.

---

## 2. Force the "broken" state

Goal: the live probe reports rule `runtime-supabase-rls-open` (or another
error-severity runtime rule you expect).

Typical dogfood approach:

1. On the dogfood app, leave a public Supabase table with RLS disabled (or
   restore a known-open config you used in Phase 5 dogfood).
2. Confirm Assurly sees it: dashboard URL scan or
   `POST /api/targets/<target_id>/reprobe` while signed in → finding present.
3. Seed / confirm baseline in `fix_outcome` (first observation writes
   `still_open`):

```sql
select finding_rule_id, outcome, deploy_id, created_at
from public.fix_outcome
where target_id = '<TARGET_UUID>'
order by created_at asc;
```

You want the **latest** row for that rule to be `still_open` or `regressed`
before the "fixed" step.

---

## 3. Force the "fixed" state

1. Enable RLS (or otherwise remove the open finding) on the dogfood app.
2. Redeploy so the live origin reflects the fix (webhook path), **or** leave the
   deploy alone and use cron/on-demand reprobe only.

---

## 4. Trigger each entry point

### A) Deploy webhook (`POST /api/vercel/webhook`)

1. Ensure the Vercel project for the dogfood app has a deploy webhook pointing at
   `https://<ASSURLY_HOST>/api/vercel/webhook` with the same secret as
   `VERCEL_WEBHOOK_SECRET`.
2. Ship a production (or otherwise origin-matching) deploy of the **fixed** app.
   Handled event types: `deployment.succeeded`, `deployment.promoted`,
   `deployment-ready`.
3. Confirm Assurly accepted the delivery (HTTP 202). Duplicate deliveries for the
   same `deploy_id` are claimed once (`private.vercel_webhook_deliveries`).

Manual alternative (signed body) if you cannot wait for Vercel:

```bash
# BODY must be the exact bytes you sign. Replace deploy id + URL with yours.
BODY='{"type":"deployment.succeeded","payload":{"deployment":{"id":"dpl_DOGFOOD_1","url":"YOUR-DOGFOOD-HOST"},"url":"YOUR-DOGFOOD-HOST"}}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha1 -hmac "$VERCEL_WEBHOOK_SECRET" | awk '{print $2}')

curl -sS -X POST "https://<ASSURLY_HOST>/api/vercel/webhook" \
  -H "content-type: application/json" \
  -H "x-vercel-signature: $SIG" \
  -d "$BODY"
```

Re-probe work runs in Next.js `after()` — wait a few seconds before querying.

### B) Guardian cron (`GET /api/cron/guardian`)

```bash
curl -sS "https://<ASSURLY_HOST>/api/cron/guardian" \
  -H "authorization: Bearer $CRON_SECRET"
```

Expect JSON like `{ "checked": N, "skipped": ..., "alerted": ..., "errors": 0 }`.
Missing/wrong secret → `401` and **zero** DB/probe work.

---

## 5. Confirm the expected row

### After broken → fixed (expect `verified_fixed`)

```sql
select id, finding_rule_id, outcome, deploy_id, pr_url, fix_strategy, created_at
from public.fix_outcome
where target_id = '<TARGET_UUID>'
  and finding_rule_id = 'runtime-supabase-rls-open'
order by created_at desc
limit 5;
```

Latest row should be `outcome = 'verified_fixed'`. If the trigger was the deploy
webhook, `deploy_id` should match the Vercel deployment id.

### Optional: still_open / regressed

| Setup                                                             | Trigger                                  | Expected latest `outcome`                                                              |
| ----------------------------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------- |
| Latest was open (`still_open`/`regressed`), finding still present | webhook or cron                          | no new row (state-change dedupe) **or** `still_open` if transitioning from `regressed` |
| No prior row, finding present                                     | webhook, cron, or authenticated URL scan | `still_open` (baseline)                                                                |
| Latest was `verified_fixed`, finding present again                | webhook or cron                          | `regressed`                                                                            |

### Ownership negative (Trust-page promise)

With `ownership_verified = false` on the same URL target:

- Cron candidate list excludes it (`listVerifiedUrlTargets`); a forced check skips
  with `ownership_gate`.
- Webhook `findVerifiedUrlTargetByOrigin` only matches verified urls →
  `"No matching guarded app."`
- On-demand `POST /api/targets/<id>/reprobe` → `403 ownership_required`.

Confirm:

```sql
-- After an unverified attempt, count must not increase for active-probe writes.
select count(*) from public.fix_outcome where target_id = '<TARGET_UUID>';
```

---

## 6. Reset to a clean state

Run only against the **dogfood** project.

```sql
-- Optional: clear outcome corpus for this target
delete from public.fix_outcome
where target_id = '<TARGET_UUID>';

-- Optional: clear webhook idempotency claims for dogfood deploys you minted
delete from private.vercel_webhook_deliveries
where target_id = '<TARGET_UUID>';

-- Optional: reset verdict freshness (keeps the target + ownership)
update public.targets
set current_verdict = null,
    current_ship_score = null,
    verdict_evidence = null,
    last_checked_at = null
where id = '<TARGET_UUID>';
```

Re-enable or leave dogfood RLS in whatever default you use for the next session.
Do not delete the `targets` row unless you also intend to re-verify ownership.

---

## 7. Pass / fail

| Check                                                      | Pass |
| ---------------------------------------------------------- | ---- |
| Webhook or cron ran without 401/5xx                        | yes  |
| Latest `fix_outcome` for the rule matches the scenario     | yes  |
| Unverified target produced no new active-probe outcome row | yes  |

If the probe ran and the finding transitioned but **no row** appeared, treat that
as a wiring failure — the same class of bug as a rule that exists but is never
registered.
