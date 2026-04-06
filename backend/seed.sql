-- ============================================================
-- SubTracker — Supabase schema + seed data
-- Run this in the Supabase SQL editor (Dashboard → SQL Editor)
-- ============================================================

-- Enable UUID extension (already on by default in Supabase)
create extension if not exists "pgcrypto";

-- ── subscriptions ──────────────────────────────────────────
create table if not exists subscriptions (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  amount        numeric(12,2) not null,
  billing_cycle text not null default 'monthly'
                  check (billing_cycle in ('monthly','yearly','weekly')),
  due_day       int  not null check (due_day between 1 and 31),
  category      text not null default 'Other',
  created_at    timestamptz default now()
);

-- ── emis ───────────────────────────────────────────────────
create table if not exists emis (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  lender        text not null default '',
  amount        numeric(12,2) not null,
  total_months  int  not null,
  paid_months   int  not null default 0,
  due_day       int  not null check (due_day between 1 and 31),
  created_at    timestamptz default now()
);

-- ── credit_cards ───────────────────────────────────────────
create table if not exists credit_cards (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  bank          text not null default '',
  last4         text not null default '',
  outstanding   numeric(12,2) not null default 0,
  minimum_due   numeric(12,2) not null default 0,
  due_day       int  not null check (due_day between 1 and 31),
  note          text default '',
  created_at    timestamptz default now()
);

-- ── bank_accounts ──────────────────────────────────────────
create table if not exists bank_accounts (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  bank          text not null default '',
  balance       numeric(12,2) not null default 0,
  created_at    timestamptz default now()
);

-- ── receivables ────────────────────────────────────────────
create table if not exists receivables (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  source        text not null default '',
  amount        numeric(12,2) not null,
  expected_day  int  not null check (expected_day between 1 and 31),
  note          text default '',
  created_at    timestamptz default now()
);

-- ── capex_items ────────────────────────────────────────────
create table if not exists capex_items (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  amount        numeric(12,2) not null,
  category      text not null default 'Other',
  created_at    timestamptz default now()
);

-- ── rent (single-row config) ───────────────────────────────
create table if not exists rent_config (
  id            int  primary key default 1 check (id = 1),  -- enforces single row
  amount        numeric(12,2) not null default 0,
  due_day       int  not null default 1
);

-- ============================================================
-- Seed data — 10-Apr snapshot
-- ============================================================

insert into subscriptions (name, amount, billing_cycle, due_day, category) values
  ('Claude',     11000, 'monthly', 1, 'Dev Tools'),
  ('ElevenLabs',  2000, 'monthly', 1, 'Dev Tools'),
  ('Apple Dev',  10000, 'yearly',  1, 'Dev Tools'),
  ('Android Dev', 2400, 'yearly',  1, 'Dev Tools')
on conflict do nothing;

insert into credit_cards (name, bank, outstanding, minimum_due, due_day, note) values
  ('Axis Airtel',  'Axis', 10639,  10639,  13, '6,021 + 4,217 + 401'),
  ('Axis MyZone',  'Axis',    20,     20,  20, ''),
  ('SBI PhonePe',  'SBI',  14503,  14503,  24, ''),
  ('HDFC Diners',  'HDFC', 19839,  19839,  21, ''),
  ('HDFC Swiggy',  'HDFC',104853, 104853,  21, '103,253 billed + 1,600 unbilled')
on conflict do nothing;

insert into bank_accounts (name, bank, balance) values
  ('HDFC Bank', 'HDFC', 107500),
  ('Axis Bank', 'Axis', 124500),
  ('Cash',      'Cash',  34000)
on conflict do nothing;

insert into receivables (name, source, amount, expected_day, note) values
  ('Salary',  'Employer', 54117, 1,  ''),
  ('Di',      'Personal', 32639, 5,  '3,967 + 17,740 − 9,700 − 16,162 net pending'),
  ('Nischay', 'Personal',  5000, 5,  ''),
  ('Rishabh', 'Personal',  1500, 5,  ''),
  ('Jo',      'Personal',  1872, 5,  '')
on conflict do nothing;

insert into capex_items (name, amount, category) values
  ('Solar',       127000, 'Home'),
  ('AC',           35000, 'Home'),
  ('Donate',       60000, 'Personal'),
  ('Papa Mobile',  20000, 'Personal'),
  ('Claude',       11000, 'Dev Tools'),
  ('ElevenLabs',    2000, 'Dev Tools'),
  ('Apple Dev',    10000, 'Dev Tools'),
  ('Android Dev',   2400, 'Dev Tools')
on conflict do nothing;

insert into rent_config (id, amount, due_day) values (1, 13000, 1)
on conflict (id) do nothing;

-- snapshots table (history)
create table if not exists snapshots (
  id            uuid primary key default gen_random_uuid(),
  entity_type   text not null,
  entity_id     text not null,
  entity_name   text not null default '',
  field         text not null,
  old_value     text,
  new_value     text not null,
  snapshot_date date not null default current_date,
  created_at    timestamptz default now()
);
create index if not exists snapshots_entity_idx on snapshots (entity_type, entity_id);
create index if not exists snapshots_date_idx   on snapshots (snapshot_date desc);
create index if not exists snapshots_type_date  on snapshots (entity_type, snapshot_date desc);
