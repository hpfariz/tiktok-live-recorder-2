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
  console.log('=== RAW TEXT FROM GOOGLE VISION ===');
  console.log(text);
  console.log('=== END RAW TEXT ===');
  
  const lines = text.split('\n').filter(l => l.trim());
  const items = [];
  let total = null;
  let tax = null;
  let serviceCharge = null;

  // More lenient price pattern - matches various formats
  const pricePattern = /(\d{1,3}(?:[,\.]\d{3})*(?:[,\.]\d{2})?)/;
  const totalPattern = /\b(total|grand\s*total|amount)\b/i;
  const taxPattern = /\b(pb1|ppn|tax|pajak)\b/i;
  const servicePattern = /\b(service|srv|layanan)\b/i;
  const subtotalPattern = /\bsubtotal\b/i;

  // Minimal skip patterns - only skip obvious non-items
  const skipPatterns = [
    /^(date|time|table|outlet|store|cashier|number|dine\s*in)\b/i,
    /^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/, // Dates
    /^\d{1,2}:\d{2}/, // Times
    /^pc\d+/i,
    /^avg\s*per\s*pax/i,
    /temporary/i,
    /^\*+$/
  ];

  console.log(`Processing ${lines.length} lines...`);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    if (!line || line.length < 2) continue;

    // Skip obvious non-items
    if (skipPatterns.some(p => p.test(line))) {
      console.log(`Skipped (pattern): ${line}`);
      continue;
    }

    // Check for subtotal
    if (subtotalPattern.test(line)) {
      console.log(`Skipped (subtotal): ${line}`);
      continue;
    }

    // Check for total
    if (totalPattern.test(line)) {
      const match = line.match(pricePattern);
      if (match) {
        total = parsePrice(match[1]);
        console.log(`Found total: ${total}`);
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
          console.log(`Found tax: ${amount}`);
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
          console.log(`Found service charge: ${amount}`);
        }
      }
      continue;
    }

    // Try to extract items with prices
    const priceMatches = [...line.matchAll(new RegExp(pricePattern.source, 'g'))];
    
    if (priceMatches.length >= 1) {
      // Take the rightmost price (usually the line total)
      const lastPrice = priceMatches[priceMatches.length - 1][1];
      const price = parsePrice(lastPrice);

      // More lenient validation
      if (price > 0 && price < 10000000) {
        // Extract item name
        let name = line;
        priceMatches.forEach(m => {
          name = name.replace(m[0], '');
        });
        
        // Clean item name
        name = name
          .replace(/^\d+\s+/, '') // Remove leading quantity
          .replace(/[@#\+\*]/g, '') // Remove special chars
          .replace(/\s+/g, ' ') // Normalize spaces
          .trim();

        // Lenient validation - just needs to have some letters
        if (name.length >= 2 && /[a-zA-Z]/.test(name)) {
          // Check for duplicates
          const isDuplicate = items.some(item => 
            item.name.toLowerCase() === name.toLowerCase() && 
            Math.abs(item.price - price) < 0.01
          );
          
          if (!isDuplicate) {
            items.push({ name, price });
            console.log(`Added item: ${name} - ${price}`);
          } else {
            console.log(`Skipped (duplicate): ${name} - ${price}`);
          }
        } else {
          console.log(`Skipped (invalid name): "${name}" - ${price}`);
        }
      } else {
        console.log(`Skipped (invalid price): ${line} (price: ${price})`);
      }
    } else {
      console.log(`Skipped (no price): ${line}`);
    }
  }

  console.log(`=== PARSING COMPLETE: Found ${items.length} items ===`);

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
  
  if (!cleaned) return 0;
  
  // Count separators
  const commas = (cleaned.match(/,/g) || []).length;
  const dots = (cleaned.match(/\./g) || []).length;
  
  // Handle different formats
  if (commas > 1 || dots > 1) {
    // Multiple separators - last one is decimal
    const lastComma = cleaned.lastIndexOf(',');
    const lastDot = cleaned.lastIndexOf('.');
    
    if (lastComma > lastDot) {
      // Format: 1.000,00 (Indonesian)
      cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    } else {
      // Format: 1,000.00 (English)
      cleaned = cleaned.replace(/,/g, '');
    }
  } else if (commas === 1 && dots === 1) {
    // One of each - determine which is decimal
    const commaPos = cleaned.indexOf(',');
    const dotPos = cleaned.indexOf('.');
    
    if (commaPos < dotPos) {
      // Format: 1,000.00
      cleaned = cleaned.replace(',', '');
    } else {
      // Format: 1.000,00
      cleaned = cleaned.replace('.', '').replace(',', '.');
    }
  } else if (commas === 1) {
    // Only comma - check if it's decimal or thousand
    const parts = cleaned.split(',');
    if (parts[1] && parts[1].length === 2) {
      // Likely decimal: 10,50
      cleaned = cleaned.replace(',', '.');
    } else {
      // Likely thousand: 1,000
      cleaned = cleaned.replace(',', '');
    }
  } else if (dots === 1) {
    // Only dot - check if it's decimal or thousand
    const parts = cleaned.split('.');
    if (parts[1] && parts[1].length === 2) {
      // Likely decimal: 10.50
      // Already correct format
    } else if (parts[1] && parts[1].length === 3) {
      // Likely thousand: 1.000
      cleaned = cleaned.replace('.', '');
    }
  }
  
  const parsed = parseFloat(cleaned);
  
  // If parsed value is very large and has no decimal, divide by 100
  if (parsed > 10000 && !cleaned.includes('.')) {
    return parsed / 100;
  }
  
  return isNaN(parsed) ? 0 : parsed;
}

module.exports = router;