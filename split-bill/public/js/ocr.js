// OCR Module - Google Vision Only
// This file is kept for backwards compatibility but no longer uses Tesseract

// Note: All OCR processing is now done server-side with Google Cloud Vision API
// Client-side Tesseract has been removed for better accuracy and performance

function showOCRError() {
  return {
    success: false,
    error: 'OCR service unavailable. Please ensure Google Cloud Vision is configured on the server.'
  };
}

// Placeholder function - not used anymore
async function processReceipt(imageFile, progressCallback) {
  console.warn('Client-side OCR is disabled. Use Google Cloud Vision API instead.');
  return showOCRError();
}

// Keep these utility functions as they might be used elsewhere
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
  formatCurrency: formatCurrency,
  previewImage: previewImage
};