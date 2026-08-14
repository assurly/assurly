-- Allow authenticated members to persist scan_capability after Instant Gate fail-fast.
-- Column-level UPDATE mirrors organizations (github_* only): no blanket table UPDATE.
-- RLS: members may update (API uses requireRepositoryAccess = org member).

grant update (scan_capability)
on table public.repositories
to authenticated;

drop policy if exists update_repository_scan_capability_member on public.repositories;
create policy update_repository_scan_capability_member on public.repositories
for update to authenticated
using (private.is_organization_member(organization_id))
with check (private.is_organization_member(organization_id));

-- Ensure PostgREST sees the new column privileges promptly.
notify pgrst, 'reload schema';
