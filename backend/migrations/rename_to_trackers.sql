-- Rename "trackers" feature to "trackers" everywhere.
--
-- The product was originally called "Trackers". It was rebranded to
-- "Expense Tracker" because the same machinery handles trackers, daily
-- household expenses, dinner clubs, etc. Old tables/columns retained
-- "tracker" naming for stability — this migration finishes the cleanup so
-- nothing in the schema references "tracker" anymore.

ALTER TABLE IF EXISTS trackers                    RENAME TO trackers;
ALTER TABLE IF EXISTS tracker_members             RENAME TO tracker_members;
ALTER TABLE IF EXISTS tracker_expenses            RENAME TO tracker_expenses;
ALTER TABLE IF EXISTS tracker_expense_splits      RENAME TO tracker_expense_splits;
ALTER TABLE IF EXISTS tracker_expense_payments    RENAME TO tracker_expense_payments;
ALTER TABLE IF EXISTS tracker_categories          RENAME TO tracker_categories;

ALTER TABLE IF EXISTS tracker_members          RENAME COLUMN tracker_id TO tracker_id;
ALTER TABLE IF EXISTS tracker_expenses         RENAME COLUMN tracker_id TO tracker_id;
ALTER TABLE IF EXISTS tracker_categories       RENAME COLUMN tracker_id TO tracker_id;
