// OCR functionality using Tesseract.js
// Load Tesseract from CDN
const TESSERACT_CDN = 'https://cdn.jsdelivr.net/npm/tesseract.js@4/dist/tesseract.min.js';

// Load Tesseract.js dynamically
function loadTesseract() {
  return new Promise((resolve, reject) => {
    if (window.Tesseract) {
      resolve(window.Tesseract);
      return;
    }

    const script = document.createElement('script');
    script.src = TESSERACT_CDN;
    script.onload = () => resolve(window.Tesseract);
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

// Process receipt image with OCR
async function processReceipt(imageFile, progressCallback) {
  try {
    const Tesseract = await loadTesseract();
    
    const worker = await Tesseract.createWorker({
      logger: m => {
        // Handle progress updates
        if (progressCallback && m.status === 'recognizing text') {
          progressCallback(Math.round(m.progress * 100));
        }
      }
    });
    
    await worker.loadLanguage('eng');
    await worker.initialize('eng');
    
    // Set parameters for better receipt recognition
    await worker.setParameters({
      tessedit_char_whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz .,/$%-+',
    });

    const { data } = await worker.recognize(imageFile);

    await worker.terminate();

    // Parse the OCR result
    const parsedData = parseReceiptText(data.text);
    
    return {
      success: true,
      raw_text: data.text,
      parsed: parsedData
    };
  } catch (error) {
    console.error('OCR Error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// Parse receipt text to extract items and prices
function parseReceiptText(text) {
  const lines = text.split('\n').filter(line => line.trim());
  const items = [];
  let total = null;
  let tax = null;
  let serviceCharge = null;
  let gratuity = null;

  // Common patterns
  const pricePattern = /\$?\s*(\d+[\.,]\d{2})/;
  const totalPattern = /\b(total|amount|sum)\b/i;
  const taxPattern = /\b(tax|vat|gst)\b/i;
  const servicePattern = /\b(service|srv|svc)\b/i;
  const gratuityPattern = /\b(tip|gratuity|grat)\b/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    if (!line) continue;

    // Check for total
    if (totalPattern.test(line)) {
      const match = line.match(pricePattern);
      if (match) {
        total = parseFloat(match[1].replace(',', '.'));
      }
      continue;
    }

    // Check for tax
    if (taxPattern.test(line)) {
      const match = line.match(pricePattern);
      if (match) {
        tax = {
          name: 'Tax',
          amount: parseFloat(match[1].replace(',', '.'))
        };
      }
      continue;
    }

    // Check for service charge
    if (servicePattern.test(line)) {
      const match = line.match(pricePattern);
      if (match) {
        serviceCharge = {
          name: 'Service Charge',
          amount: parseFloat(match[1].replace(',', '.'))
        };
      }
      continue;
    }

    // Check for gratuity
    if (gratuityPattern.test(line)) {
      const match = line.match(pricePattern);
      if (match) {
        gratuity = {
          name: 'Gratuity',
          amount: parseFloat(match[1].replace(',', '.'))
        };
      }
      continue;
    }

    // Try to extract item with price
    const priceMatch = line.match(pricePattern);
    if (priceMatch) {
      // Extract item name (everything before the price)
      const priceIndex = line.indexOf(priceMatch[0]);
      const itemName = line.substring(0, priceIndex).trim();
      
      // Skip if the item name is too short or looks like a header
      if (itemName.length > 2 && !itemName.match(/^(item|qty|desc|price)$/i)) {
        // Check for quantity
        const qtyMatch = itemName.match(/^(\d+)\s*x?\s*(.+)$/i);
        
        if (qtyMatch) {
          const quantity = parseInt(qtyMatch[1]);
          const name = qtyMatch[2].trim();
          const unitPrice = parseFloat(priceMatch[1].replace(',', '.'));
          
          // Add multiple items if quantity > 1
          for (let q = 0; q < quantity; q++) {
            items.push({
              name: name,
              price: unitPrice / quantity
            });
          }
        } else {
          items.push({
            name: itemName,
            price: parseFloat(priceMatch[1].replace(',', '.'))
          });
        }
      }
    }
  }

  return {
    items,
    charges: {
      tax,
      serviceCharge,
      gratuity
    },
    total
  };
}

// Format currency
function formatCurrency(amount, symbol = '$') {
  return `${symbol}${amount.toFixed(2)}`;
}

// Preview image before upload
function previewImage(file, previewElement) {
  const reader = new FileReader();
  
  reader.onload = (e) => {
    if (previewElement.tagName === 'IMG') {
      previewElement.src = e.target.result;
    } else {
      const img = document.createElement('img');
      img.src = e.target.result;
      img.style.maxWidth = '100%';
      img.style.height = 'auto';
      previewElement.innerHTML = '';
      previewElement.appendChild(img);
    }
  };
  
  reader.readAsDataURL(file);
}

// Export functions
// Make functions available globally for browser
window.OCR = {
  processReceipt: processReceipt,
  parseReceiptText: parseReceiptText,
  formatCurrency: formatCurrency,
  previewImage: previewImage
};

// Also keep Node.js export for compatibility
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    processReceipt,
    parseReceiptText,
    formatCurrency,
    previewImage
  };
}