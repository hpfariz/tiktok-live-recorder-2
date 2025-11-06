const express = require('express');
const router = express.Router();
const db = require('../database/db');
const { nanoid } = require('nanoid');

// Get payment details for a participant
router.get('/:participantId', (req, res) => {
  const { participantId } = req.params;
  
  try {
    const paymentDetails = db.prepare(`
      SELECT pd.*, p.name as participant_name
      FROM payment_details pd
      JOIN participants p ON pd.participant_id = p.id
      WHERE pd.participant_id = ?
      ORDER BY pd.is_primary DESC, pd.created_at ASC
    `).all(participantId);
    
    res.json(paymentDetails);
  } catch (error) {
    console.error('Error fetching payment details:', error);
    res.status(500).json({ error: 'Failed to fetch payment details' });
  }
});

// Get all payment details for a bill (all participants)
router.get('/bill/:billId', (req, res) => {
  const { billId } = req.params;
  
  try {
    const paymentDetails = db.prepare(`
      SELECT pd.*, p.name as participant_name
      FROM payment_details pd
      JOIN participants p ON pd.participant_id = p.id
      WHERE p.bill_id = ?
      ORDER BY p.name, pd.is_primary DESC, pd.created_at ASC
    `).all(billId);
    
    res.json(paymentDetails);
  } catch (error) {
    console.error('Error fetching payment details:', error);
    res.status(500).json({ error: 'Failed to fetch payment details' });
  }
});

// Add payment detail
router.post('/', (req, res) => {
  const { participant_id, provider_name, account_number, is_primary } = req.body;
  
  if (!participant_id || !provider_name || !account_number) {
    return res.status(400).json({ error: 'Participant, provider name, and account number are required' });
  }
  
  try {
    const id = nanoid(10);
    const now = Date.now();
    
    // If this is set as primary, unset other primary for this participant
    if (is_primary) {
      db.prepare('UPDATE payment_details SET is_primary = 0 WHERE participant_id = ?')
        .run(participant_id);
    }
    
    db.prepare(`
      INSERT INTO payment_details (id, participant_id, provider_name, account_number, is_primary, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, participant_id, provider_name, account_number, is_primary ? 1 : 0, now);
    
    res.json({ 
      id, 
      participant_id, 
      provider_name, 
      account_number,
      is_primary: is_primary ? 1 : 0,
      created_at: now
    });
  } catch (error) {
    console.error('Error adding payment detail:', error);
    res.status(500).json({ error: 'Failed to add payment detail' });
  }
});

// Update payment detail
router.put('/:id', (req, res) => {
  const { id } = req.params;
  const { provider_name, account_number, is_primary } = req.body;
  
  try {
    const existing = db.prepare('SELECT * FROM payment_details WHERE id = ?').get(id);
    
    if (!existing) {
      return res.status(404).json({ error: 'Payment detail not found' });
    }
    
    // If this is set as primary, unset other primary for this participant
    if (is_primary) {
      db.prepare('UPDATE payment_details SET is_primary = 0 WHERE participant_id = ? AND id != ?')
        .run(existing.participant_id, id);
    }
    
    db.prepare(`
      UPDATE payment_details 
      SET provider_name = ?, account_number = ?, is_primary = ?
      WHERE id = ?
    `).run(
      provider_name || existing.provider_name,
      account_number || existing.account_number,
      is_primary !== undefined ? (is_primary ? 1 : 0) : existing.is_primary,
      id
    );
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating payment detail:', error);
    res.status(500).json({ error: 'Failed to update payment detail' });
  }
});

// Delete payment detail
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  
  try {
    db.prepare('DELETE FROM payment_details WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting payment detail:', error);
    res.status(500).json({ error: 'Failed to delete payment detail' });
  }
});

module.exports = router;