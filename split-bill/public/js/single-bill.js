// Single Bill JavaScript
const BASE_PATH = window.location.pathname.match(/^\/[^\/]+/)?.[0] || '';
const API_BASE = window.location.origin + BASE_PATH;

// Global state
let billId = null;
let billData = null;
let receiptId = null;
let items = [];
let participants = [];
let taxItems = [];
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
  setupReceiptUpload();
  setupParticipantInput();
});

// Load bill data
async function loadBill() {
  try {
    const response = await fetch(`${API_BASE}/api/bills/${billId}`);
    if (!response.ok) throw new Error('Failed to load bill');
    
    billData = await response.json();
    document.getElementById('bill-title-header').textContent = billData.title;
    
    // Load existing data if any
    if (billData.receipts && billData.receipts.length > 0) {
      receiptId = billData.receipts[0].id;
      items = billData.receipts[0].items || [];
    }
    
    if (billData.participants && billData.participants.length > 0) {
      participants = billData.participants;
    }
  } catch (error) {
    console.error('Error loading bill:', error);
    alert('Failed to load bill');
  }
}

// Setup receipt upload
function setupReceiptUpload() {
  const fileInput = document.getElementById('receipt-file');
  const processBtn = document.getElementById('process-ocr-btn');
  const previewDiv = document.getElementById('receipt-preview');
  const previewImg = document.getElementById('preview-image');
  
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    // Show preview
    const reader = new FileReader();
    reader.onload = (e) => {
      previewImg.src = e.target.result;
      previewDiv.style.display = 'block';
      processBtn.disabled = false;
    };
    reader.readAsDataURL(file);
  });
  
  processBtn.addEventListener('click', processReceipt);
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
  document.getElementById('process-ocr-btn').disabled = true;
  
  try {
    // Process with OCR
    const result = await window.GoogleOCR.processReceipt(file, (progress) => {
      document.getElementById('ocr-percent').textContent = progress;
    });
    
    if (!result.success) {
      throw new Error(result.error || 'OCR failed');
    }
    
    // Upload receipt to server
    const formData = new FormData();
    formData.append('receipt', file);
    formData.append('ocr_data', JSON.stringify(result.parsed));
    
    const response = await fetch(`${API_BASE}/api/bills/${billId}/receipt`, {
      method: 'POST',
      body: formData
    });
    
    if (!response.ok) throw new Error('Failed to upload receipt');
    
    const receiptData = await response.json();
    receiptId = receiptData.id;
    
    // Add items from OCR
    if (result.parsed.items && result.parsed.items.length > 0) {
      for (const item of result.parsed.items) {
        await addItemToServer(
          item.name, 
          item.price, 
          false, 
          null,
          item.quantity || 1,
          item.unitPrice || null
        );
      }
    }
    
    // Add tax/charges
    if (result.parsed.charges) {
      if (result.parsed.charges.tax) {
        await addItemToServer(result.parsed.charges.tax.name, result.parsed.charges.tax.amount, true, 'tax');
      }
      if (result.parsed.charges.serviceCharge) {
        await addItemToServer(result.parsed.charges.serviceCharge.name, result.parsed.charges.serviceCharge.amount, true, 'service');
      }
      if (result.parsed.charges.gratuity) {
        await addItemToServer(result.parsed.charges.gratuity.name, result.parsed.charges.gratuity.amount, true, 'gratuity');
      }
    }
    
    goToStep(2);
  } catch (error) {
    console.error('OCR Error:', error);
    alert('OCR processing failed. You can skip and add items manually.');
    document.getElementById('ocr-progress').style.display = 'none';
    document.getElementById('process-ocr-btn').disabled = false;
  }
}

// Skip OCR
async function skipOCR() {
  try {
    // Create empty receipt
    const response = await fetch(`${API_BASE}/api/bills/${billId}/receipt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    
    if (!response.ok) throw new Error('Failed to create receipt');
    
    const receiptData = await response.json();
    receiptId = receiptData.id;
    
    goToStep(2);
  } catch (error) {
    console.error('Error:', error);
    alert('Failed to skip OCR');
  }
}

// Add item to server
async function addItemToServer(name, price, isTax = false, chargeType = null, quantity = 1, unitPrice = null) {
  try {
    const response = await fetch(`${API_BASE}/api/bills/${billId}/receipt/${receiptId}/item`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        price: parseFloat(price),
        is_tax_or_charge: isTax ? 1 : 0,
        charge_type: chargeType,
        item_order: items.length,
        quantity: quantity,
        unit_price: unitPrice
      })
    });
    
    if (!response.ok) throw new Error('Failed to add item');
    
    const itemData = await response.json();
    items.push({ ...itemData, is_tax_or_charge: isTax ? 1 : 0, charge_type: chargeType, splits: [] });
    
    if (isTax) {
      taxItems.push(itemData);
    }
    
    return itemData;
  } catch (error) {
    console.error('Error adding item:', error);
    throw error;
  }
}

// Add item (manual)
async function addItem() {
  const name = document.getElementById('new-item-name').value.trim();
  const price = parseFloat(document.getElementById('new-item-price').value);
  
  if (!name || !price || price <= 0) {
    alert('Please enter valid item name and price');
    return;
  }
  
  try {
    await addItemToServer(name, price);
    renderItems();
    document.getElementById('new-item-name').value = '';
    document.getElementById('new-item-price').value = '';
  } catch (error) {
    alert('Failed to add item');
  }
}

// Delete item
async function deleteItem(itemId, index) {
  if (!confirm('Delete this item?')) return;
  
  try {
    const response = await fetch(`${API_BASE}/api/bills/item/${itemId}`, {
      method: 'DELETE'
    });
    
    if (!response.ok) throw new Error('Failed to delete');
    
    items.splice(index, 1);
    renderItems();
  } catch (error) {
    console.error('Error deleting item:', error);
    alert('Failed to delete item');
  }
}

// Render items list
function renderItems() {
  const container = document.getElementById('items-list');
  
  if (items.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="empty-state-text">No items yet. Add items manually or process a receipt.</div></div>';
    return;
  }
  
  const regularItems = items.filter(item => !item.is_tax_or_charge);
  
  container.innerHTML = regularItems.map((item, index) => `
    <div class="item-list-item">
      <div class="flex-between">
        <div>
          <strong>${item.quantity && item.quantity > 1 && item.unit_price 
            ? `${item.name} (${item.quantity}x${billData.currency_symbol}${item.unit_price.toFixed(2)})`
            : item.name}</strong>
          <div class="text-secondary text-sm">${billData.currency_symbol}${item.price.toFixed(2)}</div>
        </div>
        <button onclick="deleteItem('${item.id}', ${index})" class="btn btn-danger btn-sm">Delete</button>
      </div>
    </div>
  `).join('');
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
    document.getElementById('participants-error').style.display = 'none';
  } catch (error) {
    console.error('Error adding participant:', error);
    alert('Failed to add participant');
  }
}

// Remove participant
function removeParticipant(index) {
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

// Open split modal
function openSplitModal(itemId) {
  currentSplitItem = items.find(item => item.id === itemId);
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
            <option value="equal">Equal Split</option>
            ${currentSplitItem.quantity && currentSplitItem.quantity > 1 ? `<option value="quantity">By Quantity (max ${currentSplitItem.quantity})</option>` : ''}
            <option value="fixed">Fixed Amount</option>
            <option value="percent">Percentage</option>
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
    checkbox.addEventListener('change', (e) => {
      document.getElementById(`split-options-${p.id}`).style.display = e.target.checked ? 'block' : 'none';
    });
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
  
  // Clear existing splits for this item
  currentSplitItem.splits = [];
  
  try {
    for (const p of participants) {
      const checkbox = document.getElementById(`split-p-${p.id}`);
      
      if (checkbox && checkbox.checked) {
        const type = document.getElementById(`split-type-${p.id}`).value;
        let value = 1; // default for equal
        
        if (type !== 'equal') {
          value = parseFloat(document.getElementById(`split-value-${p.id}`).value) || 0;
          if (value <= 0) {
            alert(`Please enter a valid value for ${p.name}`);
            return;
          }
        }
        
        // Save to server
        const response = await fetch(`${API_BASE}/api/bills/item/${currentSplitItem.id}/split`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            participant_id: p.id,
            split_type: type,
            value: value
          })
        });
        
        if (!response.ok) throw new Error('Failed to save split');
        
        currentSplitItem.splits.push({ participant_id: p.id, split_type: type, value: value });
      }
    }
    
    closeSplitModal();
    renderSplitItems();
  } catch (error) {
    console.error('Error saving split:', error);
    alert('Failed to save split');
  }
}

// Close split modal
function closeSplitModal() {
  document.getElementById('split-modal').style.display = 'none';
  currentSplitItem = null;
}

// Render split items
function renderSplitItems() {
  const container = document.getElementById('split-items-list');
  const regularItems = items.filter(item => !item.is_tax_or_charge);
  
  if (regularItems.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="empty-state-text">No items to split</div></div>';
    return;
  }
  
  container.innerHTML = regularItems.map(item => {
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
          <button onclick="openSplitModal('${item.id}')" class="btn btn-primary btn-sm">
            ${splitCount > 0 ? 'Edit' : 'Assign'}
          </button>
        </div>
      </div>
    `;
  }).join('');
}

// Open tax modal
function openTaxModal(itemId) {
  currentTaxItem = items.find(item => item.id === itemId);
  if (!currentTaxItem) return;
  
  document.getElementById('tax-modal-title').textContent = currentTaxItem.name;
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
    const response = await fetch(`${API_BASE}/api/bills/item/${currentTaxItem.id}/tax-distribution`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        distribution_type: type
      })
    });
    
    if (!response.ok) throw new Error('Failed to save distribution');
    
    currentTaxItem.tax_distribution = type;
    closeTaxModal();
    renderTaxCharges();
  } catch (error) {
    console.error('Error saving tax distribution:', error);
    alert('Failed to save distribution');
  }
}

// Render tax charges
function renderTaxCharges() {
  const container = document.getElementById('tax-charges-list');
  const taxChargeItems = items.filter(item => item.is_tax_or_charge);
  
  if (taxChargeItems.length === 0) {
    document.getElementById('no-taxes-message').style.display = 'block';
    container.innerHTML = '';
    return;
  }
  
  document.getElementById('no-taxes-message').style.display = 'none';
  
  container.innerHTML = taxChargeItems.map(item => {
    const distType = item.tax_distribution || 'proportional';
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
          <button onclick="openTaxModal('${item.id}')" class="btn btn-primary btn-sm">Configure</button>
        </div>
      </div>
    `;
  }).join('');
}

// Populate payer select
function populatePayerSelect() {
  const select = document.getElementById('payer-select');
  select.innerHTML = '<option value="">Choose who paid...</option>' +
    participants.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
}

// Finish bill
async function finishBill() {
  const payerId = document.getElementById('payer-select').value;
  const amount = parseFloat(document.getElementById('payment-amount').value);
  
  if (!payerId || !amount || amount <= 0) {
    document.getElementById('payment-error').style.display = 'block';
    return;
  }
  
  try {
    const response = await fetch(`${API_BASE}/api/bills/${billId}/payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        payer_id: payerId,
        amount: amount
      })
    });
    
    if (!response.ok) throw new Error('Failed to save payment');
    
    // Redirect to results
    window.location.href = `${BASE_PATH}/results.html?id=${billId}`;
  } catch (error) {
    console.error('Error saving payment:', error);
    alert('Failed to save payment');
  }
}

// Step navigation
function goToStep(step) {
  // Validation
  if (step === 3 && items.filter(i => !i.is_tax_or_charge).length === 0) {
    alert('Please add at least one item');
    return;
  }
  
  if (step === 4 && participants.length < 2) {
    document.getElementById('participants-error').style.display = 'block';
    return;
  }
  
  // Hide all steps
  for (let i = 1; i <= 6; i++) {
    const stepEl = document.getElementById(`step-${i}`);
    const progressStep = document.querySelector(`.progress-step[data-step="${i}"]`);
    
    if (stepEl) stepEl.style.display = 'none';
    if (progressStep) {
      progressStep.classList.remove('active', 'completed');
      if (i < step) progressStep.classList.add('completed');
    }
  }
  
  // Show current step
  const currentStepEl = document.getElementById(`step-${step}`);
  const currentProgressStep = document.querySelector(`.progress-step[data-step="${step}"]`);
  
  if (currentStepEl) currentStepEl.style.display = 'block';
  if (currentProgressStep) currentProgressStep.classList.add('active');
  
  // Render step content
  if (step === 2) renderItems();
  if (step === 3) renderParticipants();
  if (step === 4) renderSplitItems();
  if (step === 5) renderTaxCharges();
  if (step === 6) {
    populatePayerSelect();
    // Calculate total
    const total = items.reduce((sum, item) => sum + item.price, 0);
    document.getElementById('payment-amount').value = total.toFixed(2);
  }
  
  window.scrollTo(0, 0);
}

// Close modals on overlay click
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay')) {
    closeSplitModal();
    closeTaxModal();
  }
});