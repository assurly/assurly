-- Missing ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE TABLE users (
  id uuid primary key,
  email text
);

ALTER TABLE users ADD COLUMN api_key TEXT NOT NULL;
