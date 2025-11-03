const db = require('./db');
const fs = require('fs');
const path = require('path');

function cleanupExpiredBills() {
  const now = Date.now();
  
  console.log('🧹 Running cleanup for expired bills...');
  
  try {
    // Get expired bills with receipt images
    const expiredBills = db.prepare(`
      SELECT r.image_path 
      FROM receipts r
      JOIN bills b ON r.bill_id = b.id
      WHERE b.expires_at < ?
    `).all(now);
    
    // Delete receipt image files
    let deletedFiles = 0;
    for (const receipt of expiredBills) {
      if (receipt.image_path) {
        const fullPath = path.join(__dirname, '..', receipt.image_path);
        try {
          if (fs.existsSync(fullPath)) {
            fs.unlinkSync(fullPath);
            deletedFiles++;
          }
        } catch (err) {
          console.error(`Failed to delete file ${fullPath}:`, err.message);
        }
      }
    }
    
    // Delete expired bills from database (cascades to all related tables)
    const result = db.prepare('DELETE FROM bills WHERE expires_at < ?').run(now);
    
    console.log(`✅ Cleanup complete: ${result.changes} bills deleted, ${deletedFiles} files removed`);
  } catch (error) {
    console.error('❌ Cleanup error:', error);
  }
}

// Run cleanup every hour
function startCleanupSchedule() {
  cleanupExpiredBills(); // Run immediately on start
  setInterval(cleanupExpiredBills, 60 * 60 * 1000); // Every hour
  console.log('✅ Cleanup scheduler started (runs every hour)');
}

module.exports = { cleanupExpiredBills, startCleanupSchedule };