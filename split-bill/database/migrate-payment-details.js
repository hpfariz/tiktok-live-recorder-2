const db = require('./db');

console.log('🔧 Adding payment_details table...');

try {
  // Create payment_details table
  db.exec(`
    CREATE TABLE IF NOT EXISTS payment_details (
      id TEXT PRIMARY KEY,
      participant_id TEXT NOT NULL,
      provider_name TEXT NOT NULL,
      account_number TEXT NOT NULL,
      is_primary INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_payment_details_participant 
      ON payment_details(participant_id);
  `);
  
  console.log('✅ payment_details table created successfully');
  console.log('✅ Index created successfully');
  
} catch (error) {
  if (error.message.includes('already exists')) {
    console.log('✅ payment_details table already exists, skipping');
  } else {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

console.log('\n✅ Migration complete!');