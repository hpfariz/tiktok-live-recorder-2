const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Ensure database directory exists
const dbDir = path.join(__dirname, '../data');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(path.join(dbDir, 'splitbill.db'));

// Enable foreign keys
db.pragma('foreign_keys = ON');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS bills (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    currency_symbol TEXT DEFAULT '$',
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    mode TEXT NOT NULL CHECK(mode IN ('single', 'multi'))
  );

  CREATE TABLE IF NOT EXISTS receipts (
    id TEXT PRIMARY KEY,
    bill_id TEXT NOT NULL,
    image_path TEXT,
    ocr_data TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (bill_id) REFERENCES bills(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY,
    receipt_id TEXT NOT NULL,
    name TEXT NOT NULL,
    price REAL NOT NULL,
    is_tax_or_charge INTEGER DEFAULT 0,
    charge_type TEXT,
    item_order INTEGER DEFAULT 0,
    FOREIGN KEY (receipt_id) REFERENCES receipts(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS participants (
    id TEXT PRIMARY KEY,
    bill_id TEXT NOT NULL,
    name TEXT NOT NULL,
    FOREIGN KEY (bill_id) REFERENCES bills(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS item_splits (
    id TEXT PRIMARY KEY,
    item_id TEXT NOT NULL,
    participant_id TEXT NOT NULL,
    split_type TEXT NOT NULL CHECK(split_type IN ('equal', 'fixed', 'percent')),
    value REAL NOT NULL,
    FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
    FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    bill_id TEXT NOT NULL,
    payer_id TEXT NOT NULL,
    amount REAL NOT NULL,
    FOREIGN KEY (bill_id) REFERENCES bills(id) ON DELETE CASCADE,
    FOREIGN KEY (payer_id) REFERENCES participants(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS tax_distribution (
    id TEXT PRIMARY KEY,
    item_id TEXT NOT NULL,
    distribution_type TEXT NOT NULL CHECK(distribution_type IN ('equal', 'proportional', 'custom', 'none')),
    custom_data TEXT,
    FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_bills_expires ON bills(expires_at);
  CREATE INDEX IF NOT EXISTS idx_receipts_bill ON receipts(bill_id);
  CREATE INDEX IF NOT EXISTS idx_items_receipt ON items(receipt_id);
  CREATE INDEX IF NOT EXISTS idx_participants_bill ON participants(bill_id);
  CREATE INDEX IF NOT EXISTS idx_item_splits_item ON item_splits(item_id);
  CREATE INDEX IF NOT EXISTS idx_payments_bill ON payments(bill_id);
`);

console.log('✅ Database initialized successfully');

module.exports = db;