-- Allow an org member to permanently delete a revoked API key.
--
-- Revocation is a soft flag (`revoked_at`) so the audit trail survives, but
-- revoked rows accumulate with no prune path. This adds a scoped DELETE policy
-- so an authenticated member can remove a key they can already manage, reusing
-- the same `private.is_organization_member(organization_id)` predicate as the
-- existing api_keys select/insert/update policies (20260718100000_api_keys).
--
-- The application still refuses to delete a *live* (non-revoked) key — revoke
-- remains a deliberate first step. RLS only scopes the tenant; the active-key
-- guard lives in the DELETE route handler.
--
-- Additive and idempotent so it is safe to re-run.

drop policy if exists delete_api_key_member on public.api_keys;

create policy delete_api_key_member on public.api_keys
  for delete to authenticated
  using (private.is_organization_member(organization_id));

grant delete on table public.api_keys to authenticated;
