-- Your apps hygiene (launch P0):
-- 1) Allow org members to DELETE a target they can already select/update.
-- 2) Remove unverified `url` probe leftovers that were auto-created by every
--    authenticated /api/scan-url call (mail.google.com, random sites, etc.).
--    Explicit "Guard this URL" recreates a row when the user wants one.
--    Verified URL targets and all repo targets are preserved.
--
-- Child rows cascade via existing FKs (alert prefs, canaries, fix outcomes).
-- Additive and idempotent.

drop policy if exists delete_target_member on public.targets;

create policy delete_target_member on public.targets
for delete to authenticated
using (private.is_organization_member(organization_id));

grant delete on table public.targets to authenticated;

-- One-shot cleanup of auto-upserted probe noise.
delete from public.targets
where kind = 'url'
  and ownership_verified = false;
