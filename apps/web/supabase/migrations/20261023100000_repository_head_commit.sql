-- The newest commit GitHub reported on the branch a repository ships from,
-- recorded from `push` webhook deliveries. A verdict is about one commit; when
-- this one differs, the code has changed since the check and a green card must
-- not read as the app's current state.
--
-- Written only by the webhook with the service role, so `authenticated` gets no
-- UPDATE grant. It already reads every column through the table-level SELECT.
alter table public.repositories
  add column if not exists head_commit_sha text,
  add column if not exists head_commit_at timestamptz;

alter table public.repositories
  drop constraint if exists repositories_head_commit_sha_format;
alter table public.repositories
  add constraint repositories_head_commit_sha_format
  check (head_commit_sha is null or head_commit_sha ~ '^[0-9a-f]{40,64}$');

notify pgrst, 'reload schema';
