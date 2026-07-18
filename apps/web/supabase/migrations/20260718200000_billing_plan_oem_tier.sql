-- Phase 8: the OEM/platform billing tier.
--
-- Adds 'oem' to the plan enum for the B2B2C keyed-verdict API (usage/seat). The
-- tier is kept in sync across three places (Phase 8 convention):
--   1. these DB checks (organizations.billing_plan, api_keys.plan),
--   2. utils/entitlements.ts (entitlementsForPlan),
--   3. utils/apiSecurity.ts (apiKeyRateLimitForPlan).
--
-- Stripe only ever moves an org between 'free' and 'pro' (utils/stripeBilling.ts
-- planForStatus); 'oem' is provisioned by the owner out of band, never from a
-- webhook — so no Stripe/product change is implied by this migration.
--
-- Additive + idempotent per convention §3.2 (drop-if-exists then add). No new
-- table, so no new RLS is required; both tables already have org-scoped RLS.

-- organizations.billing_plan shipped as TEXT with no DB-level check (a TS-only
-- enum). Add an explicit check now so 'oem' is allowed and anything else is
-- rejected at the database boundary — defense in depth for the load-bearing plan.
alter table public.organizations
  drop constraint if exists organizations_billing_plan_check;
alter table public.organizations
  add constraint organizations_billing_plan_check
  check (billing_plan in ('free', 'pro', 'oem'));

-- api_keys.plan already had check (plan in ('free','pro')). Widen it to include 'oem'.
alter table public.api_keys
  drop constraint if exists api_keys_plan_check;
alter table public.api_keys
  add constraint api_keys_plan_check
  check (plan in ('free', 'pro', 'oem'));
