create table public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  note text not null default 'FAKE DATA — Assurly live test target'
);

insert into public.customers (name, email) values
  ('FAKE DATA — Ada Example', 'ada.fake@example.com'),
  ('FAKE DATA — Ben Example', 'ben.fake@example.com'),
  ('FAKE DATA — Cara Example', 'cara.fake@example.com');
