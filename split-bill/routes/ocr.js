const express = require('express');
const router = express.Router();

let visionClient = null;

// Initialize Google Cloud Vision client
try {
  const vision = require('@google-cloud/vision');
  visionClient = new vision.ImageAnnotatorClient();
  console.log('✅ Google Cloud Vision initialized');
} catch (error) {
  console.error('❌ Google Cloud Vision not available:', error.message);
}

// Process receipt with Google Cloud Vision
router.post('/process', async (req, res) => {
  if (!visionClient) {
    return res.status(503).json({ 
      error: 'OCR service not configured',
      fallback: true 
    });
  }

  try {
    const { image } = req.body;
    
    if (!image) {
      return res.status(400).json({ error: 'No image provided' });
    }

    console.log('Processing receipt with Google Vision...');

    // Call Google Vision API for document text detection
    const [result] = await visionClient.documentTextDetection({
      image: { content: Buffer.from(image, 'base64') }
    });

    const fullText = result.fullTextAnnotation?.text || '';
    
    if (!fullText) {
      throw new Error('No text detected in image');
    }

    console.log('Text detected, parsing...');

    // Parse the text into structured data
    const parsed = parseReceiptFromVision(fullText);

    console.log(`Found ${parsed.items.length} items`);

    res.json({
      success: true,
      raw_text: fullText,
      parsed: parsed
    });

  } catch (error) {
    console.error('Google Vision error:', error);
    res.status(500).json({ 
      error: error.message,
      fallback: true 
    });
  }
});

// Parse receipt text into structured data
function parseReceiptFromVision(text) {
  const lines = text.split('\n').filter(l => l.trim());
  const items = [];
  let total = null;
  let tax = null;
  let serviceCharge = null;

  // Enhanced patterns for Indonesian receipts
  const pricePattern = /(?:IDR|Rp\.?|@)?\s*(\d{1,3}(?:[,\.]\d{3})*(?:[,\.]\d{2}))/;
  const totalPattern = /\b(total|grand\s*total|amount)\b/i;
  const taxPattern = /\b(pb1|ppn|tax|pajak)\s*\(?(\d+[,\.]?\d*%?)?\)?/i;
  const servicePattern = /\b(service|srv|layanan)\b/i;
  const subtotalPattern = /\bsubtotal\b/i;

  // Skip patterns
  const skipPatterns = [
    /^(date|time|table|outlet|store|cashier|number|pc\d+|dine\s*in|temporary)/i,
    /^[\d\s\-\/\:]+$/, // Pure numbers/dates
    /^\*+$/,
    /^#\d+$/,
    /^avg\s*per\s*pax/i
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    if (!line || line.length < 2) continue;

    // Skip headers/footers
    if (skipPatterns.some(p => p.test(line))) continue;

    // Check for subtotal (skip it)
    if (subtotalPattern.test(line)) continue;

    // Check for total
    if (totalPattern.test(line)) {
      const match = line.match(pricePattern);
      if (match) {
        total = parsePrice(match[1]);
      }
      continue;
    }

    // Check for tax
    if (taxPattern.test(line)) {
      const match = line.match(pricePattern);
      if (match) {
        const amount = parsePrice(match[1]);
        if (amount > 0) {
          tax = { name: 'Tax (PB1)', amount };
        }
      }
      continue;
    }

    // Check for service charge
    if (servicePattern.test(line)) {
      const match = line.match(pricePattern);
      if (match) {
        const amount = parsePrice(match[1]);
        if (amount > 0) {
          serviceCharge = { name: 'Service Charge', amount };
        }
      }
      continue;
    }

    // Extract items with prices
    const priceMatches = [...line.matchAll(new RegExp(pricePattern.source, 'g'))];
    
    if (priceMatches.length >= 1) {
      // Take the rightmost price (usually the line total)
      const lastPrice = priceMatches[priceMatches.length - 1][1];
      const price = parsePrice(lastPrice);

      // Validate price (positive and reasonable)
      if (price > 0 && price < 10000000) { // Less than 10 million IDR
        // Extract item name (remove all prices and special chars)
        let name = line;
        priceMatches.forEach(m => {
          name = name.replace(m[0], '');
        });
        
        // Clean item name
        name = name
          .replace(/^\d+\s+/, '') // Remove leading quantity
          .replace(/[@#\+]/g, '') // Remove special chars
          .replace(/\s+/g, ' ') // Normalize spaces
          .trim();

        // Validate item name
        if (name.length >= 3 && !/^[\d\s\.,@\+]+$/.test(name)) {
          // Check if it's not a duplicate
          const isDuplicate = items.some(item => 
            item.name.toLowerCase() === name.toLowerCase() && 
            Math.abs(item.price - price) < 0.01
          );
          
          if (!isDuplicate) {
            items.push({ name, price });
          }
        }
      }
    }
  }

  return {
    items,
    charges: { tax, serviceCharge, gratuity: null },
    total
  };
}

// Parse price in various formats (Indonesian, English, etc.)
function parsePrice(priceStr) {
  // Remove currency symbols and extra spaces
  let cleaned = priceStr.replace(/[^\d,\.]/g, '').trim();
  
  // Handle different formats
  // Format 1: 380,000.00 (English: comma for thousands, dot for decimal)
  // Format 2: 380.000,00 (Indonesian: dot for thousands, comma for decimal)
  // Format 3: 38000 (no separators, cents implied)
  
  const commas = (cleaned.match(/,/g) || []).length;
  const dots = (cleaned.match(/\./g) || []).length;
  
  if (commas > 1 || dots > 1) {
    // Multiple separators = thousand separators
    // Keep the last separator as decimal
    const lastComma = cleaned.lastIndexOf(',');
    const lastDot = cleaned.lastIndexOf('.');
    
    if (lastComma > lastDot) {
      // Indonesian format: 380.000,00
      cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    } else {
      // English format: 380,000.00
      cleaned = cleaned.replace(/,/g, '');
    }
  } else if (commas === 1 && dots === 1) {
    // One of each - determine which is decimal
    const commaPos = cleaned.indexOf(',');
    const dotPos = cleaned.indexOf('.');
    
    if (commaPos < dotPos) {
      // Format: 1,000.00 (comma is thousand separator)
      cleaned = cleaned.replace(',', '');
    } else {
      // Format: 1.000,00 (dot is thousand separator)
      cleaned = cleaned.replace('.', '').replace(',', '.');
    }
  } else if (commas === 1) {
    // Only comma - could be decimal or thousand separator
    const parts = cleaned.split(',');
    if (parts[1] && parts[1].length === 2) {
      // Likely decimal: 10,50
      cleaned = cleaned.replace(',', '.');
    } else {
      // Likely thousand: 1,000
      cleaned = cleaned.replace(',', '');
    }
  }
  // If only dots or no separators, assume correct format
  
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? 0 : parsed;
}

module.exports = router;