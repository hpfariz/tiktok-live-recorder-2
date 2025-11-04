const express = require('express');
const router = express.Router();
const db = require('../database/db');
const { nanoid } = require('nanoid');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${nanoid()}-${Date.now()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (extname && mimetype) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

// Create a new bill
router.post('/create', (req, res) => {
  const { title, mode, currency_symbol } = req.body;
  
  if (!title || !mode) {
    return res.status(400).json({ error: 'Title and mode are required' });
  }
  
  if (!['single', 'multi'].includes(mode)) {
    return res.status(400).json({ error: 'Mode must be "single" or "multi"' });
  }
  
  const id = nanoid(10);
  const now = Date.now();
  const expiresAt = now + (7 * 24 * 60 * 60 * 1000); // 7 days
  
  try {
    db.prepare(`
      INSERT INTO bills (id, title, currency_symbol, created_at, expires_at, mode)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, title, currency_symbol || '$', now, expiresAt, mode);
    
    res.json({ 
      id, 
      title, 
      mode,
      currency_symbol: currency_symbol || '$',
      created_at: now,
      expires_at: expiresAt 
    });
  } catch (error) {
    console.error('Error creating bill:', error);
    res.status(500).json({ error: 'Failed to create bill' });
  }
});

// Get bill details
router.get('/:id', (req, res) => {
  const { id } = req.params;
  
  try {
    const bill = db.prepare('SELECT * FROM bills WHERE id = ?').get(id);
    
    if (!bill) {
      return res.status(404).json({ error: 'Bill not found' });
    }
    
    // Check if expired
    if (bill.expires_at < Date.now()) {
      return res.status(410).json({ error: 'Bill has expired' });
    }
    
    // Get receipts
    const receipts = db.prepare('SELECT * FROM receipts WHERE bill_id = ?').all(id);
    
    // Get items for each receipt
    for (const receipt of receipts) {
      receipt.items = db.prepare('SELECT * FROM items WHERE receipt_id = ? ORDER BY item_order').all(receipt.id);
      
      // Get splits for each item
      for (const item of receipt.items) {
        item.splits = db.prepare(`
          SELECT s.*, p.name as participant_name
          FROM item_splits s
          JOIN participants p ON s.participant_id = p.id
          WHERE s.item_id = ?
        `).all(item.id);
        
        // Get tax distribution if it's a tax/charge item
        if (item.is_tax_or_charge) {
          item.tax_distribution = db.prepare('SELECT * FROM tax_distribution WHERE item_id = ?').get(item.id);
        }
      }
    }
    
    // Get participants
    const participants = db.prepare('SELECT * FROM participants WHERE bill_id = ?').all(id);
    
    // Get payments
    const payments = db.prepare(`
      SELECT p.*, pt.name as payer_name
      FROM payments p
      JOIN participants pt ON p.payer_id = pt.id
      WHERE p.bill_id = ?
    `).all(id);
    
    res.json({
      ...bill,
      receipts,
      participants,
      payments
    });
  } catch (error) {
    console.error('Error fetching bill:', error);
    res.status(500).json({ error: 'Failed to fetch bill' });
  }
});

// Upload receipt
router.post('/:id/receipt', upload.single('receipt'), (req, res) => {
  const { id } = req.params;
  const { ocr_data } = req.body;
  
  try {
    const bill = db.prepare('SELECT * FROM bills WHERE id = ?').get(id);
    
    if (!bill) {
      return res.status(404).json({ error: 'Bill not found' });
    }
    
    const receiptId = nanoid(10);
    const imagePath = req.file ? `uploads/${req.file.filename}` : null;
    
    db.prepare(`
      INSERT INTO receipts (id, bill_id, image_path, ocr_data, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(receiptId, id, imagePath, ocr_data || null, Date.now());
    
    res.json({
      id: receiptId,
      bill_id: id,
      image_path: imagePath,
      ocr_data: ocr_data ? JSON.parse(ocr_data) : null
    });
  } catch (error) {
    console.error('Error uploading receipt:', error);
    res.status(500).json({ error: 'Failed to upload receipt' });
  }
});

// Delete receipt
router.delete('/receipt/:receiptId', (req, res) => {
  const { receiptId } = req.params;
  
  try {
    // Get receipt to check if it has an image file
    const receipt = db.prepare('SELECT * FROM receipts WHERE id = ?').get(receiptId);
    
    if (!receipt) {
      return res.status(404).json({ error: 'Receipt not found' });
    }
    
    // Delete image file if it exists
    if (receipt.image_path) {
      const fullPath = path.join(__dirname, '..', receipt.image_path);
      try {
        if (fs.existsSync(fullPath)) {
          fs.unlinkSync(fullPath);
        }
      } catch (err) {
        console.error(`Failed to delete file ${fullPath}:`, err.message);
      }
    }

    // Delete any payments associated with this receipt
    db.prepare('DELETE FROM payments WHERE receipt_id = ?').run(receiptId);

    // Delete receipt from database (cascades to items, splits, etc.)
    db.prepare('DELETE FROM receipts WHERE id = ?').run(receiptId);
    
    res.json({ success: true, message: 'Receipt deleted successfully' });
  } catch (error) {
    console.error('Error deleting receipt:', error);
    res.status(500).json({ error: 'Failed to delete receipt' });
  }
});

// Add item to receipt
router.post('/:id/receipt/:receiptId/item', (req, res) => {
  const { receiptId } = req.params;
  const { name, price, is_tax_or_charge, charge_type, item_order, quantity, unit_price } = req.body;
  
  if (!name || price === undefined) {
    return res.status(400).json({ error: 'Name and price are required' });
  }
  
  try {
    const itemId = nanoid(10);
    
    db.prepare(`
      INSERT INTO items (id, receipt_id, name, price, is_tax_or_charge, charge_type, item_order, quantity, unit_price)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      itemId, 
      receiptId, 
      name, 
      parseFloat(price), 
      is_tax_or_charge ? 1 : 0,
      charge_type || null,
      item_order || 0,
      quantity || 1,
      unit_price ? parseFloat(unit_price) : null
    );
    
    res.json({ 
      id: itemId, 
      receipt_id: receiptId, 
      name, 
      price: parseFloat(price),
      quantity: quantity || 1,
      unit_price: unit_price ? parseFloat(unit_price) : null
    });
  } catch (error) {
    console.error('Error adding item:', error);
    res.status(500).json({ error: 'Failed to add item' });
  }
});

// Update item
router.put('/item/:itemId', (req, res) => {
  const { itemId } = req.params;
  const { name, price, is_tax_or_charge, charge_type, quantity, unit_price } = req.body;
  
  try {
    db.prepare(`
      UPDATE items 
      SET name = ?, price = ?, is_tax_or_charge = ?, charge_type = ?, quantity = ?, unit_price = ?
      WHERE id = ?
    `).run(
      name, 
      parseFloat(price), 
      is_tax_or_charge ? 1 : 0, 
      charge_type || null,
      quantity || 1,
      unit_price ? parseFloat(unit_price) : null,
      itemId
    );
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating item:', error);
    res.status(500).json({ error: 'Failed to update item' });
  }
});

// Delete item
router.delete('/item/:itemId', (req, res) => {
  const { itemId } = req.params;
  
  try {
    db.prepare('DELETE FROM items WHERE id = ?').run(itemId);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting item:', error);
    res.status(500).json({ error: 'Failed to delete item' });
  }
});

// Add participant
router.post('/:id/participant', (req, res) => {
  const { id } = req.params;
  const { name } = req.body;
  
  if (!name) {
    return res.status(400).json({ error: 'Name is required' });
  }
  
  try {
    const participantId = nanoid(10);
    
    db.prepare(`
      INSERT INTO participants (id, bill_id, name)
      VALUES (?, ?, ?)
    `).run(participantId, id, name);
    
    res.json({ id: participantId, bill_id: id, name });
  } catch (error) {
    console.error('Error adding participant:', error);
    res.status(500).json({ error: 'Failed to add participant' });
  }
});

// Add item split
router.post('/item/:itemId/split', (req, res) => {
  const { itemId } = req.params;
  const { participant_id, split_type, value } = req.body;
  
  if (!participant_id || !split_type || value === undefined) {
    return res.status(400).json({ error: 'Participant, split type, and value are required' });
  }
  
  if (!['equal', 'fixed', 'percent', 'quantity'].includes(split_type)) {
    return res.status(400).json({ error: 'Invalid split type' });
  }
  
  try {
    const splitId = nanoid(10);
    
    db.prepare(`
      INSERT INTO item_splits (id, item_id, participant_id, split_type, value)
      VALUES (?, ?, ?, ?, ?)
    `).run(splitId, itemId, participant_id, split_type, parseFloat(value));
    
    res.json({ id: splitId, item_id: itemId, participant_id, split_type, value: parseFloat(value) });
  } catch (error) {
    console.error('Error adding split:', error);
    res.status(500).json({ error: 'Failed to add split' });
  }
});

// Delete all splits for an item
router.delete('/item/:itemId/splits', (req, res) => {
  const { itemId } = req.params;
  
  try {
    db.prepare('DELETE FROM item_splits WHERE item_id = ?').run(itemId);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting splits:', error);
    res.status(500).json({ error: 'Failed to delete splits' });
  }
});

// Set tax distribution
router.post('/item/:itemId/tax-distribution', (req, res) => {
  const { itemId } = req.params;
  const { distribution_type, custom_data } = req.body;
  
  if (!distribution_type) {
    return res.status(400).json({ error: 'Distribution type is required' });
  }
  
  try {
    // Delete existing distribution
    db.prepare('DELETE FROM tax_distribution WHERE item_id = ?').run(itemId);
    
    // Add new distribution
    const distId = nanoid(10);
    db.prepare(`
      INSERT INTO tax_distribution (id, item_id, distribution_type, custom_data)
      VALUES (?, ?, ?, ?)
    `).run(distId, itemId, distribution_type, custom_data ? JSON.stringify(custom_data) : null);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error setting tax distribution:', error);
    res.status(500).json({ error: 'Failed to set tax distribution' });
  }
});

// Add payment (UPDATED to support receipt_id and prevent duplicates)
router.post('/:id/payment', (req, res) => {
  const { id } = req.params;
  const { payer_id, amount, receipt_id } = req.body;
  
  if (!payer_id || amount === undefined) {
    return res.status(400).json({ error: 'Payer and amount are required' });
  }
  
  try {
    // If receipt_id is provided, delete existing payment for that receipt
    if (receipt_id) {
      db.prepare('DELETE FROM payments WHERE receipt_id = ?').run(receipt_id);
    }
    
    const paymentId = nanoid(10);
    
    db.prepare(`
      INSERT INTO payments (id, bill_id, payer_id, amount, receipt_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(paymentId, id, payer_id, parseFloat(amount), receipt_id || null);
    
    res.json({ id: paymentId, bill_id: id, payer_id, amount: parseFloat(amount), receipt_id });
  } catch (error) {
    console.error('Error adding payment:', error);
    res.status(500).json({ error: 'Failed to add payment' });
  }
});

// Duplicate bill (for amendments)
router.post('/:id/duplicate', (req, res) => {
  const { id } = req.params;
  
  try {
    const originalBill = db.prepare('SELECT * FROM bills WHERE id = ?').get(id);
    
    if (!originalBill) {
      return res.status(404).json({ error: 'Bill not found' });
    }
    
    const newId = nanoid(10);
    const now = Date.now();
    const expiresAt = now + (7 * 24 * 60 * 60 * 1000);
    
    // Create new bill
    db.prepare(`
      INSERT INTO bills (id, title, currency_symbol, created_at, expires_at, mode)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      newId, 
      originalBill.title + ' (Copy)', 
      originalBill.currency_symbol,
      now, 
      expiresAt, 
      originalBill.mode
    );
    
    // Copy participants
    const participants = db.prepare('SELECT * FROM participants WHERE bill_id = ?').all(id);
    const participantMap = {};
    
    for (const p of participants) {
      const newPId = nanoid(10);
      participantMap[p.id] = newPId;
      db.prepare(`
        INSERT INTO participants (id, bill_id, name)
        VALUES (?, ?, ?)
      `).run(newPId, newId, p.name);
    }
    
    // Copy receipts, items, and splits
    const receipts = db.prepare('SELECT * FROM receipts WHERE bill_id = ?').all(id);
    
    for (const receipt of receipts) {
      const newReceiptId = nanoid(10);
      
      // Note: We don't copy the image file, just reference
      db.prepare(`
        INSERT INTO receipts (id, bill_id, image_path, ocr_data, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(newReceiptId, newId, receipt.image_path, receipt.ocr_data, now);
      
      const items = db.prepare('SELECT * FROM items WHERE receipt_id = ?').all(receipt.id);
      
      for (const item of items) {
        const newItemId = nanoid(10);
        
        db.prepare(`
          INSERT INTO items (id, receipt_id, name, price, is_tax_or_charge, charge_type, item_order, quantity, unit_price)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          newItemId, 
          newReceiptId, 
          item.name, 
          item.price, 
          item.is_tax_or_charge,
          item.charge_type,
          item.item_order,
          item.quantity || 1,
          item.unit_price || null
        );
        
        // Copy splits
        const splits = db.prepare('SELECT * FROM item_splits WHERE item_id = ?').all(item.id);
        for (const split of splits) {
          db.prepare(`
            INSERT INTO item_splits (id, item_id, participant_id, split_type, value)
            VALUES (?, ?, ?, ?, ?)
          `).run(
            nanoid(10),
            newItemId,
            participantMap[split.participant_id],
            split.split_type,
            split.value
          );
        }
        
        // Copy tax distribution
        if (item.is_tax_or_charge) {
          const taxDist = db.prepare('SELECT * FROM tax_distribution WHERE item_id = ?').get(item.id);
          if (taxDist) {
            db.prepare(`
              INSERT INTO tax_distribution (id, item_id, distribution_type, custom_data)
              VALUES (?, ?, ?, ?)
            `).run(nanoid(10), newItemId, taxDist.distribution_type, taxDist.custom_data);
          }
        }
      }
    }
    
    // Copy payments
    const payments = db.prepare('SELECT * FROM payments WHERE bill_id = ?').all(id);
    for (const payment of payments) {
      db.prepare(`
        INSERT INTO payments (id, bill_id, payer_id, amount)
        VALUES (?, ?, ?, ?)
      `).run(nanoid(10), newId, participantMap[payment.payer_id], payment.amount);
    }
    
    res.json({ 
      id: newId,
      message: 'Bill duplicated successfully',
      original_id: id
    });
  } catch (error) {
    console.error('Error duplicating bill:', error);
    res.status(500).json({ error: 'Failed to duplicate bill' });
  }
});

module.exports = router;