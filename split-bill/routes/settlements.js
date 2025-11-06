const express = require('express');
const router = express.Router();
const db = require('../database/db');

// Helper function to format price with thousand separators
function formatPrice(amount, currency = 'Rp') {
  if (amount === null || amount === undefined || isNaN(amount)) {
    return `${currency}0.00`;
  }
  
  const parts = amount.toFixed(2).split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  
  return `${currency}${parts.join('.')}`;
}

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
        
        if (splits.length === 0 && !item.is_tax_or_charge) continue;
        
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
            } else if (taxDist.distribution_type === 'proportional') {
              // PROPORTIONAL: Distribute tax based on each participant's subtotal
              
              const participantSubtotals = {};
              let totalSubtotal = 0;
              
              // Initialize all participants
              for (const p of participants) {
                participantSubtotals[p.id] = 0;
              }
              
              // Get all regular (non-tax) items from the same receipt
              const regularItems = db.prepare(`
                SELECT i.* FROM items i
                WHERE i.receipt_id = ? AND i.is_tax_or_charge = 0
              `).all(item.receipt_id);
              
              // Calculate each participant's subtotal
              for (const regItem of regularItems) {
                const regSplits = db.prepare(`
                  SELECT * FROM item_splits WHERE item_id = ?
                `).all(regItem.id);
                
                if (regSplits.length === 0) continue;
                
                // Use same smart split logic
                const fixedSplits = regSplits.filter(s => s.split_type === 'fixed');
                const qtySplits = regSplits.filter(s => s.split_type === 'quantity');
                const percentSplits = regSplits.filter(s => s.split_type === 'percent');
                const equalSplits = regSplits.filter(s => s.split_type === 'equal');
                
                let remaining = regItem.price;
                
                // Fixed amounts
                for (const split of fixedSplits) {
                  if (participantSubtotals[split.participant_id] !== undefined) {
                    participantSubtotals[split.participant_id] += split.value;
                  }
                  remaining -= split.value;
                }
                
                // Quantity splits
                if (regItem.quantity && qtySplits.length > 0) {
                  const unitPrice = regItem.price / regItem.quantity;
                  for (const split of qtySplits) {
                    if (participantSubtotals[split.participant_id] !== undefined) {
                      const amount = unitPrice * split.value;
                      participantSubtotals[split.participant_id] += amount;
                      remaining -= amount;
                    }
                  }
                }
                
                // Percentage splits
                for (const split of percentSplits) {
                  if (participantSubtotals[split.participant_id] !== undefined) {
                    const amount = (remaining * split.value) / 100;
                    participantSubtotals[split.participant_id] += amount;
                    remaining -= amount;
                  }
                }
                
                // Equal splits
                if (equalSplits.length > 0) {
                  const equalAmount = remaining / equalSplits.length;
                  for (const split of equalSplits) {
                    if (participantSubtotals[split.participant_id] !== undefined) {
                      participantSubtotals[split.participant_id] += equalAmount;
                    }
                  }
                }
              }
              
              // Calculate total subtotal
              for (const pId in participantSubtotals) {
                totalSubtotal += participantSubtotals[pId];
              }
              
              // Distribute tax proportionally based on subtotal
              if (totalSubtotal > 0) {
                for (const pId in participantSubtotals) {
                  if (participantSubtotals[pId] > 0 && balances[pId]) {
                    const proportion = participantSubtotals[pId] / totalSubtotal;
                    const taxAmount = itemAmount * proportion;
                    balances[pId].owes += taxAmount;
                  }
                }
              }
              continue; // Skip the normal split processing below
            }
            // For 'equal', fall through to normal split processing
          } else if (splits.length === 0) {
            // Tax item has no distribution config and no splits
            // Default to proportional distribution
            console.log(`Tax item "${item.name}" has no configuration, defaulting to proportional`);
            
            const participantSubtotals = {};
            let totalSubtotal = 0;
            
            // Initialize all participants
            for (const p of participants) {
              participantSubtotals[p.id] = 0;
            }
            
            // Get all regular (non-tax) items from the same receipt
            const regularItems = db.prepare(`
              SELECT i.* FROM items i
              WHERE i.receipt_id = ? AND i.is_tax_or_charge = 0
            `).all(item.receipt_id);
            
            // Calculate each participant's subtotal
            for (const regItem of regularItems) {
              const regSplits = db.prepare(`
                SELECT * FROM item_splits WHERE item_id = ?
              `).all(regItem.id);
              
              if (regSplits.length === 0) continue;
              
              const fixedSplits = regSplits.filter(s => s.split_type === 'fixed');
              const qtySplits = regSplits.filter(s => s.split_type === 'quantity');
              const percentSplits = regSplits.filter(s => s.split_type === 'percent');
              const equalSplits = regSplits.filter(s => s.split_type === 'equal');
              
              let remaining = regItem.price;
              
              for (const split of fixedSplits) {
                if (participantSubtotals[split.participant_id] !== undefined) {
                  participantSubtotals[split.participant_id] += split.value;
                }
                remaining -= split.value;
              }
              
              if (regItem.quantity && qtySplits.length > 0) {
                const unitPrice = regItem.price / regItem.quantity;
                for (const split of qtySplits) {
                  if (participantSubtotals[split.participant_id] !== undefined) {
                    const amount = unitPrice * split.value;
                    participantSubtotals[split.participant_id] += amount;
                    remaining -= amount;
                  }
                }
              }
              
              for (const split of percentSplits) {
                if (participantSubtotals[split.participant_id] !== undefined) {
                  const amount = (remaining * split.value) / 100;
                  participantSubtotals[split.participant_id] += amount;
                  remaining -= amount;
                }
              }
              
              if (equalSplits.length > 0) {
                const equalAmount = remaining / equalSplits.length;
                for (const split of equalSplits) {
                  if (participantSubtotals[split.participant_id] !== undefined) {
                    participantSubtotals[split.participant_id] += equalAmount;
                  }
                }
              }
            }
            
            // Calculate total subtotal
            for (const pId in participantSubtotals) {
              totalSubtotal += participantSubtotals[pId];
            }
            
            // Distribute tax proportionally based on subtotal
            if (totalSubtotal > 0) {
              for (const pId in participantSubtotals) {
                if (participantSubtotals[pId] > 0 && balances[pId]) {
                  const proportion = participantSubtotals[pId] / totalSubtotal;
                  const taxAmount = itemAmount * proportion;
                  balances[pId].owes += taxAmount;
                }
              }
            }
            continue; // Skip the normal split processing below
          }
        }
        
        // SMART MIXED SPLIT CALCULATION
        // Separate splits by type
        const fixedSplits = splits.filter(s => s.split_type === 'fixed');
        const qtySplits = splits.filter(s => s.split_type === 'quantity');
        const percentSplits = splits.filter(s => s.split_type === 'percent');
        const equalSplits = splits.filter(s => s.split_type === 'equal');

        let remaining = itemAmount;

        // Step 1: Process fixed amounts
        for (const split of fixedSplits) {
          if (!balances[split.participant_id]) continue;
          const amount = split.value;
          balances[split.participant_id].owes += amount;
          remaining -= amount;
        }

        // Step 2: Process quantity splits
        if (item.quantity && qtySplits.length > 0) {
          const unitPrice = itemAmount / item.quantity;
          for (const split of qtySplits) {
            if (!balances[split.participant_id]) continue;
            const amount = unitPrice * split.value;
            balances[split.participant_id].owes += amount;
            remaining -= amount;
          }
        }

        // Step 3: Process percentages from remaining
        for (const split of percentSplits) {
          if (!balances[split.participant_id]) continue;
          const amount = (remaining * split.value) / 100;
          balances[split.participant_id].owes += amount;
          remaining -= amount;
        }

        // Step 4: Split remainder equally
        if (equalSplits.length > 0) {
          const equalAmount = remaining / equalSplits.length;
          for (const split of equalSplits) {
            if (!balances[split.participant_id]) continue;
            balances[split.participant_id].owes += equalAmount;
          }
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
  // Create deep copies with initial amounts
  const creditors = [];
  const debtors = [];
  
  for (const person of balances) {
    const netBalance = person.paid - person.owes;
    if (netBalance > 0.01) {
      creditors.push({
        id: person.id,
        name: person.name,
        amount: netBalance
      });
    } else if (netBalance < -0.01) {
      debtors.push({
        id: person.id,
        name: person.name,
        amount: -netBalance
      });
    }
  }
  
  // Sort by amount descending (largest first)
  creditors.sort((a, b) => b.amount - a.amount);
  debtors.sort((a, b) => b.amount - a.amount);
  
  const settlements = [];
  let i = 0, j = 0;
  
  while (i < creditors.length && j < debtors.length) {
    const creditor = creditors[i];
    const debtor = debtors[j];
    
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
    
    // Move to next person if current one is settled
    if (creditor.amount < 0.01) i++;
    if (debtor.amount < 0.01) j++;
  }
  
  return settlements;
}

// Get item breakdown for a participant - UPDATED TO INCLUDE TAX ITEMS
router.get('/:billId/participant/:participantId', (req, res) => {
  const { billId, participantId } = req.params;
  
  try {
    const participant = db.prepare('SELECT * FROM participants WHERE id = ? AND bill_id = ?')
      .get(participantId, billId);
    
    if (!participant) {
      return res.status(404).json({ error: 'Participant not found' });
    }
    
    const bill = db.prepare('SELECT * FROM bills WHERE id = ?').get(billId);
    const receipts = db.prepare('SELECT * FROM receipts WHERE bill_id = ?').all(billId);
    
    // Get all items this participant is splitting
    const itemBreakdown = db.prepare(`
      SELECT 
        i.id as item_id,
        i.name as item_name,
        i.price as item_price,
        i.is_tax_or_charge,
        i.quantity,
        i.unit_price,
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
    
    // Track which receipts we've seen
    const processedReceipts = new Set();
    
    for (const item of itemBreakdown) {
      let amount = 0;
      
      // Check if this is a tax/charge item with special distribution
      if (item.is_tax_or_charge) {
        const taxDist = db.prepare('SELECT * FROM tax_distribution WHERE item_id = ?').get(item.item_id);
        
        if (taxDist && taxDist.distribution_type === 'proportional') {
          // PROPORTIONAL TAX: Calculate this participant's share based on their subtotal
          amount = calculateProportionalTax(item.receipt_id, participantId, item.item_price);
          
          total += amount;
          
          breakdown.push({
            item_name: item.item_name,
            item_price: Math.round(item.item_price * 100) / 100,
            split_type: 'proportional',
            split_value: null,
            amount: Math.round(amount * 100) / 100,
            quantity: item.quantity || 1,
            unit_price: item.unit_price
          });
          
          processedReceipts.add(item.receipt_id);
          continue;
        }
      }
      
      // Normal item calculation (non-tax or non-proportional)
      // Get number of people splitting this item
      const splitCount = db.prepare(`
        SELECT COUNT(*) as count
        FROM item_splits s
        WHERE s.item_id = ?
      `).get(item.item_id).count;
      
      if (item.split_type === 'equal') {
        amount = item.item_price / splitCount;
      } else if (item.split_type === 'fixed') {
        amount = item.split_value;
      } else if (item.split_type === 'percent') {
        amount = (item.item_price * item.split_value) / 100;
      } else if (item.split_type === 'quantity') {
        if (item.quantity && item.quantity > 0) {
          const unitPrice = item.item_price / item.quantity;
          amount = unitPrice * item.split_value;
        }
      }
      
      total += amount;
      
      breakdown.push({
        item_name: item.item_name,
        item_price: Math.round(item.item_price * 100) / 100,
        split_type: item.split_type,
        split_value: item.split_value,
        amount: Math.round(amount * 100) / 100,
        quantity: item.quantity || 1,
        unit_price: item.unit_price
      });
      
      processedReceipts.add(item.receipt_id);
    }
    
    // NOW CHECK FOR UNCONFIGURED TAX ITEMS IN RECEIPTS THIS PARTICIPANT IS PART OF
    for (const receipt of receipts) {
      if (!processedReceipts.has(receipt.id)) {
        // Check if this participant has any items in this receipt
        const participantInReceipt = db.prepare(`
          SELECT COUNT(*) as count
          FROM item_splits s
          JOIN items i ON s.item_id = i.id
          WHERE i.receipt_id = ? AND s.participant_id = ? AND i.is_tax_or_charge = 0
        `).get(receipt.id, participantId).count;
        
        if (participantInReceipt > 0) {
          processedReceipts.add(receipt.id);
          
          // Get unconfigured tax items from this receipt
          const taxItems = db.prepare(`
            SELECT i.id, i.name, i.price, i.is_tax_or_charge, i.quantity, i.unit_price
            FROM items i
            LEFT JOIN tax_distribution t ON i.id = t.item_id
            LEFT JOIN item_splits s ON i.id = s.item_id
            WHERE i.receipt_id = ? AND i.is_tax_or_charge = 1
            GROUP BY i.id
            HAVING COUNT(s.id) = 0
          `).all(receipt.id);
          
          for (const taxItem of taxItems) {
            // Calculate proportional tax for unconfigured items
            const amount = calculateProportionalTax(receipt.id, participantId, taxItem.price);
            
            if (amount > 0) {
              total += amount;
              
              breakdown.push({
                item_name: taxItem.name,
                item_price: Math.round(taxItem.price * 100) / 100,
                split_type: 'proportional',
                split_value: null,
                amount: Math.round(amount * 100) / 100,
                quantity: taxItem.quantity || 1,
                unit_price: taxItem.unit_price
              });
            }
          }
        }
      }
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

// NEW: Get breakdown by receipt showing all items and who they're assigned to
router.get('/:billId/receipt/:receiptId', (req, res) => {
  const { billId, receiptId } = req.params;
  
  try {
    const bill = db.prepare('SELECT * FROM bills WHERE id = ?').get(billId);
    const receipt = db.prepare('SELECT * FROM receipts WHERE id = ? AND bill_id = ?').get(receiptId, billId);
    
    if (!receipt) {
      return res.status(404).json({ error: 'Receipt not found' });
    }
    
    // Get payer for this receipt
    const payment = db.prepare(`
      SELECT p.*, pt.name as payer_name
      FROM payments p
      JOIN participants pt ON p.payer_id = pt.id
      WHERE p.receipt_id = ?
    `).get(receiptId);
    
    // Get all items in this receipt
    const items = db.prepare('SELECT * FROM items WHERE receipt_id = ? ORDER BY item_order').all(receiptId);
    
    const itemsWithAssignments = [];
    let receiptTotal = 0;
    
    for (const item of items) {
      receiptTotal += item.price;
      
      // Get splits for this item
      const splits = db.prepare(`
        SELECT s.*, p.name as participant_name
        FROM item_splits s
        JOIN participants p ON s.participant_id = p.id
        WHERE s.item_id = ?
      `).all(item.id);
      
      // Format assignees
      const assignees = splits.map(s => ({
        id: s.participant_id,
        name: s.participant_name,
        split_type: s.split_type,
        value: s.value
      }));
      
      itemsWithAssignments.push({
        id: item.id,
        name: item.name,
        price: item.price,
        quantity: item.quantity || 1,
        unit_price: item.unit_price,
        is_tax_or_charge: item.is_tax_or_charge,
        charge_type: item.charge_type,
        assignees: assignees,
        tax_distribution: item.is_tax_or_charge ? 
          db.prepare('SELECT * FROM tax_distribution WHERE item_id = ?').get(item.id) : null
      });
    }
    
    res.json({
      receipt_id: receiptId,
      bill_id: billId,
      currency_symbol: bill.currency_symbol,
      image_path: receipt.image_path,
      payer: payment ? {
        id: payment.payer_id,
        name: payment.payer_name,
        amount: payment.amount
      } : null,
      items: itemsWithAssignments,
      total: Math.round(receiptTotal * 100) / 100
    });
  } catch (error) {
    console.error('Error getting receipt breakdown:', error);
    res.status(500).json({ error: 'Failed to get receipt breakdown' });
  }
});

// Helper function to calculate proportional tax
function calculateProportionalTax(receiptId, participantId, taxAmount) {
  const participantSubtotals = {};
  let totalSubtotal = 0;
  
  // Get all regular (non-tax) items from the receipt
  const regularItems = db.prepare(`
    SELECT i.* FROM items i
    WHERE i.receipt_id = ? AND i.is_tax_or_charge = 0
  `).all(receiptId);
  
  // Get all participants in this receipt
  const participantsInReceipt = db.prepare(`
    SELECT DISTINCT s.participant_id
    FROM item_splits s
    JOIN items i ON s.item_id = i.id
    WHERE i.receipt_id = ? AND i.is_tax_or_charge = 0
  `).all(receiptId);
  
  // Initialize subtotals
  for (const p of participantsInReceipt) {
    participantSubtotals[p.participant_id] = 0;
  }
  
  // Calculate each participant's subtotal
  for (const item of regularItems) {
    const splits = db.prepare(`
      SELECT * FROM item_splits WHERE item_id = ?
    `).all(item.id);
    
    if (splits.length === 0) continue;
    
    const fixedSplits = splits.filter(s => s.split_type === 'fixed');
    const qtySplits = splits.filter(s => s.split_type === 'quantity');
    const percentSplits = splits.filter(s => s.split_type === 'percent');
    const equalSplits = splits.filter(s => s.split_type === 'equal');
    
    let remaining = item.price;
    
    // Process fixed amounts
    for (const split of fixedSplits) {
      if (participantSubtotals[split.participant_id] !== undefined) {
        participantSubtotals[split.participant_id] += split.value;
      }
      remaining -= split.value;
    }
    
    // Process quantity splits
    if (item.quantity && qtySplits.length > 0) {
      const unitPrice = item.price / item.quantity;
      for (const split of qtySplits) {
        if (participantSubtotals[split.participant_id] !== undefined) {
          const amount = unitPrice * split.value;
          participantSubtotals[split.participant_id] += amount;
          remaining -= amount;
        }
      }
    }
    
    // Process percentages
    for (const split of percentSplits) {
      if (participantSubtotals[split.participant_id] !== undefined) {
        const amount = (remaining * split.value) / 100;
        participantSubtotals[split.participant_id] += amount;
        remaining -= amount;
      }
    }
    
    // Process equal splits
    if (equalSplits.length > 0) {
      const equalAmount = remaining / equalSplits.length;
      for (const split of equalSplits) {
        if (participantSubtotals[split.participant_id] !== undefined) {
          participantSubtotals[split.participant_id] += equalAmount;
        }
      }
    }
  }
  
  // Calculate total subtotal
  for (const pId in participantSubtotals) {
    totalSubtotal += participantSubtotals[pId];
  }
  
  // Calculate proportional tax for this participant
  if (totalSubtotal > 0 && participantSubtotals[participantId] > 0) {
    const proportion = participantSubtotals[participantId] / totalSubtotal;
    return taxAmount * proportion;
  }
  
  return 0;
}

module.exports = router;