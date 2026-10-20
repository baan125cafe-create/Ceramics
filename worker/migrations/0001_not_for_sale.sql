-- Adds the "Not for sale" flag to products (owner-only setting).
-- Only adds a column: every existing product gets 0 (for sale, as now). No rows change.
-- Run once per database: npm run db:migrate:remote (and db:migrate:local for the local copy).
-- Running it a second time fails harmlessly with "duplicate column name".
ALTER TABLE products ADD COLUMN notForSale INTEGER NOT NULL DEFAULT 0;
