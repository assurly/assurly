-- Create users table
create table users (
  id uuid primary key,
  email text unique,
  created_at timestamp with time zone
);

-- Create orders table
create table orders (
  id uuid primary key,
  user_id uuid references users(id),
  total decimal,
  status text
);

-- Forgot to enable RLS on both tables!
