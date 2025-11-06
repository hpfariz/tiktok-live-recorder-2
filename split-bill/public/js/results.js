// Results JavaScript - UPDATED with receipt breakdown and payment details
const BASE_PATH = window.location.pathname.match(/^\/[^\/]+/)?.[0] || '';
const API_BASE = window.location.origin + BASE_PATH;

// Global state
let billId = null;
let billData = null;
let settlements = null;
let currentParticipantId = null;
let currentBreakdownTab = 'participant';

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

  await loadResults();
});

// Load bill and settlements
async function loadResults() {
  try {
    // Load bill data
    const billResponse = await fetch(`${API_BASE}/api/bills/${billId}`);
    if (!billResponse.ok) throw new Error('Failed to load bill');
    billData = await billResponse.json();
    
    // Load settlements
    const settlementsResponse = await fetch(`${API_BASE}/api/settlements/${billId}`);
    if (!settlementsResponse.ok) throw new Error('Failed to calculate settlements');
    settlements = await settlementsResponse.json();
    
    // Hide loading
    document.getElementById('loading-state').style.display = 'none';
    
    // Render everything
    renderBillInfo();
    renderParticipantsSummary();
    renderOptimizedSettlements();
    renderRawDebts();
    renderParticipantBreakdowns();
    renderReceiptBreakdowns(); // NEW
    renderReceipts();
    
  } catch (error) {
    console.error('Error loading results:', error);
    document.getElementById('loading-state').innerHTML = `
      <div class="alert alert-error">
        <strong>Error:</strong> ${error.message}
      </div>
      <button onclick="window.location.href='${BASE_PATH}/'" class="btn btn-primary mt-2">
        Go Back
      </button>
    `;
  }
}

// Render bill info
function renderBillInfo() {
  document.getElementById('bill-title-header').textContent = billData.title;
  
  // Calculate total
  let total = 0;
  if (billData.receipts) {
    for (const receipt of billData.receipts) {
      if (receipt.items) {
        total += receipt.items.reduce((sum, item) => sum + item.price, 0);
      }
    }
  }
  
  document.getElementById('bill-created').textContent = new Date(billData.created_at).toLocaleDateString();
  document.getElementById('bill-expires').textContent = new Date(billData.expires_at).toLocaleDateString();
  document.getElementById('bill-total').textContent = window.SplitBillUtils.formatPrice(total, billData.currency_symbol);
}

// Render participants summary
function renderParticipantsSummary() {
  const tbody = document.getElementById('participants-table');
  
  if (!settlements.participants || settlements.participants.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="text-center">No participants found</td></tr>';
    return;
  }
  
  tbody.innerHTML = settlements.participants.map(p => {
    const balanceClass = p.balance > 0 ? 'text-success' : p.balance < 0 ? 'text-danger' : '';
    const balanceText = p.balance > 0 ? `+${window.SplitBillUtils.formatPrice(p.balance, billData.currency_symbol)}` : 
                        p.balance < 0 ? `-${window.SplitBillUtils.formatPrice(Math.abs(p.balance), billData.currency_symbol)}` :
                        window.SplitBillUtils.formatPrice(0, billData.currency_symbol);
    
    return `
      <tr>
        <td><strong>${p.name}</strong></td>
        <td class="text-right">${window.SplitBillUtils.formatPrice(p.owes, billData.currency_symbol)}</td>
        <td class="text-right">${window.SplitBillUtils.formatPrice(p.paid, billData.currency_symbol)}</td>
        <td class="text-right ${balanceClass}"><strong>${balanceText}</strong></td>
      </tr>
    `;
  }).join('');
}

// Render optimized settlements
function renderOptimizedSettlements() {
  const container = document.getElementById('optimized-settlements');
  
  if (!settlements.optimized_settlements || settlements.optimized_settlements.length === 0) {
    container.innerHTML = `
      <div class="alert alert-success">
        <strong>✅ All settled!</strong> No payments needed.
      </div>
    `;
    return;
  }
  
  container.innerHTML = settlements.optimized_settlements.map(s => `
    <div class="settlement-item">
      <div>
        <strong>${s.from}</strong> pays <strong>${s.to}</strong>
      </div>
      <div class="settlement-amount">${window.SplitBillUtils.formatPrice(s.amount, billData.currency_symbol)}</div>
    </div>
  `).join('');
  
  // Add summary
  container.innerHTML += `
    <div class="text-secondary text-sm mt-3">
      <strong>${settlements.optimized_settlements.length}</strong> payment${settlements.optimized_settlements.length !== 1 ? 's' : ''} needed to settle everything
    </div>
  `;
}

// Render raw debts
function renderRawDebts() {
  const container = document.getElementById('raw-debts');
  
  if (!settlements.raw_debts || settlements.raw_debts.length === 0) {
    container.innerHTML = '<div class="text-secondary">No debts to display</div>';
    return;
  }
  
  container.innerHTML = settlements.raw_debts.map(d => `
    <div class="settlement-item" style="background: white;">
      <div>
        <strong>${d.from}</strong> owes <strong>${d.to}</strong>
      </div>
      <div>${window.SplitBillUtils.formatPrice(d.amount, billData.currency_symbol)}</div>
    </div>
  `).join('');
}

// Toggle raw debts visibility
function toggleRawDebts() {
  const content = document.getElementById('raw-debts-content');
  const toggle = document.getElementById('raw-debts-toggle');
  
  if (content.style.display === 'none') {
    content.style.display = 'block';
    toggle.textContent = '▲';
  } else {
    content.style.display = 'none';
    toggle.textContent = '▼';
  }
}

// Switch breakdown tab - NEW
function switchBreakdownTab(tab) {
  currentBreakdownTab = tab;
  
  // Update tab buttons
  document.querySelectorAll('.tab').forEach(btn => {
    btn.classList.remove('active');
  });
  event.target.classList.add('active');
  
  // Update tab content
  document.getElementById('breakdown-by-participant').classList.remove('active');
  document.getElementById('breakdown-by-receipt').classList.remove('active');
  
  if (tab === 'participant') {
    document.getElementById('breakdown-by-participant').classList.add('active');
  } else {
    document.getElementById('breakdown-by-receipt').classList.add('active');
  }
}

// Render participant breakdowns
function renderParticipantBreakdowns() {
  const container = document.getElementById('participant-breakdowns');
  
  if (!settlements.participants || settlements.participants.length === 0) {
    container.innerHTML = '<div class="text-secondary">No participants found</div>';
    return;
  }
  
  container.innerHTML = settlements.participants.map(p => `
    <button 
      onclick="showParticipantBreakdown('${p.id}', '${p.name.replace(/'/g, "\\'")}')" 
      class="btn btn-ghost btn-block mb-2"
      style="text-align: left;"
    >
      <div class="flex-between">
        <span><strong>${p.name}</strong></span>
        <span>${window.SplitBillUtils.formatPrice(p.owes, billData.currency_symbol)}</span>
      </div>
    </button>
  `).join('');
}

// Render receipt breakdowns - NEW
async function renderReceiptBreakdowns() {
  const container = document.getElementById('receipt-breakdowns');
  
  if (!billData.receipts || billData.receipts.length === 0) {
    container.innerHTML = '<div class="text-secondary">No receipts found</div>';
    return;
  }
  
  container.innerHTML = '';
  
  for (let i = 0; i < billData.receipts.length; i++) {
    const receipt = billData.receipts[i];
    const items = receipt.items || [];
    const total = items.reduce((sum, item) => sum + item.price, 0);
    
    // Get payer name
    let payerName = 'Unknown';
    if (billData.payments) {
      const payment = billData.payments.find(p => p.receipt_id === receipt.id);
      if (payment) {
        payerName = payment.payer_name;
      }
    }
    
    const itemCount = items.filter(i => !i.is_tax_or_charge).length;
    
    const accordionItem = document.createElement('div');
    accordionItem.className = 'accordion-item';
    accordionItem.innerHTML = `
      <div class="accordion-header" onclick="toggleReceiptAccordion(${i})">
        <div>
          <div class="accordion-title">Receipt ${i + 1} ${receipt.image_path ? '📸' : '✏️'}</div>
          <div class="text-secondary text-sm">
            ${itemCount} item${itemCount !== 1 ? 's' : ''} • ${window.SplitBillUtils.formatPrice(total, billData.currency_symbol)} • Paid by ${payerName}
          </div>
        </div>
        <span class="accordion-icon">▼</span>
      </div>
      <div class="accordion-content">
        <div class="accordion-body" id="receipt-accordion-${i}">
          <div class="loading">Loading items...</div>
        </div>
      </div>
    `;
    
    container.appendChild(accordionItem);
  }
}

// Toggle receipt accordion - NEW
async function toggleReceiptAccordion(index) {
  const accordionItem = document.querySelectorAll('.accordion-item')[index];
  const isOpen = accordionItem.classList.contains('open');
  
  if (isOpen) {
    accordionItem.classList.remove('open');
    return;
  }
  
  accordionItem.classList.add('open');
  
  // Load receipt breakdown if not loaded
  const contentDiv = document.getElementById(`receipt-accordion-${index}`);
  if (contentDiv.innerHTML.includes('Loading')) {
    await loadReceiptBreakdown(index, contentDiv);
  }
}

// Load receipt breakdown - NEW
async function loadReceiptBreakdown(index, contentDiv) {
  try {
    const receipt = billData.receipts[index];
    const response = await fetch(`${API_BASE}/api/settlements/${billId}/receipt/${receipt.id}`);
    
    if (!response.ok) throw new Error('Failed to load breakdown');
    
    const breakdown = await response.json();
    
    let html = '';
    
    for (const item of breakdown.items) {
      const assigneeNames = item.assignees.map(a => {
        let display = a.name;
        if (a.split_type === 'fixed') {
          display += ` (${window.SplitBillUtils.formatPrice(a.value, billData.currency_symbol)})`;
        } else if (a.split_type === 'percent') {
          display += ` (${a.value}%)`;
        } else if (a.split_type === 'quantity') {
          display += ` (${a.value}x)`;
        }
        return display;
      }).join(', ') || 'Not assigned';
      
      const itemDisplay = window.SplitBillUtils.formatItemDisplayHTML(item, billData.currency_symbol);
      
      html += `
        <div class="receipt-item-row">
          <div class="receipt-item-name">
            ${itemDisplay}
            ${item.is_tax_or_charge ? '<span class="badge" style="margin-left: 8px;">Tax/Charge</span>' : ''}
          </div>
          <div class="receipt-item-assignees">${assigneeNames}</div>
          <div class="receipt-item-price">${window.SplitBillUtils.formatPrice(item.price, billData.currency_symbol)}</div>
        </div>
      `;
    }
    
    contentDiv.innerHTML = html;
  } catch (error) {
    console.error('Error loading receipt breakdown:', error);
    contentDiv.innerHTML = '<div class="alert alert-error">Failed to load breakdown</div>';
  }
}

// Show participant breakdown
async function showParticipantBreakdown(participantId, participantName) {
  currentParticipantId = participantId;
  
  try {
    const response = await fetch(`${API_BASE}/api/settlements/${billId}/participant/${participantId}`);
    if (!response.ok) throw new Error('Failed to load breakdown');
    
    const breakdown = await response.json();
    
    document.getElementById('breakdown-participant-name').textContent = participantName;
    document.getElementById('breakdown-total').textContent = 
      window.SplitBillUtils.formatPrice(breakdown.total, breakdown.currency_symbol);
    
    const itemsList = document.getElementById('breakdown-items-list');
    
    if (breakdown.items.length === 0) {
      itemsList.innerHTML = '<div class="text-secondary">No items assigned</div>';
    } else {
      itemsList.innerHTML = breakdown.items.map(item => {
        const itemDisplay = window.SplitBillUtils.formatItemDisplayHTML(item, breakdown.currency_symbol);
        
        return `
          <div class="flex-between" style="padding: 8px 0; border-bottom: 1px solid var(--color-border);">
            <div>
              <div>${itemDisplay}</div>
              <div class="text-secondary text-sm">
                ${item.split_type === 'equal' ? 'Equal split' :
                  item.split_type === 'fixed' ? 'Fixed amount' :
                  item.split_type === 'percent' ? `${item.split_value}%` :
                  item.split_type === 'quantity' ? `${item.split_value} items` :
                  item.split_type === 'proportional' ? 'Proportional' : ''}
              </div>
            </div>
            <div>${window.SplitBillUtils.formatPrice(item.amount, breakdown.currency_symbol)}</div>
          </div>
        `;
      }).join('');
    }
    
    // Load payment details - NEW
    await loadPaymentDetails(participantId);
    
    document.getElementById('breakdown-modal').style.display = 'block';
  } catch (error) {
    console.error('Error loading breakdown:', error);
    alert('Failed to load breakdown');
  }
}

// Load payment details - NEW
async function loadPaymentDetails(participantId) {
  try {
    const response = await fetch(`${API_BASE}/api/payment-details/${participantId}`);
    if (!response.ok) {
      document.getElementById('breakdown-payment-details').style.display = 'none';
      return;
    }
    
    const paymentDetails = await response.json();
    
    const detailsSection = document.getElementById('breakdown-payment-details');
    const detailsList = document.getElementById('breakdown-payment-details-list');
    
    if (paymentDetails.length === 0) {
      detailsList.innerHTML = `
        <div class="payment-details-empty">
          No payment details added yet. Click "+ Add" to add payment information.
        </div>
      `;
    } else {
      detailsList.innerHTML = paymentDetails.map(detail => `
        <div class="payment-detail-item">
          <div class="payment-detail-info">
            <div class="payment-detail-provider">
              ${detail.provider_name}
              ${detail.is_primary ? '<span class="payment-detail-primary-badge">Primary</span>' : ''}
            </div>
            <div class="payment-detail-account">
              ${detail.account_number}
              <button class="copy-btn" onclick="copyAccountNumber('${detail.account_number}', event)">
                📋 Copy
              </button>
            </div>
          </div>
          <div class="payment-detail-actions">
            <button class="btn btn-secondary btn-sm" onclick="deletePaymentDetail('${detail.id}')">Delete</button>
          </div>
        </div>
      `).join('');
    }
    
    detailsSection.style.display = 'block';
  } catch (error) {
    console.error('Error loading payment details:', error);
    document.getElementById('breakdown-payment-details').style.display = 'none';
  }
}

// Copy account number - NEW
async function copyAccountNumber(accountNumber, event) {
  const button = event.target;
  const success = await window.SplitBillUtils.copyToClipboard(accountNumber);
  
  if (success) {
    window.SplitBillUtils.showCopyFeedback(button);
  } else {
    alert('Failed to copy. Please copy manually: ' + accountNumber);
  }
}

// Show add payment detail modal - NEW
function showAddPaymentDetailModal() {
  document.getElementById('payment-provider').value = '';
  document.getElementById('payment-account').value = '';
  document.getElementById('payment-is-primary').checked = false;
  document.getElementById('add-payment-detail-modal').style.display = 'block';
}

// Close add payment detail modal - NEW
function closeAddPaymentDetailModal() {
  document.getElementById('add-payment-detail-modal').style.display = 'none';
}

// Save payment detail - NEW
async function savePaymentDetail() {
  const provider = document.getElementById('payment-provider').value.trim();
  const account = document.getElementById('payment-account').value.trim();
  const isPrimary = document.getElementById('payment-is-primary').checked;
  
  if (!provider || !account) {
    alert('Please fill in all fields');
    return;
  }
  
  try {
    const response = await fetch(`${API_BASE}/api/payment-details`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        participant_id: currentParticipantId,
        provider_name: provider,
        account_number: account,
        is_primary: isPrimary
      })
    });
    
    if (!response.ok) throw new Error('Failed to save payment detail');
    
    closeAddPaymentDetailModal();
    await loadPaymentDetails(currentParticipantId);
  } catch (error) {
    console.error('Error saving payment detail:', error);
    alert('Failed to save payment detail');
  }
}

// Delete payment detail - NEW
async function deletePaymentDetail(detailId) {
  if (!confirm('Delete this payment detail?')) return;
  
  try {
    const response = await fetch(`${API_BASE}/api/payment-details/${detailId}`, {
      method: 'DELETE'
    });
    
    if (!response.ok) throw new Error('Failed to delete payment detail');
    
    await loadPaymentDetails(currentParticipantId);
  } catch (error) {
    console.error('Error deleting payment detail:', error);
    alert('Failed to delete payment detail');
  }
}

// Close breakdown modal
function closeBreakdownModal() {
  document.getElementById('breakdown-modal').style.display = 'none';
  currentParticipantId = null;
}

// Render receipts
function renderReceipts() {
  if (!billData.receipts || billData.receipts.length === 0) {
    return; // Keep card hidden
  }
  
  const card = document.getElementById('receipts-card');
  const gallery = document.getElementById('receipts-gallery');
  
  card.style.display = 'block';
  
  gallery.innerHTML = billData.receipts.map((receipt, index) => {
    const imagePath = receipt.image_path ? `${API_BASE}/${receipt.image_path}` : null;
    const items = receipt.items || [];
    const total = items.reduce((sum, item) => sum + item.price, 0);
    
    // Get payer name for this receipt
    let payerName = 'Unknown';
    if (billData.payments) {
      const payment = billData.payments.find(p => p.receipt_id === receipt.id);
      if (payment) {
        payerName = payment.payer_name;
      }
    }
    
    // If there's an image, show it
    if (imagePath) {
      return `
        <div>
          <div style="cursor: pointer;" onclick="showReceiptImage('${imagePath}', ${index + 1}, '${payerName}')">
            <div class="receipt-preview">
              <img src="${imagePath}" alt="Receipt ${index + 1}">
            </div>
          </div>
          <div class="text-center text-sm mt-1">
            <strong>Receipt ${index + 1}</strong> 📸<br>
            ${window.SplitBillUtils.formatPrice(total, billData.currency_symbol)}<br>
            <span style="color: var(--color-text-secondary);">Paid by <strong>${payerName}</strong></span>
          </div>
        </div>
      `;
    } else {
      // Manual item - show card with item details
      const itemCount = items.filter(i => !i.is_tax_or_charge).length;
      return `
        <div>
          <div class="card" style="cursor: pointer; min-height: 150px; display: flex; flex-direction: column; justify-content: center;" onclick="showReceiptDetails(${index})">
            <div class="text-center">
              <div style="font-size: 32px; margin-bottom: 8px;">✏️</div>
              <strong>Receipt ${index + 1}</strong><br>
              <span class="text-secondary text-sm">${itemCount} item${itemCount !== 1 ? 's' : ''}</span>
            </div>
          </div>
          <div class="text-center text-sm mt-1">
            ${window.SplitBillUtils.formatPrice(total, billData.currency_symbol)}<br>
            <span style="color: var(--color-text-secondary);">Paid by <strong>${payerName}</strong></span>
          </div>
        </div>
      `;
    }
  }).join('');
}

// Show receipt image with payer name
function showReceiptImage(imagePath, receiptNumber, payerName) {
  document.getElementById('receipt-modal-title').textContent = `Receipt ${receiptNumber}`;
  document.getElementById('receipt-modal-payer').textContent = `Paid by ${payerName}`;
  document.getElementById('receipt-modal-image').src = imagePath;
  
  const downloadBtn = document.getElementById('receipt-download-btn');
  downloadBtn.onclick = () => downloadReceiptImage(imagePath, receiptNumber);
  
  document.getElementById('receipt-modal').style.display = 'block';
}

// Show receipt details (for manual items)
function showReceiptDetails(receiptIndex) {
  const receipt = billData.receipts[receiptIndex];
  const items = receipt.items || [];
  
  // Get payer name
  let payerName = 'Unknown';
  if (billData.payments) {
    const payment = billData.payments.find(p => p.receipt_id === receipt.id);
    if (payment) {
      payerName = payment.payer_name;
    }
  }
  
  document.getElementById('receipt-details-modal-title').textContent = `Receipt ${receiptIndex + 1}`;
  document.getElementById('receipt-details-modal-payer').textContent = `Paid by ${payerName}`;
  
  const itemsList = document.getElementById('receipt-details-items-list');
  itemsList.innerHTML = items.map(item => {
    const itemDisplay = window.SplitBillUtils.formatItemDisplayHTML(item, billData.currency_symbol);
    
    return `
      <div class="flex-between" style="padding: 8px 0; border-bottom: 1px solid var(--color-border);">
        <div>
          ${itemDisplay}
          ${item.is_tax_or_charge ? '<span class="badge" style="margin-left: 8px;">Tax/Charge</span>' : ''}
        </div>
        <div>${window.SplitBillUtils.formatPrice(item.price, billData.currency_symbol)}</div>
      </div>
    `;
  }).join('');
  
  const total = items.reduce((sum, item) => sum + item.price, 0);
  document.getElementById('receipt-details-total').textContent = window.SplitBillUtils.formatPrice(total, billData.currency_symbol);
  
  document.getElementById('receipt-details-modal').style.display = 'block';
}

// Close receipt details modal
function closeReceiptDetailsModal() {
  document.getElementById('receipt-details-modal').style.display = 'none';
}

// Download receipt image
async function downloadReceiptImage(imagePath, receiptNumber) {
  try {
    const response = await fetch(imagePath);
    if (!response.ok) throw new Error('Failed to fetch image');
    
    const blob = await response.blob();
    const blobUrl = window.URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = `receipt-${receiptNumber}.jpg`;
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    window.URL.revokeObjectURL(blobUrl);
  } catch (error) {
    console.error('Download failed:', error);
    window.open(imagePath, '_blank');
  }
}

// Close receipt modal
function closeReceiptModal() {
  document.getElementById('receipt-modal').style.display = 'none';
}

// Share link
function shareLink() {
  const url = window.location.href;
  
  if (navigator.share) {
    navigator.share({
      title: billData.title,
      text: 'Split Bill Results',
      url: url
    }).catch(err => {
      console.log('Share failed:', err);
      copyToClipboard(url);
    });
  } else {
    copyToClipboard(url);
  }
}

// Copy to clipboard
async function copyToClipboard(text) {
  const success = await window.SplitBillUtils.copyToClipboard(text);
  if (success) {
    alert('Link copied to clipboard!');
  } else {
    prompt('Copy this link:', text);
  }
}

// Duplicate bill
async function duplicateBill() {
  if (!confirm('Create a copy of this bill to amend?')) return;
  
  try {
    const response = await fetch(`${API_BASE}/api/bills/${billId}/duplicate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    
    if (!response.ok) throw new Error('Failed to duplicate bill');
    
    const data = await response.json();
    
    // Redirect to the appropriate page based on mode
    if (billData.mode === 'single') {
      window.location.href = `${BASE_PATH}/single-bill.html?id=${data.id}`;
    } else {
      window.location.href = `${BASE_PATH}/multi-bill.html?id=${data.id}`;
    }
  } catch (error) {
    console.error('Error duplicating bill:', error);
    alert('Failed to duplicate bill');
  }
}

// Close modals on overlay click
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay')) {
    closeBreakdownModal();
    closeReceiptModal();
    closeReceiptDetailsModal();
    closeAddPaymentDetailModal();
  }
});