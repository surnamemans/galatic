-- Create table to store synced, per-token history payloads
create table if not exists histories (
  id uuid default gen_random_uuid() PRIMARY KEY,
  token text UNIQUE NOT NULL,
  payload jsonb,
  updated_at timestamptz
);
