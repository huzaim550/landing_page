-- Manzar — "request to join" storage.
-- Run this once in the Supabase SQL editor (Dashboard → SQL → New query).
-- The server talks to this table with the SERVICE ROLE key, which bypasses RLS,
-- so no policies are required for the admin flow to work.

-- A request moves through: pending -> approved / rejected / onboarded.
create table if not exists public.join_requests (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  email      text not null,
  phone      text not null,
  note       text,
  ip         text,
  status     text not null default 'pending',
  created_at timestamptz not null default now()
);

-- Migrations for installs created by an earlier version of this app:
--   * add the phone / ip columns,
--   * switch the status default to 'pending',
--   * relabel any legacy 'new' rows so they show up as pending in the admin.
alter table public.join_requests add column if not exists phone text;
alter table public.join_requests add column if not exists ip text;
alter table public.join_requests alter column status set default 'pending';
update public.join_requests set status = 'pending' where status = 'new';

-- Lock the table down. New tables created via SQL do NOT have RLS enabled,
-- which means the public anon key could otherwise read every row (name, email,
-- phone). Enabling RLS with no policies blocks anon/authenticated access while
-- the server's SERVICE ROLE key keeps working (it bypasses RLS).
alter table public.join_requests enable row level security;

-- Indexes: created_at for the admin list; email/phone/ip for the rate-limit
-- lookups the server runs on every submission.
create index if not exists join_requests_created_at_idx on public.join_requests (created_at desc);
create index if not exists join_requests_email_idx on public.join_requests (email);
create index if not exists join_requests_phone_idx on public.join_requests (phone);
create index if not exists join_requests_ip_idx on public.join_requests (ip);
