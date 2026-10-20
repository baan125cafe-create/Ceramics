-- Shop database (Cloudflare D1, which is SQLite). One database for both shops:
-- every row carries its shop ("baan" or "chud").
-- Column names match the Google Sheet headers, so imported rows look the same
-- and the app reads them unchanged.
-- Safe to run more than once: nothing here drops or changes existing rows.

CREATE TABLE IF NOT EXISTS products (
  shop        TEXT NOT NULL,
  id          TEXT NOT NULL,
  name        TEXT NOT NULL DEFAULT '',
  size        TEXT NOT NULL DEFAULT '',
  note        TEXT NOT NULL DEFAULT '',   -- ChudPak's sheet uses this for size or colour
  costPrice   REAL NOT NULL DEFAULT 0,
  sellPrice   REAL NOT NULL DEFAULT 0,
  quantity    INTEGER NOT NULL DEFAULT 0,
  imageUrl    TEXT NOT NULL DEFAULT '',
  addedBy     TEXT NOT NULL DEFAULT '',
  createdAt   TEXT NOT NULL DEFAULT '',
  archived    TEXT,                       -- when it was removed; NULL = on sale
  notForSale  INTEGER NOT NULL DEFAULT 0, -- 1 = owner keeps it in inventory but it can't be sold
  PRIMARY KEY (shop, id)
);

CREATE TABLE IF NOT EXISTS sales (
  shop          TEXT NOT NULL,
  id            TEXT NOT NULL,
  productId     TEXT NOT NULL DEFAULT '',
  productName   TEXT NOT NULL DEFAULT '',
  quantity      INTEGER NOT NULL DEFAULT 1,
  sellPrice     REAL NOT NULL DEFAULT 0,
  total         REAL NOT NULL DEFAULT 0,
  costPrice     REAL,                     -- cost at the time of sale; NULL on rows from the sheet
  paymentMethod TEXT NOT NULL DEFAULT '',
  saleDate      TEXT NOT NULL DEFAULT '', -- YYYY-MM-DD, Bangkok time
  soldBy        TEXT NOT NULL DEFAULT '',
  createdAt     TEXT NOT NULL DEFAULT '',
  note          TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (shop, id)
);
CREATE INDEX IF NOT EXISTS sales_by_date ON sales (shop, saleDate);

-- Staff names, "running low" level, sign-out generation.
CREATE TABLE IF NOT EXISTS settings (
  shop  TEXT NOT NULL,
  key   TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (shop, key)
);

-- Sign-in passes. Only a scrambled form of each pass is stored.
CREATE TABLE IF NOT EXISTS passes (
  tokenHash TEXT PRIMARY KEY,
  shop      TEXT NOT NULL,
  role      TEXT NOT NULL,
  expires   INTEGER NOT NULL,
  epoch     INTEGER NOT NULL
);

-- Wrong-PIN counter and pause, per shop.
CREATE TABLE IF NOT EXISTS login_state (
  shop  TEXT PRIMARY KEY,
  fails INTEGER NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 0,
  until INTEGER NOT NULL DEFAULT 0
);
