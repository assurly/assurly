-- Allow an org member to permanently delete a revoked canary token.
--
-- Revocation is a soft flag (`revoked_at`) so the audit trail survives, but
-- revoked rows accumulate with no prune path. This adds a scoped DELETE policy
-- so an authenticated member can remove a canary they can already manage,
-- reusing the same `private.is_organization_member(organization_id)` predicate
-- as the existing canary_tokens select/insert/update policies
-- (20260726090100_canary_tokens).
--
-- Child `canary_token_hits` rows cascade-delete with the parent
-- (`ON DELETE CASCADE` on canary_token_id). The application still refuses to
-- delete a *live* (non-revoked) canary — revoke remains a deliberate first
-- step. RLS only scopes the tenant; the active-token guard lives in the
-- DELETE route handler.
--
-- Additive and idempotent so it is safe to re-run.

drop policy if exists delete_canary_token_member on public.canary_tokens;

create policy delete_canary_token_member on public.canary_tokens
  for delete to authenticated
  using (private.is_organization_member(organization_id));

grant delete on table public.canary_tokens to authenticated;
