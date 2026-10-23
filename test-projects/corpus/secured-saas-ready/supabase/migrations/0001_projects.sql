create table public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

alter table public.projects enable row level security;

create policy "Owners read their projects"
  on public.projects for select
  to authenticated
  using ((select auth.uid()) = owner_id);

create policy "Owners create their projects"
  on public.projects for insert
  to authenticated
  with check ((select auth.uid()) = owner_id);

-- Written only by the Stripe webhook with the service role; no client access.
create table public.stripe_events (
  id text primary key,
  type text not null,
  processed_at timestamptz not null default now()
);

alter table public.stripe_events enable row level security;
