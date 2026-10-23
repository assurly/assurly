-- Already applied on the remote project as version 20261023075329.
-- This file exists so local migration history matches that remote version.
-- The same statements also live in 20261023100000_repository_head_commit.sql
-- and are idempotent.
alter table public.repositories
  add column if not exists head_commit_sha text,
  add column if not exists head_commit_at timestamptz;

alter table public.repositories
  drop constraint if exists repositories_head_commit_sha_format;
alter table public.repositories
  add constraint repositories_head_commit_sha_format
  check (head_commit_sha is null or head_commit_sha ~ '^[0-9a-f]{40,64}$');

notify pgrst, 'reload schema';
