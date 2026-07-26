-- npm package metadata cache for the PR dependency-provenance guard.
--
-- Why: every PR that adds dependencies must look up registry.npmjs.org and
-- api.npmjs.org. Without a TTL cache, a busy org re-fetches the same twenty
-- packages all day and burns npm rate limits (and webhook latency budget).
--
-- Columns include version_count + has_repository for the slopsquat "abandoned
-- shape" signal (exactly one published version and no repository field) —
-- both are read from the registry document already fetched; no extra request.
--
-- Security model:
--   * Keys are package names only — never repo content, never secrets.
--   * Rows are global (not org-scoped): registry metadata is public facts.
--   * RLS is enabled with NO authenticated policies — only the service role
--     (webhook path via getAdminDbAdapter) can read/write. Authenticated
--     clients must never query this table.
--   * TTL is enforced in application code (~24h for both metadata and downloads).
--
-- Additive + idempotent per migration convention.

create table if not exists public.npm_package_cache (
  -- Lowercased package name (scoped names keep the @scope/ prefix).
  package_name text primary key
    check (char_length(package_name) between 1 and 214),

  -- null = never published (registry 404). true/false otherwise.
  exists_on_registry boolean,

  -- registry document `time.created` (UTC). null when unknown / 404.
  created_at_registry timestamptz,

  -- Weekly download count from api.npmjs.org. null when unavailable.
  weekly_downloads integer
    check (weekly_downloads is null or weekly_downloads >= 0),

  -- Number of keys in the registry document's `versions` object.
  version_count integer
    check (version_count is null or version_count >= 0),

  -- Whether the registry document has a non-null `repository` field.
  has_repository boolean,

  -- When metadata (exists + created_at + shape) was last refreshed.
  metadata_fetched_at timestamptz not null default timezone('utc', now()),

  -- When download counts were last refreshed (may lag metadata).
  downloads_fetched_at timestamptz,

  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.npm_package_cache enable row level security;

-- No policies for authenticated/anon — service role only.
-- Explicit revoke so a future grant cannot silently open the table.
revoke all on table public.npm_package_cache from authenticated, anon;

create index if not exists npm_package_cache_metadata_fetched_at_idx
  on public.npm_package_cache (metadata_fetched_at);
