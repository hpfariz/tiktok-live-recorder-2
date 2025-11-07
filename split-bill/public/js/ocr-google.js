// Google Cloud Vision OCR Client - ALWAYS USE GOOGLE VISION (No Tesseract fallback)

async function processReceiptWithGoogle(file, progressCallback) {
  try {
    if (progressCallback) progressCallback(10);
    
    // Get BASE_PATH from the current page context
    const BASE_PATH = window.location.pathname.match(/^\/[^\/]+/)?.[0] || '';
    const API_BASE = window.location.origin + BASE_PATH;
    
    // Convert image to base64
    const base64 = await fileToBase64(file);
    
    if (progressCallback) progressCallback(30);
    
    console.log('Calling Google Vision API...');
    
    // Call backend OCR endpoint
    const response = await fetch(`${API_BASE}/api/ocr/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: base64.split(',')[1] })
    });
    
    if (progressCallback) progressCallback(80);
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || error.message || 'OCR processing failed');
    }
    
    const result = await response.json();
    
    if (progressCallback) progressCallback(100);
    
    console.log('Google Vision success:', result.parsed.items.length, 'items found');
    
    return result;
    
  } catch (error) {
    console.error('Google Vision error:', error);
    throw new Error(`OCR failed: ${error.message}. Please try again or add items manually.`);
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Export to global scope
window.GoogleOCR = {
  processReceipt: processReceiptWithGoogle
};