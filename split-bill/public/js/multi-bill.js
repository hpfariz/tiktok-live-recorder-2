// Multi-Bill JavaScript - Complete with Deletion Features
const BASE_PATH = window.location.pathname.match(/^\/[^\/]+/)?.[0] || '';
const API_BASE = window.location.origin + BASE_PATH;

// Global state
let billId = null;
let billData = null;
let receipts = [];
let participants = [];
let currentReceipt = null;
let currentOCRResult = null;
let currentSplitItem = null;
let currentTaxItem = null;

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
    const result = await window.GoogleOCR.processReceipt(file, (progress) => {
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
      await addItemToReceipt(
        receiptData.id, 
        item.name, 
        item.price, 
        false, 
        null,
        item.quantity || 1,
        item.unitPrice || null
      );
    }
    
    // Add tax/charges
    if (currentOCRResult.charges) {
      if (currentOCRResult.charges.tax) {
        await addItemToReceipt(
          receiptData.id, 
          currentOCRResult.charges.tax.name, 
          currentOCRResult.charges.tax.amount, 
          true, 
          'tax',
          1,
          null
        );
      }
      if (currentOCRResult.charges.serviceCharge) {
        await addItemToReceipt(
          receiptData.id, 
          currentOCRResult.charges.serviceCharge.name, 
          currentOCRResult.charges.serviceCharge.amount, 
          true, 
          'service',
          1,
          null
        );
      }
      if (currentOCRResult.charges.gratuity) {
        await addItemToReceipt(
          receiptData.id, 
          currentOCRResult.charges.gratuity.name, 
          currentOCRResult.charges.gratuity.amount, 
          true, 
          'gratuity',
          1,
          null
        );
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
async function addItemToReceipt(receiptId, name, price, isTax = false, chargeType = null, quantity = 1, unitPrice = null) {
  try {
    const response = await fetch(`${API_BASE}/api/bills/${billId}/receipt/${receiptId}/item`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        price: parseFloat(price),
        is_tax_or_charge: isTax ? 1 : 0,
        charge_type: chargeType,
        quantity: quantity,
        unit_price: unitPrice
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
    
    // Add item (manual items default to quantity 1)
    await addItemToReceipt(receiptData.id, name, price, false, null, 1, price);
    
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
    
    // Check if receipt is configured (has splits)
    const isConfigured = items.some(i => i.splits && i.splits.length > 0);
    const statusBadge = isConfigured 
      ? '<span class="badge" style="background: #e8e8e8;">✓ Configured</span>'
      : '<span class="badge" style="background: #f5f5f5;">Not configured</span>';
    
    return `
      <div class="card" style="background: var(--color-surface); margin-bottom: 16px;">
        <div class="flex-between mb-2">
          <div>
            <strong>Receipt ${index + 1}</strong>
            ${receipt.image_path ? '📸' : '✏️'}
            ${statusBadge}
            <div class="text-secondary text-sm">${itemCount} items • ${billData.currency_symbol}${total.toFixed(2)}</div>
          </div>
          <div class="flex-gap">
            <button onclick="configureReceipt(${index})" class="btn btn-primary btn-sm">Configure</button>
            <button onclick="deleteReceipt(${index})" class="btn btn-danger btn-sm">Delete</button>
          </div>
        </div>
        
        <div class="text-sm">
          ${items.slice(0, 3).map(item => {
            const displayName = (item.quantity && item.quantity > 1 && item.unit_price) 
              ? `${item.name} (${item.quantity}x)`
              : item.name;
            
            return `
              <div class="flex-between" style="padding: 4px 0;">
                <span>${displayName}</span>
                <span>${billData.currency_symbol}${item.price.toFixed(2)}</span>
              </div>
            `;
          }).join('')}
          ${items.length > 3 ? `<div class="text-secondary">+ ${items.length - 3} more items</div>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

// Delete receipt
async function deleteReceipt(index) {
  const receipt = receipts[index];
  
  if (!confirm('Delete this receipt and all its items? This cannot be undone.')) return;
  
  try {
    const response = await fetch(`${API_BASE}/api/bills/receipt/${receipt.id}`, {
      method: 'DELETE'
    });
    
    if (!response.ok) throw new Error('Failed to delete receipt');
    
    // Reload bill data
    await loadBill();
    renderReceipts();
  } catch (error) {
    console.error('Error deleting receipt:', error);
    alert('Failed to delete receipt');
  }
}

// Delete item from receipt
async function deleteItemFromReceipt(itemId) {
  if (!confirm('Delete this item?')) return;
  
  try {
    const response = await fetch(`${API_BASE}/api/bills/item/${itemId}`, {
      method: 'DELETE'
    });
    
    if (!response.ok) throw new Error('Failed to delete item');
    
    // Reload current receipt data
    await loadBill();
    const receiptIndex = receipts.findIndex(r => r.id === currentReceipt.id);
    currentReceipt = receipts[receiptIndex];
    
    renderConfigureItems();
    renderConfigureTaxes();
  } catch (error) {
    console.error('Error deleting item:', error);
    alert('Failed to delete item');
  }
}

// Configure receipt (full split configuration)
function configureReceipt(index) {
  if (participants.length === 0) {
    alert('Please add participants first');
    return;
  }
  
  currentReceipt = receipts[index];
  
  document.getElementById('configure-receipt-modal').style.display = 'block';
  document.getElementById('configure-receipt-title').textContent = `Receipt ${index + 1}`;
  
  // Render items for split configuration
  renderConfigureItems();
  
  // Render tax items for distribution configuration
  renderConfigureTaxes();
  
  // Populate payer select
  const payerSelect = document.getElementById('configure-receipt-payer');
  payerSelect.innerHTML = '<option value="">Select payer...</option>' +
    participants.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
  
  // Pre-select payer if already set
  const existingPayment = billData.payments?.find(pay => 
    currentReceipt.items.some(item => item.receipt_id === currentReceipt.id)
  );
  if (existingPayment) {
    payerSelect.value = existingPayment.payer_id;
  }
}

// Close configure receipt modal
function closeConfigureReceiptModal() {
  document.getElementById('configure-receipt-modal').style.display = 'none';
  currentReceipt = null;
}

// Render items for split configuration
function renderConfigureItems() {
  const container = document.getElementById('configure-items-list');
  const items = currentReceipt.items.filter(item => !item.is_tax_or_charge);
  
  if (items.length === 0) {
    container.innerHTML = '<div class="text-secondary">No items to configure</div>';
    return;
  }
  
  container.innerHTML = items.map(item => {
    const splitCount = (item.splits || []).length;
    const splitText = splitCount > 0 
      ? `Split among ${splitCount} ${splitCount === 1 ? 'person' : 'people'}`
      : 'Not assigned yet';
    
    const qtyText = (item.quantity && item.quantity > 1 && item.unit_price) 
      ? ` (${item.quantity}x ${billData.currency_symbol}${item.unit_price.toFixed(2)})` 
      : '';

    return `
      <div class="item-list-item">
        <div class="flex-between">
          <div>
            <strong>${item.name}${qtyText}</strong>
            <div class="text-secondary text-sm">${billData.currency_symbol}${item.price.toFixed(2)}</div>
            <div class="text-sm mt-1">${splitText}</div>
          </div>
          <div class="flex-gap">
            <button onclick="openSplitModal('${item.id}')" class="btn btn-primary btn-sm">
              ${splitCount > 0 ? 'Edit Split' : 'Assign'}
            </button>
            <button onclick="deleteItemFromReceipt('${item.id}')" class="btn btn-danger btn-sm">Delete</button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// Render tax items for distribution configuration
function renderConfigureTaxes() {
  const container = document.getElementById('configure-tax-list');
  const taxItems = currentReceipt.items.filter(item => item.is_tax_or_charge);
  
  if (taxItems.length === 0) {
    document.getElementById('configure-tax-section').style.display = 'none';
    return;
  }
  
  document.getElementById('configure-tax-section').style.display = 'block';
  
  container.innerHTML = taxItems.map(item => {
    const taxDist = item.tax_distribution;
    const distType = taxDist?.distribution_type || 'proportional';
    const distText = {
      'proportional': 'Proportional',
      'equal': 'Equal split',
      'none': 'Not included'
    }[distType] || 'Not configured';
    
    return `
      <div class="item-list-item">
        <div class="flex-between">
          <div>
            <strong>${item.name}</strong>
            <div class="text-secondary text-sm">${billData.currency_symbol}${item.price.toFixed(2)}</div>
            <div class="text-sm mt-1">${distText}</div>
          </div>
          <div class="flex-gap">
            <button onclick="openTaxModal('${item.id}')" class="btn btn-primary btn-sm">Configure</button>
            <button onclick="deleteItemFromReceipt('${item.id}')" class="btn btn-danger btn-sm">Delete</button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// Open split modal (same as single-bill)
function openSplitModal(itemId) {
  currentSplitItem = currentReceipt.items.find(item => item.id === itemId);
  if (!currentSplitItem) return;
  
  document.getElementById('split-modal-title').textContent = currentSplitItem.name;
  
  // Render participants with split options
  const container = document.getElementById('split-participants-list');
  container.innerHTML = participants.map(p => {
    const existingSplit = (currentSplitItem.splits || []).find(s => s.participant_id === p.id);
    
    return `
      <div class="form-group">
        <label class="form-label">
          <input type="checkbox" id="split-p-${p.id}" ${existingSplit ? 'checked' : ''}>
          ${p.name}
        </label>
        
        <div id="split-options-${p.id}" style="display: ${existingSplit ? 'block' : 'none'}; margin-top: 8px; margin-left: 24px;">
          <select class="form-select mb-1" id="split-type-${p.id}" onchange="updateSplitOptions('${p.id}')">
            <option value="equal" ${existingSplit?.split_type === 'equal' ? 'selected' : ''}>Equal Split</option>
            ${currentSplitItem.quantity && currentSplitItem.quantity > 1 ? `<option value="quantity" ${existingSplit?.split_type === 'quantity' ? 'selected' : ''}>By Quantity (max ${currentSplitItem.quantity})</option>` : ''}
            <option value="fixed" ${existingSplit?.split_type === 'fixed' ? 'selected' : ''}>Fixed Amount</option>
            <option value="percent" ${existingSplit?.split_type === 'percent' ? 'selected' : ''}>Percentage</option>
          </select>
          
          <div id="split-value-container-${p.id}" style="display: ${existingSplit && existingSplit.split_type !== 'equal' ? 'block' : 'none'};">
            <input type="number" class="form-input" id="split-value-${p.id}" 
              placeholder="${existingSplit ? 
              (existingSplit.split_type === 'percent' ? 'Percentage' : 
              existingSplit.split_type === 'quantity' ? `Quantity (max ${currentSplitItem.quantity})` : 
              'Amount') : 'Value'}"
              ${existingSplit && existingSplit.split_type === 'quantity' ? 'step="1" min="1" max="' + currentSplitItem.quantity + '"' : 'step="0.01"'}
              value="${existingSplit && existingSplit.split_type !== 'equal' ? existingSplit.value : ''}">
          </div>
        </div>
      </div>
    `;
  }).join('');
  
  // Add event listeners
  participants.forEach(p => {
    const checkbox = document.getElementById(`split-p-${p.id}`);
    if (checkbox) {
      checkbox.addEventListener('change', (e) => {
        document.getElementById(`split-options-${p.id}`).style.display = e.target.checked ? 'block' : 'none';
      });
    }
  });
  
  document.getElementById('split-modal').style.display = 'block';
}

// Update split options visibility
function updateSplitOptions(participantId) {
  const type = document.getElementById(`split-type-${participantId}`).value;
  const container = document.getElementById(`split-value-container-${participantId}`);
  
  if (type === 'equal') {
    container.style.display = 'none';
  } else {
    container.style.display = 'block';
    const input = document.getElementById(`split-value-${participantId}`);
    
    if (type === 'percent') {
      input.placeholder = 'Percentage';
      input.step = '0.01';
      input.removeAttribute('min');
      input.removeAttribute('max');
    } else if (type === 'quantity' && currentSplitItem.quantity) {
      input.placeholder = `Quantity (max ${currentSplitItem.quantity})`;
      input.step = '1';
      input.min = '1';
      input.max = currentSplitItem.quantity;
    } else {
      input.placeholder = 'Amount';
      input.step = '0.01';
      input.removeAttribute('min');
      input.removeAttribute('max');
    }
  }
}

// Save split
async function saveSplit() {
  if (!currentSplitItem) return;
  
  try {
    // Delete existing splits first
    const deleteResponse = await fetch(`${API_BASE}/api/bills/item/${currentSplitItem.id}/splits`, {
      method: 'DELETE'
    });
    
    if (!deleteResponse.ok) {
      console.warn('Could not delete existing splits, continuing anyway');
    }
    
    currentSplitItem.splits = [];
    
    // Add new splits
    for (const p of participants) {
      const checkbox = document.getElementById(`split-p-${p.id}`);
      
      if (checkbox && checkbox.checked) {
        const type = document.getElementById(`split-type-${p.id}`).value;
        let value = 1;
        
        if (type !== 'equal') {
          value = parseFloat(document.getElementById(`split-value-${p.id}`).value) || 0;
          if (value <= 0) {
            alert(`Please enter a valid value for ${p.name}`);
            return;
          }
        }
        
        // Validate quantity splits
        if (type === 'quantity') {
          if (!currentSplitItem.quantity || currentSplitItem.quantity < 1) {
            alert(`Cannot split by quantity - item has no quantity information`);
            return;
          }
          if (value > currentSplitItem.quantity) {
            alert(`${p.name}'s quantity (${value}) exceeds available quantity (${currentSplitItem.quantity})`);
            return;
          }
        }
        
        const response = await fetch(`${API_BASE}/api/bills/item/${currentSplitItem.id}/split`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            participant_id: p.id,
            split_type: type,
            value: value
          })
        });
        
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Failed to save split');
        }
        
        currentSplitItem.splits.push({ participant_id: p.id, split_type: type, value: value });
      }
    }
    
    closeSplitModal();
    
    // Reload current receipt data
    await loadBill();
    const receiptIndex = receipts.findIndex(r => r.id === currentReceipt.id);
    currentReceipt = receipts[receiptIndex];
    
    renderConfigureItems();
  } catch (error) {
    console.error('Error saving split:', error);
    alert(`Failed to save split: ${error.message}`);
  }
}

// Close split modal
function closeSplitModal() {
  document.getElementById('split-modal').style.display = 'none';
  currentSplitItem = null;
}

// Open tax modal
function openTaxModal(itemId) {
  currentTaxItem = currentReceipt.items.find(item => item.id === itemId);
  if (!currentTaxItem) return;
  
  document.getElementById('tax-modal-title').textContent = currentTaxItem.name;
  
  // Pre-select existing distribution type
  const existingDist = currentTaxItem.tax_distribution?.distribution_type || 'proportional';
  document.getElementById('tax-distribution-type').value = existingDist;
  
  document.getElementById('tax-modal').style.display = 'block';
}

// Close tax modal
function closeTaxModal() {
  document.getElementById('tax-modal').style.display = 'none';
  currentTaxItem = null;
}

// Save tax distribution
async function saveTaxDistribution() {
  if (!currentTaxItem) return;
  
  const type = document.getElementById('tax-distribution-type').value;
  
  try {
    // Save distribution type
    const response = await fetch(`${API_BASE}/api/bills/item/${currentTaxItem.id}/tax-distribution`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        distribution_type: type
      })
    });
    
    if (!response.ok) throw new Error('Failed to save distribution');
    
    // Delete existing tax splits
    await fetch(`${API_BASE}/api/bills/item/${currentTaxItem.id}/splits`, {
      method: 'DELETE'
    });
    
    // Create splits for participants based on distribution type
    if (type === 'equal' || type === 'proportional') {
      // Get participants who have splits in this receipt's items
      const receiptItems = currentReceipt.items.filter(i => !i.is_tax_or_charge);
      const participantsInReceipt = new Set();
      
      for (const item of receiptItems) {
        if (item.splits) {
          item.splits.forEach(split => participantsInReceipt.add(split.participant_id));
        }
      }
      
      // Create splits for these participants
      for (const pId of participantsInReceipt) {
        await fetch(`${API_BASE}/api/bills/item/${currentTaxItem.id}/split`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            participant_id: pId,
            split_type: 'equal',
            value: 1
          })
        });
      }
    }
    
    closeTaxModal();
    
    // Reload current receipt data
    await loadBill();
    const receiptIndex = receipts.findIndex(r => r.id === currentReceipt.id);
    currentReceipt = receipts[receiptIndex];
    
    renderConfigureTaxes();
  } catch (error) {
    console.error('Error saving tax distribution:', error);
    alert('Failed to save distribution');
  }
}

// Save receipt configuration
async function saveReceiptConfiguration() {
  const payerId = document.getElementById('configure-receipt-payer').value;
  
  // Validate all items have splits
  const items = currentReceipt.items.filter(item => !item.is_tax_or_charge);
  const unconfiguredItems = items.filter(item => !item.splits || item.splits.length === 0);
  
  if (unconfiguredItems.length > 0) {
    if (!confirm(`${unconfiguredItems.length} item(s) are not configured. Continue anyway?`)) {
      return;
    }
  }
  
  try {
    // Add/update payment if payer selected
    if (payerId) {
      const total = currentReceipt.items.reduce((sum, item) => sum + item.price, 0);
      await fetch(`${API_BASE}/api/bills/${billId}/payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payer_id: payerId,
          amount: total,
          receipt_id: currentReceipt.id
        })
      });
    }
    
    closeConfigureReceiptModal();
    await loadBill();
    renderReceipts();
  } catch (error) {
    console.error('Error saving configuration:', error);
    alert('Failed to save configuration');
  }
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
    if (!confirm('Some items are not configured. Continue anyway?')) {
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
    closeConfigureReceiptModal();
    closeSplitModal();
    closeTaxModal();
  }
});