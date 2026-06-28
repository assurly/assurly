CREATE TABLE users (
  id uuid primary key,
  email text
);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
