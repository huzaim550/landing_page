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
  status     text not null default 'pending',
  created_at timestamptz not null default now()
);

-- Migrations for installs created by an earlier version of this app:
--   * add the phone column,
--   * switch the status default to 'pending',
--   * relabel any legacy 'new' rows so they show up as pending in the admin.
alter table public.join_requests add column if not exists phone text;
alter table public.join_requests alter column status set default 'pending';
update public.join_requests set status = 'pending' where status = 'new';

create index if not exists join_requests_created_at_idx
  on public.join_requests (created_at desc);
