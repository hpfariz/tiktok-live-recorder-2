const express = require('express');
const router = express.Router();
const db = require('../database/db');

// Calculate settlements for a bill
router.get('/:billId', (req, res) => {
  const { billId } = req.params;
  
  try {
    const bill = db.prepare('SELECT * FROM bills WHERE id = ?').get(billId);
    
    if (!bill) {
      return res.status(404).json({ error: 'Bill not found' });
    }
    
    const participants = db.prepare('SELECT * FROM participants WHERE bill_id = ?').all(billId);
    const receipts = db.prepare('SELECT * FROM receipts WHERE bill_id = ?').all(billId);
    
    // Calculate what each person owes and paid
    const balances = {}; // participantId -> { name, owes, paid, balance }
    
    for (const p of participants) {
      balances[p.id] = {
        id: p.id,
        name: p.name,
        owes: 0,
        paid: 0,
        balance: 0
      };
    }
    
    // Calculate what each person owes from items
    for (const receipt of receipts) {
      const items = db.prepare('SELECT * FROM items WHERE receipt_id = ?').all(receipt.id);
      
      for (const item of items) {
        const splits = db.prepare(`
          SELECT s.*, p.name as participant_name
          FROM item_splits s
          JOIN participants p ON s.participant_id = p.id
          WHERE s.item_id = ?
        `).all(item.id);
        
        if (splits.length === 0) continue;
        
        let itemAmount = item.price;
        
        // Handle tax/service charge distribution
        if (item.is_tax_or_charge) {
          const taxDist = db.prepare('SELECT * FROM tax_distribution WHERE item_id = ?').get(item.id);
          
          if (taxDist) {
            if (taxDist.distribution_type === 'none') {
              continue; // Skip this item
            } else if (taxDist.distribution_type === 'custom' && taxDist.custom_data) {
              // Custom distribution
              const customData = JSON.parse(taxDist.custom_data);
              for (const [pId, amount] of Object.entries(customData)) {
                if (balances[pId]) {
                  balances[pId].owes += parseFloat(amount);
                }
              }
              continue;
            }
            // For 'equal' and 'proportional', we handle them with splits
          }
        }
        
        // Calculate splits
        for (const split of splits) {
          if (!balances[split.participant_id]) continue;
          
          let amount = 0;
          
          if (split.split_type === 'equal') {
            amount = itemAmount / splits.length;
          } else if (split.split_type === 'fixed') {
            amount = split.value;
          } else if (split.split_type === 'percent') {
            amount = (itemAmount * split.value) / 100;
          }
          
          balances[split.participant_id].owes += amount;
        }
      }
    }
    
    // Calculate what each person paid
    const payments = db.prepare(`
      SELECT p.*, pt.name as payer_name
      FROM payments p
      JOIN participants pt ON p.payer_id = pt.id
      WHERE p.bill_id = ?
    `).all(billId);
    
    for (const payment of payments) {
      if (balances[payment.payer_id]) {
        balances[payment.payer_id].paid += payment.amount;
      }
    }
    
    // Calculate final balances (positive = someone owes them, negative = they owe)
    for (const pId in balances) {
      balances[pId].balance = balances[pId].paid - balances[pId].owes;
    }
    
    // Calculate raw debts (who owes whom)
    const rawDebts = [];
    const payers = Object.values(balances).filter(p => p.balance > 0.01);
    const debtors = Object.values(balances).filter(p => p.balance < -0.01);
    
    for (const payer of payers) {
      for (const debtor of debtors) {
        const amount = Math.min(payer.balance, -debtor.balance);
        if (amount > 0.01) {
          rawDebts.push({
            from: debtor.name,
            from_id: debtor.id,
            to: payer.name,
            to_id: payer.id,
            amount: Math.round(amount * 100) / 100
          });
          payer.balance -= amount;
          debtor.balance += amount;
        }
      }
    }
    
    // Calculate optimized settlements (minimize number of transactions)
    const optimized = optimizeSettlements(Object.values(balances));
    
    res.json({
      bill_id: billId,
      currency_symbol: bill.currency_symbol,
      participants: Object.values(balances).map(p => ({
        id: p.id,
        name: p.name,
        owes: Math.round(p.owes * 100) / 100,
        paid: Math.round(p.paid * 100) / 100,
        balance: Math.round((p.paid - p.owes) * 100) / 100
      })),
      raw_debts: rawDebts,
      optimized_settlements: optimized
    });
  } catch (error) {
    console.error('Error calculating settlements:', error);
    res.status(500).json({ error: 'Failed to calculate settlements' });
  }
});

// Optimize settlements to minimize transactions
function optimizeSettlements(balances) {
  // Create copies to work with
  const creditors = balances.filter(p => p.paid - p.owes > 0.01)
    .map(p => ({ ...p, amount: p.paid - p.owes }));
  const debtors = balances.filter(p => p.paid - p.owes < -0.01)
    .map(p => ({ ...p, amount: -(p.paid - p.owes) }));
  
  const settlements = [];
  
  // Greedy algorithm: match largest debtor with largest creditor
  while (creditors.length > 0 && debtors.length > 0) {
    // Sort by amount descending
    creditors.sort((a, b) => b.amount - a.amount);
    debtors.sort((a, b) => b.amount - a.amount);
    
    const creditor = creditors[0];
    const debtor = debtors[0];
    
    const settleAmount = Math.min(creditor.amount, debtor.amount);
    
    if (settleAmount > 0.01) {
      settlements.push({
        from: debtor.name,
        from_id: debtor.id,
        to: creditor.name,
        to_id: creditor.id,
        amount: Math.round(settleAmount * 100) / 100
      });
      
      creditor.amount -= settleAmount;
      debtor.amount -= settleAmount;
    }
    
    // Remove settled parties
    if (creditor.amount < 0.01) {
      creditors.shift();
    }
    if (debtor.amount < 0.01) {
      debtors.shift();
    }
  }
  
  return settlements;
}

// Get item breakdown for a participant
router.get('/:billId/participant/:participantId', (req, res) => {
  const { billId, participantId } = req.params;
  
  try {
    const participant = db.prepare('SELECT * FROM participants WHERE id = ? AND bill_id = ?')
      .get(participantId, billId);
    
    if (!participant) {
      return res.status(404).json({ error: 'Participant not found' });
    }
    
    const bill = db.prepare('SELECT * FROM bills WHERE id = ?').get(billId);
    
    // Get all items this participant is splitting
    const itemBreakdown = db.prepare(`
      SELECT 
        i.name as item_name,
        i.price as item_price,
        s.split_type,
        s.value as split_value,
        r.id as receipt_id
      FROM item_splits s
      JOIN items i ON s.item_id = i.id
      JOIN receipts r ON i.receipt_id = r.id
      WHERE s.participant_id = ? AND r.bill_id = ?
      ORDER BY r.created_at, i.item_order
    `).all(participantId, billId);
    
    // Calculate actual amounts
    const breakdown = [];
    let total = 0;
    
    for (const item of itemBreakdown) {
      let amount = 0;
      
      // Get number of people splitting this item
      const splitCount = db.prepare(`
        SELECT COUNT(*) as count
        FROM item_splits s
        JOIN items i ON s.item_id = i.id
        WHERE i.name = ? AND i.price = ? AND i.receipt_id = ?
      `).get(item.item_name, item.item_price, item.receipt_id).count;
      
      if (item.split_type === 'equal') {
        amount = item.item_price / splitCount;
      } else if (item.split_type === 'fixed') {
        amount = item.split_value;
      } else if (item.split_type === 'percent') {
        amount = (item.item_price * item.split_value) / 100;
      }
      
      total += amount;
      
      breakdown.push({
        item_name: item.item_name,
        item_price: Math.round(item.item_price * 100) / 100,
        split_type: item.split_type,
        split_value: item.split_value,
        amount: Math.round(amount * 100) / 100
      });
    }
    
    res.json({
      participant: participant.name,
      currency_symbol: bill.currency_symbol,
      items: breakdown,
      total: Math.round(total * 100) / 100
    });
  } catch (error) {
    console.error('Error getting participant breakdown:', error);
    res.status(500).json({ error: 'Failed to get breakdown' });
  }
});

module.exports = router;