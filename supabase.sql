-- Manzar — "request to join" storage.
-- Run this once in the Supabase SQL editor (Dashboard → SQL → New query).
-- The server talks to this table with the SERVICE ROLE key, which bypasses RLS,
-- so no policies are required for the admin flow to work.

create table if not exists public.join_requests (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  email      text not null,
  note       text,
  status     text not null default 'new',
  created_at timestamptz not null default now()
);

create index if not exists join_requests_created_at_idx
  on public.join_requests (created_at desc);
