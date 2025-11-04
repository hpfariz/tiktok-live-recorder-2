const db = require('./db');

console.log('Adding receipt_id column to payments table...');

try {
  db.exec('ALTER TABLE payments ADD COLUMN receipt_id TEXT;');
  db.exec('CREATE INDEX IF NOT EXISTS idx_payments_receipt ON payments(receipt_id);');
  console.log('✅ Migration complete!');
} catch (error) {
  if (error.message.includes('duplicate column')) {
    console.log('✅ Column already exists, skipping');
  } else {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}