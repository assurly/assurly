-- The Stripe event ledger is an internal server concern and must not be in an
-- API-exposed schema. The RPC remains the only supported write boundary.
alter table public.stripe_webhook_events set schema private;
