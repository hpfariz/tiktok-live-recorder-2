const express = require('express');
const router = express.Router();
const vision = require('@google-cloud/vision');

// Initialize Vision API client
let visionClient = null;

try {
  if (process.env.GOOGLE_VISION_API_KEY) {
    visionClient = new vision.ImageAnnotatorClient({
      keyFilename: process.env.GOOGLE_VISION_KEY_FILE
    });
  }
} catch (error) {
  console.error('Google Vision API not configured:', error.message);
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
    const { image } = req.body; // Base64 image
    
    if (!image) {
      return res.status(400).json({ error: 'No image provided' });
    }

    // Call Google Vision API
    const [result] = await visionClient.documentTextDetection({
      image: { content: Buffer.from(image, 'base64') }
    });

    const fullText = result.fullTextAnnotation?.text || '';
    const blocks = result.fullTextAnnotation?.pages?.[0]?.blocks || [];

    // Parse the structured text
    const parsed = parseReceiptFromVision(fullText, blocks);

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

// Advanced receipt parsing using Vision API's structured output
function parseReceiptFromVision(text, blocks) {
  const lines = text.split('\n').filter(l => l.trim());
  const items = [];
  let total = null;
  let tax = null;
  let serviceCharge = null;

  // Patterns for Indonesian receipts
  const pricePattern = /(?:IDR|Rp\.?)?\s*(\d{1,3}(?:[,\.]\d{3})*(?:[,\.]\d{2}))/;
  const totalPattern = /\b(total|grand\s*total|amount)\b/i;
  const taxPattern = /\b(pb1|ppn|tax|pajak)\s*\(?(\d+[,\.]?\d*%?)\)?/i;
  const servicePattern = /\b(service|srv|layanan)\b/i;

  // Skip patterns
  const skipPatterns = [
    /^(subtotal|date|time|table|outlet|store|cashier|number|pc\d+)/i,
    /^[\d\s\-\/\:]+$/, // Pure numbers/dates
    /temporary/i
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    if (!line || line.length < 3) continue;

    // Skip headers/footers
    if (skipPatterns.some(p => p.test(line))) continue;

    // Check for total
    if (totalPattern.test(line)) {
      const match = line.match(pricePattern);
      if (match) {
        total = parseIndonesianPrice(match[1]);
      }
      continue;
    }

    // Check for tax
    if (taxPattern.test(line)) {
      const match = line.match(pricePattern);
      if (match) {
        const amount = parseIndonesianPrice(match[1]);
        if (amount > 0) {
          tax = { name: 'Tax (PB1)', amount };
        }
      }
      continue;
    }

    // Check for service
    if (servicePattern.test(line)) {
      const match = line.match(pricePattern);
      if (match) {
        const amount = parseIndonesianPrice(match[1]);
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
      const price = parseIndonesianPrice(lastPrice);

      if (price > 0 && (!total || price <= total * 0.8)) {
        // Extract item name
        let name = line;
        priceMatches.forEach(m => {
          name = name.replace(m[0], '');
        });
        
        // Clean item name
        name = name
          .replace(/^\d+\s+/, '') // Remove quantity prefix
          .replace(/[@#]/g, '')
          .replace(/\s+/g, ' ')
          .trim();

        if (name.length >= 3 && !/^[\d\s\.,@]+$/.test(name)) {
          items.push({ name, price });
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

// Parse Indonesian price format (380,000.00 or 380.000,00)
function parseIndonesianPrice(priceStr) {
  // Remove currency symbols and spaces
  let cleaned = priceStr.replace(/[^\d,\.]/g, '');
  
  // Count separators to determine format
  const commas = (cleaned.match(/,/g) || []).length;
  const dots = (cleaned.match(/\./g) || []).length;
  
  // If multiple commas/dots, they're thousand separators
  if (commas > 1 || dots > 1) {
    // Remove thousand separators, keep last one as decimal
    if (commas > dots) {
      cleaned = cleaned.replace(/\./g, '').replace(/,/g, '.');
    } else {
      cleaned = cleaned.replace(/,/g, '');
    }
  } else if (commas === 1 && dots === 0) {
    // Single comma might be decimal
    cleaned = cleaned.replace(',', '.');
  } else if (commas === 0 && dots === 1) {
    // Already correct format
  } else {
    // No decimal separator, assume it's in cents (38000 = 380.00)
    if (cleaned.length > 2) {
      cleaned = cleaned.slice(0, -2) + '.' + cleaned.slice(-2);
    }
  }
  
  return parseFloat(cleaned) || 0;
}

module.exports = router;