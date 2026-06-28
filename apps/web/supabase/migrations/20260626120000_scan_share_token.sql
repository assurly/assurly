alter table public.scans
  add column if not exists share_token text;

create unique index if not exists scans_share_token_uidx
  on public.scans (share_token)
  where share_token is not null;
