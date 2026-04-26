-- Per-tracker categories.
--
-- Each tracker owns its own category list (Food, Travel, Lodging, …) so a
-- group decides what makes sense for them. Categories are optional on
-- expenses; pre-existing rows have category_id NULL until edited.
--
-- Color is stored as a small palette token (one of ~8 named keys, e.g.
-- "violet", "emerald", "amber"). The frontend maps token → tailwind class
-- so we don't bake hex values into the DB.

CREATE TABLE IF NOT EXISTS tracker_categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tracker_id     UUID NOT NULL REFERENCES trackers(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  color       TEXT NOT NULL DEFAULT 'violet',
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tracker_id, name)
);

CREATE INDEX IF NOT EXISTS tracker_categories_trip_idx ON tracker_categories (tracker_id, position);

ALTER TABLE tracker_expenses
  ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES tracker_categories(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS tracker_expenses_category_idx ON tracker_expenses (category_id);
