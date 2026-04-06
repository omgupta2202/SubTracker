-- Add last4 digits field to credit_cards
-- Run in Supabase SQL Editor

alter table credit_cards
  add column if not exists last4 text not null default '';
