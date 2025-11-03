// OCR Module using Tesseract.js (client-side fallback)

const TESSERACT_CDN = 'https://cdn.jsdelivr.net/npm/tesseract.js@4/dist/tesseract.min.js';

// Load Tesseract from CDN
async function loadTesseract() {
  if (window.Tesseract) {
    return window.Tesseract;
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = TESSERACT_CDN;
    script.async = true;
    script.onload = () => resolve(window.Tesseract);
    script.onerror = () => reject(new Error('Failed to load Tesseract.js'));
    document.head.appendChild(script);
  });
}

// Process receipt image with OCR - Simple version
async function processReceipt(imageFile, progressCallback) {
  try {
    if (progressCallback) progressCallback(10);
    
    const Tesseract = await loadTesseract();
    
    if (progressCallback) progressCallback(30);
    
    const worker = await Tesseract.createWorker();
    
    if (progressCallback) progressCallback(40);
    
    await worker.loadLanguage('eng');
    
    if (progressCallback) progressCallback(50);
    
    await worker.initialize('eng');
    
    if (progressCallback) progressCallback(60);
    
    await worker.setParameters({
      tessedit_char_whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz .,/$%-+',
    });

    if (progressCallback) progressCallback(70);

    const { data } = await worker.recognize(imageFile);
    
    if (progressCallback) progressCallback(90);

    await worker.terminate();

    const parsedData = parseReceiptText(data.text);
    
    if (progressCallback) progressCallback(100);
    
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

// Parse receipt text (basic version for fallback)
function parseReceiptText(text) {
  const lines = text.split('\n').filter(l => l.trim());
  const items = [];
  
  const pricePattern = /(\d{1,3}(?:[,\.]\d{3})*(?:[,\.]\d{2}))/;
  
  for (const line of lines) {
    const match = line.match(pricePattern);
    if (match) {
      const priceStr = match[1];
      let cleaned = priceStr.replace(/[,\.]/g, '');
      
      if (cleaned.length >= 2) {
        cleaned = cleaned.slice(0, -2) + '.' + cleaned.slice(-2);
      }
      
      const price = parseFloat(cleaned);
      let name = line.replace(match[0], '').trim();
      
      if (name.length >= 3 && price > 0) {
        items.push({ name, price });
      }
    }
  }
  
  return {
    items,
    charges: { tax: null, serviceCharge: null, gratuity: null },
    total: null
  };
}

function formatCurrency(amount) {
  return amount.toFixed(2);
}

function previewImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Export to global scope
window.OCR = {
  processReceipt: processReceipt,
  parseReceiptText: parseReceiptText,
  formatCurrency: formatCurrency,
  previewImage: previewImage
};