-- Inventory history: one row each time pieces are added (new product, "+ Add"
-- restock) or the count is corrected in Edit product. Owner only.
-- Only adds a new table and index: no existing row changes.
-- Run once per database, before deploying the code that writes to it:
--   npm run db:migrate:remote   (and db:migrate:local for the local copy)
CREATE TABLE IF NOT EXISTS stock_log (
  shop          TEXT NOT NULL,
  id            TEXT NOT NULL,
  productId     TEXT NOT NULL,
  kind          TEXT NOT NULL,              -- 'added' (new product), 'restock' (+ Add), 'corrected' (count changed in Edit)
  delta         INTEGER NOT NULL,           -- pieces added (negative when a correction lowers the count)
  quantityAfter INTEGER,                    -- count on the shelf right after
  costPrice     REAL,                       -- cost per piece entered with a restock, if any
  addedBy       TEXT NOT NULL DEFAULT '',
  createdAt     TEXT NOT NULL,
  PRIMARY KEY (shop, id)
);
CREATE INDEX IF NOT EXISTS stock_log_by_product ON stock_log (shop, productId, createdAt);
