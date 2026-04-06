-- ── Snapshots / History table ─────────────────────────────────────────────
-- Records every value change with the date it happened.
-- entity_type: 'subscription' | 'emi' | 'credit_card' | 'bank_account'
--              | 'receivable' | 'capex_item' | 'rent'
-- field:       the column that changed (e.g. 'balance', 'outstanding')
-- old_value / new_value: stored as text (cast on read)
-- snapshot_date: defaults to today; can be overridden for backdated entries

create table if not exists snapshots (
  id            uuid primary key default gen_random_uuid(),
  entity_type   text not null,
  entity_id     text not null,          -- uuid of the changed record
  entity_name   text not null default '',
  field         text not null,
  old_value     text,
  new_value     text not null,
  snapshot_date date not null default current_date,
  created_at    timestamptz default now()
);

create index if not exists snapshots_entity_idx  on snapshots (entity_type, entity_id);
create index if not exists snapshots_date_idx    on snapshots (snapshot_date desc);
create index if not exists snapshots_type_date   on snapshots (entity_type, snapshot_date desc);
