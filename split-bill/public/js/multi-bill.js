// Multi-Bill JavaScript
const BASE_PATH = window.location.pathname.match(/^\/[^\/]+/)?.[0] || '';
const API_BASE = window.location.origin + BASE_PATH;

// Global state
let billId = null;
let billData = null;
let receipts = [];
let participants = [];
let currentReceipt = null;
let currentOCRResult = null;

// Get bill ID from URL
function getBillId() {
  const params = new URLSearchParams(window.location.search);
  return params.get('id');
}

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  billId = getBillId();
  
  if (!billId) {
    alert('No bill ID provided');
    window.location.href = `${BASE_PATH}/`;
    return;
  }

  await loadBill();
  setupParticipantInput();
  renderReceipts();
});

// Load bill data
async function loadBill() {
  try {
    const response = await fetch(`${API_BASE}/api/bills/${billId}`);
    if (!response.ok) throw new Error('Failed to load bill');
    
    billData = await response.json();
    document.getElementById('bill-title-header').textContent = billData.title;
    
    if (billData.receipts) {
      receipts = billData.receipts;
    }
    
    if (billData.participants) {
      participants = billData.participants;
      renderParticipants();
    }
  } catch (error) {
    console.error('Error loading bill:', error);
    alert('Failed to load bill');
  }
}

// Setup participant input
function setupParticipantInput() {
  const input = document.getElementById('participant-name');
  input.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      addParticipant();
    }
  });
}

// Add participant
async function addParticipant() {
  const name = document.getElementById('participant-name').value.trim();
  
  if (!name) {
    alert('Please enter a name');
    return;
  }
  
  if (participants.some(p => p.name.toLowerCase() === name.toLowerCase())) {
    alert('This participant already exists');
    return;
  }
  
  try {
    const response = await fetch(`${API_BASE}/api/bills/${billId}/participant`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    
    if (!response.ok) throw new Error('Failed to add participant');
    
    const participantData = await response.json();
    participants.push(participantData);
    
    document.getElementById('participant-name').value = '';
    renderParticipants();
  } catch (error) {
    console.error('Error adding participant:', error);
    alert('Failed to add participant');
  }
}

// Remove participant
function removeParticipant(index) {
  if (!confirm('Remove this participant?')) return;
  participants.splice(index, 1);
  renderParticipants();
}

// Render participants
function renderParticipants() {
  const container = document.getElementById('participants-list');
  
  if (participants.length === 0) {
    container.innerHTML = '<div class="text-secondary text-sm">No participants yet</div>';
    return;
  }
  
  container.innerHTML = participants.map((p, index) => `
    <div class="chip">
      ${p.name}
      <button class="chip-remove" onclick="removeParticipant(${index})">×</button>
    </div>
  `).join('');
}

// Show add receipt modal
function showAddReceiptModal() {
  document.getElementById('add-receipt-modal').style.display = 'block';
  
  // Setup file preview
  const fileInput = document.getElementById('receipt-file');
  const previewDiv = document.getElementById('receipt-preview');
  const previewImg = document.getElementById('preview-image');
  
  fileInput.onchange = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        previewImg.src = e.target.result;
        previewDiv.style.display = 'block';
      };
      reader.readAsDataURL(file);
    }
  };
}

// Close add receipt modal
function closeAddReceiptModal() {
  document.getElementById('add-receipt-modal').style.display = 'none';
  document.getElementById('receipt-file').value = '';
  document.getElementById('receipt-preview').style.display = 'none';
  document.getElementById('ocr-results').style.display = 'none';
  document.getElementById('ocr-progress').style.display = 'none';
  document.getElementById('process-receipt-btn').style.display = 'inline-block';
  document.getElementById('save-receipt-btn').style.display = 'none';
  currentOCRResult = null;
}

// Process receipt with OCR
async function processReceipt() {
  const fileInput = document.getElementById('receipt-file');
  const file = fileInput.files[0];
  
  if (!file) {
    alert('Please select a receipt image');
    return;
  }
  
  document.getElementById('ocr-progress').style.display = 'block';
  document.getElementById('process-receipt-btn').style.display = 'none';
  
  try {
    // Process with OCR
    const result = await window.OCR.processReceipt(file, (progress) => {
      document.getElementById('ocr-percent').textContent = progress;
    });
    
    if (!result.success) {
      throw new Error(result.error || 'OCR failed');
    }
    
    currentOCRResult = result.parsed;
    
    // Show OCR results
    document.getElementById('ocr-progress').style.display = 'none';
    document.getElementById('ocr-results').style.display = 'block';
    document.getElementById('save-receipt-btn').style.display = 'inline-block';
    
    // Render items
    const itemsList = document.getElementById('ocr-items-list');
    const allItems = [
      ...(result.parsed.items || []),
      ...(result.parsed.charges.tax ? [{ name: result.parsed.charges.tax.name, price: result.parsed.charges.tax.amount, isTax: true }] : []),
      ...(result.parsed.charges.serviceCharge ? [{ name: result.parsed.charges.serviceCharge.name, price: result.parsed.charges.serviceCharge.amount, isTax: true }] : []),
      ...(result.parsed.charges.gratuity ? [{ name: result.parsed.charges.gratuity.name, price: result.parsed.charges.gratuity.amount, isTax: true }] : [])
    ];
    
    itemsList.innerHTML = allItems.map(item => `
      <div class="item-list-item">
        <div class="flex-between">
          <span>${item.name}</span>
          <span>${billData.currency_symbol}${item.price.toFixed(2)}</span>
        </div>
      </div>
    `).join('');
    
  } catch (error) {
    console.error('OCR Error:', error);
    alert('OCR processing failed. Please try again or add items manually.');
    document.getElementById('ocr-progress').style.display = 'none';
    document.getElementById('process-receipt-btn').style.display = 'inline-block';
  }
}

// Save receipt
async function saveReceipt() {
  const fileInput = document.getElementById('receipt-file');
  const file = fileInput.files[0];
  
  if (!file || !currentOCRResult) {
    alert('No receipt data to save');
    return;
  }
  
  try {
    // Upload receipt
    const formData = new FormData();
    formData.append('receipt', file);
    formData.append('ocr_data', JSON.stringify(currentOCRResult));
    
    const response = await fetch(`${API_BASE}/api/bills/${billId}/receipt`, {
      method: 'POST',
      body: formData
    });
    
    if (!response.ok) throw new Error('Failed to upload receipt');
    
    const receiptData = await response.json();
    
    // Add items to receipt
    const items = currentOCRResult.items || [];
    for (const item of items) {
      await addItemToReceipt(receiptData.id, item.name, item.price, false);
    }
    
    // Add tax/charges
    if (currentOCRResult.charges) {
      if (currentOCRResult.charges.tax) {
        await addItemToReceipt(receiptData.id, currentOCRResult.charges.tax.name, currentOCRResult.charges.tax.amount, true, 'tax');
      }
      if (currentOCRResult.charges.serviceCharge) {
        await addItemToReceipt(receiptData.id, currentOCRResult.charges.serviceCharge.name, currentOCRResult.charges.serviceCharge.amount, true, 'service');
      }
      if (currentOCRResult.charges.gratuity) {
        await addItemToReceipt(receiptData.id, currentOCRResult.charges.gratuity.name, currentOCRResult.charges.gratuity.amount, true, 'gratuity');
      }
    }
    
    // Reload bill data
    await loadBill();
    renderReceipts();
    closeAddReceiptModal();
  } catch (error) {
    console.error('Error saving receipt:', error);
    alert('Failed to save receipt');
  }
}

// Add item to receipt
async function addItemToReceipt(receiptId, name, price, isTax = false, chargeType = null) {
  try {
    const response = await fetch(`${API_BASE}/api/bills/${billId}/receipt/${receiptId}/item`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        price: parseFloat(price),
        is_tax_or_charge: isTax ? 1 : 0,
        charge_type: chargeType
      })
    });
    
    if (!response.ok) throw new Error('Failed to add item');
    
    return await response.json();
  } catch (error) {
    console.error('Error adding item:', error);
    throw error;
  }
}

// Show add manual item modal
function showAddManualItemModal() {
  document.getElementById('add-manual-modal').style.display = 'block';
}

// Close add manual item modal
function closeAddManualItemModal() {
  document.getElementById('add-manual-modal').style.display = 'none';
  document.getElementById('manual-item-name').value = '';
  document.getElementById('manual-item-price').value = '';
}

// Save manual item
async function saveManualItem() {
  const name = document.getElementById('manual-item-name').value.trim();
  const price = parseFloat(document.getElementById('manual-item-price').value);
  
  if (!name || !price || price <= 0) {
    alert('Please enter valid item name and price');
    return;
  }
  
  try {
    // Create receipt first
    const receiptResponse = await fetch(`${API_BASE}/api/bills/${billId}/receipt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    
    if (!receiptResponse.ok) throw new Error('Failed to create receipt');
    
    const receiptData = await receiptResponse.json();
    
    // Add item
    await addItemToReceipt(receiptData.id, name, price);
    
    // Reload
    await loadBill();
    renderReceipts();
    closeAddManualItemModal();
  } catch (error) {
    console.error('Error saving manual item:', error);
    alert('Failed to save manual item');
  }
}

// Render receipts
function renderReceipts() {
  const container = document.getElementById('receipts-list');
  const noReceipts = document.getElementById('no-receipts');
  
  if (receipts.length === 0) {
    container.innerHTML = '';
    noReceipts.style.display = 'block';
    return;
  }
  
  noReceipts.style.display = 'none';
  
  container.innerHTML = receipts.map((receipt, index) => {
    const items = receipt.items || [];
    const total = items.reduce((sum, item) => sum + item.price, 0);
    const itemCount = items.filter(i => !i.is_tax_or_charge).length;
    
    return `
      <div class="card" style="background: var(--color-surface); margin-bottom: 16px;">
        <div class="flex-between mb-2">
          <div>
            <strong>Receipt ${index + 1}</strong>
            ${receipt.image_path ? '📸' : '✏️'}
            <div class="text-secondary text-sm">${itemCount} items • ${billData.currency_symbol}${total.toFixed(2)}</div>
          </div>
          <div class="flex-gap">
            <button onclick="editReceipt(${index})" class="btn btn-primary btn-sm">Edit</button>
            <button onclick="deleteReceipt(${index})" class="btn btn-danger btn-sm">Delete</button>
          </div>
        </div>
        
        <div class="text-sm">
          ${items.slice(0, 3).map(item => `
            <div class="flex-between" style="padding: 4px 0;">
              <span>${item.name}</span>
              <span>${billData.currency_symbol}${item.price.toFixed(2)}</span>
            </div>
          `).join('')}
          ${items.length > 3 ? `<div class="text-secondary">+ ${items.length - 3} more items</div>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

// Edit receipt
function editReceipt(index) {
  currentReceipt = receipts[index];
  
  document.getElementById('edit-receipt-modal').style.display = 'block';
  
  // Render items
  renderEditItems();
  
  // Render participant checkboxes
  renderEditParticipants();
  
  // Populate payer select
  const payerSelect = document.getElementById('edit-receipt-payer');
  payerSelect.innerHTML = '<option value="">Select payer...</option>' +
    participants.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
}

// Close edit receipt modal
function closeEditReceiptModal() {
  document.getElementById('edit-receipt-modal').style.display = 'none';
  currentReceipt = null;
}

// Render edit items
function renderEditItems() {
  const container = document.getElementById('edit-items-list');
  const items = currentReceipt.items || [];
  
  container.innerHTML = items.map((item, index) => `
    <div class="item-list-item">
      <div class="flex-between">
        <div>
          <strong>${item.name}</strong>
          <div class="text-secondary text-sm">${billData.currency_symbol}${item.price.toFixed(2)}</div>
        </div>
        <button onclick="deleteItemFromReceipt('${item.id}')" class="btn btn-danger btn-sm">Delete</button>
      </div>
    </div>
  `).join('');
}

// Render edit participants
function renderEditParticipants() {
  const container = document.getElementById('edit-receipt-participants');
  
  if (participants.length === 0) {
    container.innerHTML = '<div class="text-secondary text-sm">Add participants first</div>';
    return;
  }
  
  container.innerHTML = participants.map(p => `
    <div style="margin-bottom: 8px;">
      <label style="display: flex; align-items: center; gap: 8px;">
        <input type="checkbox" id="receipt-participant-${p.id}" class="receipt-participant-check">
        ${p.name}
      </label>
    </div>
  `).join('');
}

// Add item to current receipt
async function addItemToCurrentReceipt() {
  const name = document.getElementById('edit-new-item-name').value.trim();
  const price = parseFloat(document.getElementById('edit-new-item-price').value);
  
  if (!name || !price || price <= 0) {
    alert('Please enter valid item name and price');
    return;
  }
  
  try {
    await addItemToReceipt(currentReceipt.id, name, price);
    
    // Reload
    await loadBill();
    const receiptIndex = receipts.findIndex(r => r.id === currentReceipt.id);
    currentReceipt = receipts[receiptIndex];
    
    renderEditItems();
    document.getElementById('edit-new-item-name').value = '';
    document.getElementById('edit-new-item-price').value = '';
  } catch (error) {
    alert('Failed to add item');
  }
}

// Delete item from receipt
async function deleteItemFromReceipt(itemId) {
  if (!confirm('Delete this item?')) return;
  
  try {
    const response = await fetch(`${API_BASE}/api/bills/item/${itemId}`, {
      method: 'DELETE'
    });
    
    if (!response.ok) throw new Error('Failed to delete');
    
    // Reload
    await loadBill();
    const receiptIndex = receipts.findIndex(r => r.id === currentReceipt.id);
    currentReceipt = receipts[receiptIndex];
    
    renderEditItems();
  } catch (error) {
    console.error('Error deleting item:', error);
    alert('Failed to delete item');
  }
}

// Save receipt changes
async function saveReceiptChanges() {
  const selectedParticipants = participants.filter(p => {
    const checkbox = document.getElementById(`receipt-participant-${p.id}`);
    return checkbox && checkbox.checked;
  });
  
  const payerId = document.getElementById('edit-receipt-payer').value;
  
  if (selectedParticipants.length === 0) {
    alert('Please select at least one participant');
    return;
  }
  
  try {
    // Add splits for all items (equal split among selected participants)
    const items = currentReceipt.items.filter(item => !item.is_tax_or_charge);
    
    for (const item of items) {
      for (const p of selectedParticipants) {
        await fetch(`${API_BASE}/api/bills/item/${item.id}/split`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            participant_id: p.id,
            split_type: 'equal',
            value: 1
          })
        });
      }
    }
    
    // Set tax distribution to proportional for all tax items
    const taxItems = currentReceipt.items.filter(item => item.is_tax_or_charge);
    for (const item of taxItems) {
      await fetch(`${API_BASE}/api/bills/item/${item.id}/tax-distribution`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          distribution_type: 'proportional'
        })
      });
    }
    
    // Add payment if payer selected
    if (payerId) {
      const total = currentReceipt.items.reduce((sum, item) => sum + item.price, 0);
      await fetch(`${API_BASE}/api/bills/${billId}/payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payer_id: payerId,
          amount: total
        })
      });
    }
    
    closeEditReceiptModal();
    await loadBill();
    renderReceipts();
  } catch (error) {
    console.error('Error saving changes:', error);
    alert('Failed to save changes');
  }
}

// Delete receipt
async function deleteReceipt(index) {
  if (!confirm('Delete this receipt and all its items?')) return;
  
  // Note: Deletion is handled by CASCADE in database
  // For now, just reload to show it's gone
  alert('Receipt deletion not implemented yet. Use edit to remove items instead.');
}

// Finish and calculate
function finishAndCalculate() {
  if (receipts.length === 0) {
    alert('Please add at least one receipt or manual item');
    return;
  }
  
  if (participants.length < 2) {
    alert('Please add at least 2 participants');
    return;
  }
  
  // Check if all receipts have splits
  let hasUnconfigured = false;
  for (const receipt of receipts) {
    const items = receipt.items.filter(i => !i.is_tax_or_charge);
    for (const item of items) {
      if (!item.splits || item.splits.length === 0) {
        hasUnconfigured = true;
        break;
      }
    }
    if (hasUnconfigured) break;
  }
  
  if (hasUnconfigured) {
    if (!confirm('Some items are not assigned to participants. Continue anyway?')) {
      return;
    }
  }
  
  // Redirect to results
  window.location.href = `${BASE_PATH}/results.html?id=${billId}`;
}

// Close modals on overlay click
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay')) {
    closeAddReceiptModal();
    closeAddManualItemModal();
    closeEditReceiptModal();
  }
});