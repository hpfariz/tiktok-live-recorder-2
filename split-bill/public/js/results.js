// Results JavaScript - UPDATED with improved download and receipt display
const BASE_PATH = window.location.pathname.match(/^\/[^\/]+/)?.[0] || '';
const API_BASE = window.location.origin + BASE_PATH;

// Global state
let billId = null;
let billData = null;
let settlements = null;

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
  document.getElementById('bill-total').textContent = `${billData.currency_symbol}${total.toFixed(2)}`;
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
    const balanceText = p.balance > 0 ? `+${billData.currency_symbol}${p.balance.toFixed(2)}` : 
                        p.balance < 0 ? `-${billData.currency_symbol}${Math.abs(p.balance).toFixed(2)}` :
                        `${billData.currency_symbol}0.00`;
    
    return `
      <tr>
        <td><strong>${p.name}</strong></td>
        <td class="text-right">${billData.currency_symbol}${p.owes.toFixed(2)}</td>
        <td class="text-right">${billData.currency_symbol}${p.paid.toFixed(2)}</td>
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
      <div class="settlement-amount">${billData.currency_symbol}${s.amount.toFixed(2)}</div>
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
      <div>${billData.currency_symbol}${d.amount.toFixed(2)}</div>
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
        <span>${billData.currency_symbol}${p.owes.toFixed(2)}</span>
      </div>
    </button>
  `).join('');
}

// Show participant breakdown
async function showParticipantBreakdown(participantId, participantName) {
  try {
    const response = await fetch(`${API_BASE}/api/settlements/${billId}/participant/${participantId}`);
    if (!response.ok) throw new Error('Failed to load breakdown');
    
    const breakdown = await response.json();
    
    document.getElementById('breakdown-participant-name').textContent = participantName;
    document.getElementById('breakdown-total').textContent = 
      `${breakdown.currency_symbol}${breakdown.total.toFixed(2)}`;
    
    const itemsList = document.getElementById('breakdown-items-list');
    
    if (breakdown.items.length === 0) {
      itemsList.innerHTML = '<div class="text-secondary">No items assigned</div>';
    } else {
      itemsList.innerHTML = breakdown.items.map(item => `
        <div class="flex-between" style="padding: 8px 0; border-bottom: 1px solid var(--color-border);">
          <div>
            <div><strong>${item.item_name}</strong></div>
            <div class="text-secondary text-sm">
              ${item.split_type === 'equal' ? 'Equal split' :
                item.split_type === 'fixed' ? 'Fixed amount' :
                item.split_type === 'percent' ? `${item.split_value}%` :
                item.split_type === 'proportional' ? 'Proportional' : ''}
            </div>
          </div>
          <div>${breakdown.currency_symbol}${item.amount.toFixed(2)}</div>
        </div>
      `).join('');
    }
    
    document.getElementById('breakdown-modal').style.display = 'block';
  } catch (error) {
    console.error('Error loading breakdown:', error);
    alert('Failed to load breakdown');
  }
}

// Close breakdown modal
function closeBreakdownModal() {
  document.getElementById('breakdown-modal').style.display = 'none';
}

// NEW: Render receipts - show ALL receipts (scanned and manual) with payer names
function renderReceipts() {
  if (!billData.receipts || billData.receipts.length === 0) {
    return; // Keep card hidden
  }
  
  const card = document.getElementById('receipts-card');
  const gallery = document.getElementById('receipts-gallery');
  
  card.style.display = 'block';
  
  // NEW: Show ALL receipts, not just those with images
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
            ${billData.currency_symbol}${total.toFixed(2)}<br>
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
            ${billData.currency_symbol}${total.toFixed(2)}<br>
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
  
  // NEW: Improved download - create a hidden link and trigger click
  const downloadBtn = document.getElementById('receipt-download-btn');
  downloadBtn.onclick = () => downloadReceiptImage(imagePath, receiptNumber);
  
  document.getElementById('receipt-modal').style.display = 'block';
}

// NEW: Show receipt details (for manual items)
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
  itemsList.innerHTML = items.map(item => `
    <div class="flex-between" style="padding: 8px 0; border-bottom: 1px solid var(--color-border);">
      <div>
        <strong>${item.name}</strong>
        ${item.is_tax_or_charge ? '<span class="badge" style="margin-left: 8px;">Tax/Charge</span>' : ''}
      </div>
      <div>${billData.currency_symbol}${item.price.toFixed(2)}</div>
    </div>
  `).join('');
  
  const total = items.reduce((sum, item) => sum + item.price, 0);
  document.getElementById('receipt-details-total').textContent = `${billData.currency_symbol}${total.toFixed(2)}`;
  
  document.getElementById('receipt-details-modal').style.display = 'block';
}

// Close receipt details modal
function closeReceiptDetailsModal() {
  document.getElementById('receipt-details-modal').style.display = 'none';
}

// NEW: Improved download function using fetch and blob
async function downloadReceiptImage(imagePath, receiptNumber) {
  try {
    // Fetch the image as a blob
    const response = await fetch(imagePath);
    if (!response.ok) throw new Error('Failed to fetch image');
    
    const blob = await response.blob();
    
    // Create a temporary URL for the blob
    const blobUrl = window.URL.createObjectURL(blob);
    
    // Create a temporary anchor element
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = `receipt-${receiptNumber}.jpg`;
    
    // Append to body, click, and remove
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    // Clean up the blob URL
    window.URL.revokeObjectURL(blobUrl);
  } catch (error) {
    console.error('Download failed:', error);
    
    // Fallback: open in new tab
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
function copyToClipboard(text) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => {
      alert('Link copied to clipboard!');
    }).catch(err => {
      fallbackCopy(text);
    });
  } else {
    fallbackCopy(text);
  }
}

// Fallback copy method
function fallbackCopy(text) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  
  try {
    document.execCommand('copy');
    alert('Link copied to clipboard!');
  } catch (err) {
    prompt('Copy this link:', text);
  }
  
  document.body.removeChild(textarea);
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
  }
});

// Add styles for balance colors
const style = document.createElement('style');
style.textContent = `
  .text-success { color: #2e7d32; }
  .text-danger { color: #d32f2f; }
`;
document.head.appendChild(style);