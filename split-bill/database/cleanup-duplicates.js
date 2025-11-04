const db = require('./db');

console.log('🧹 Removing duplicate payments...\n');

const bills = db.prepare('SELECT * FROM bills').all();
let totalRemoved = 0;

for (const bill of bills) {
  const payments = db.prepare('SELECT * FROM payments WHERE bill_id = ?').all(bill.id);
  
  const seen = {};
  for (const payment of payments) {
    const key = `${payment.payer_id}-${payment.amount}`;
    if (seen[key]) {
      db.prepare('DELETE FROM payments WHERE id = ?').run(payment.id);
      totalRemoved++;
      console.log(`  Removed duplicate: ${bill.title} - ${payment.amount}`);
    } else {
      seen[key] = payment;
    }
  }
}

console.log(`\n✅ Removed ${totalRemoved} duplicate payments`);