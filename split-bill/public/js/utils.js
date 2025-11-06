// Utility Functions for Split Bill App

/**
 * Format price with thousand separators
 * @param {number} amount - The amount to format
 * @param {string} currency - Currency symbol (default: 'Rp')
 * @returns {string} Formatted price (e.g., "Rp1,000,000.00")
 */
function formatPrice(amount, currency = 'Rp') {
  if (amount === null || amount === undefined || isNaN(amount)) {
    return `${currency}0.00`;
  }
  
  const parts = amount.toFixed(2).split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  
  return `${currency}${parts.join('.')}`;
}

/**
 * Format item display with quantity and unit price
 * @param {object} item - Item object with name, quantity, unitPrice, price
 * @param {string} currency - Currency symbol
 * @returns {string} Formatted item display
 */
function formatItemDisplay(item, currency = 'Rp') {
  if (!item) return '';
  
  const { name, quantity, unitPrice, unit_price, price } = item;
  const qty = quantity || 1;
  const unitPrc = unitPrice || unit_price;
  
  if (qty > 1 && unitPrc) {
    return `${qty} ${name} (@ ${formatPrice(unitPrc, currency)})`;
  }
  
  return name;
}

/**
 * Format item display HTML with styling
 * @param {object} item - Item object
 * @param {string} currency - Currency symbol
 * @returns {string} HTML string
 */
function formatItemDisplayHTML(item, currency = 'Rp') {
  if (!item) return '';
  
  const { name, quantity, unitPrice, unit_price, price } = item;
  const qty = quantity || 1;
  const unitPrc = unitPrice || unit_price;
  
  if (qty > 1 && unitPrc) {
    return `<strong>${qty}</strong> ${name} <span style="color: var(--color-text-secondary);">(@ ${formatPrice(unitPrc, currency)})</span>`;
  }
  
  return name;
}

/**
 * Parse price input (remove formatting)
 * @param {string} priceStr - Formatted price string
 * @returns {number} Numeric value
 */
function parsePrice(priceStr) {
  if (typeof priceStr === 'number') return priceStr;
  return parseFloat(priceStr.replace(/[^\d.-]/g, '')) || 0;
}

/**
 * Copy text to clipboard
 * @param {string} text - Text to copy
 * @returns {Promise<boolean>} Success status
 */
async function copyToClipboard(text) {
  if (navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      return fallbackCopy(text);
    }
  } else {
    return fallbackCopy(text);
  }
}

/**
 * Fallback copy method for older browsers
 * @param {string} text - Text to copy
 * @returns {boolean} Success status
 */
function fallbackCopy(text) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  
  try {
    document.execCommand('copy');
    document.body.removeChild(textarea);
    return true;
  } catch (err) {
    document.body.removeChild(textarea);
    return false;
  }
}

/**
 * Show copy feedback
 * @param {HTMLElement} button - Button element to show feedback on
 */
function showCopyFeedback(button) {
  const originalText = button.innerHTML;
  button.classList.add('copied');
  button.innerHTML = '✓ Copied';
  
  setTimeout(() => {
    button.classList.remove('copied');
    button.innerHTML = originalText;
  }, 2000);
}

// Export to global scope
if (typeof window !== 'undefined') {
  window.SplitBillUtils = {
    formatPrice,
    formatItemDisplay,
    formatItemDisplayHTML,
    parsePrice,
    copyToClipboard,
    fallbackCopy,
    showCopyFeedback
  };
}