-- Defense in depth: match private.stripe_webhook_events. The table is not in an
-- exposed schema and has no grants to anon/authenticated; RLS still blocks a
-- future accidental expose.
alter table private.stripe_trial_card_fingerprints enable row level security;
