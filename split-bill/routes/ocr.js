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

// Parse receipt text into structured data - FIXED FOR MULTI-LINE FORMAT
function parseReceiptFromVision(text) {
  console.log('=== RAW TEXT FROM GOOGLE VISION ===');
  console.log(text);
  console.log('=== END RAW TEXT ===');
  
  const lines = text.split('\n').filter(l => l.trim());
  const items = [];
  let total = null;
  let subtotal = null;
  let tax = null;
  let serviceCharge = null;

  // Patterns
  const pricePattern = /(\d{1,3}(?:[,\.]\d{3})*(?:[,\.]\d{2})?)/;
  const totalPattern = /\b(total|grand\s*total|amount)\b/i;
  const taxPattern = /\b(pb1|ppn|tax|pajak)\b/i;
  const servicePattern = /\b(service|srv|layanan)\b/i;
  const subtotalPattern = /\bsubtotal\b/i;
  const itemLinePattern = /^(\d+)\s+(.+)/; // Matches "5 Mineral Water 600 ML"
  const unitPricePattern = /^@(\d{1,3}(?:[,\.]\d{3})*(?:[,\.]\d{2})?)/; // Matches "@35,000.00"

  // Skip patterns
  const skipPatterns = [
    /^(date|time|table|outlet|store|cashier|number|dine\s*in|idr)\b/i,
    /^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/, // Dates
    /^\d{1,2}:\d{2}/, // Times
    /^pc\d+/i,
    /^avg\s*per\s*pax/i,
    /temporary/i,
    /^\*+$/,
    /^de$/i,
    /^#\d+$/,
    /^r\s+serv/i,
    /^\+\s*(dingin|normal|panas)/i, // Temperature options
    /^ap$/i,
    /^kon$/i,
    /^ak$/i
  ];

  console.log(`Processing ${lines.length} lines...`);

  // FIRST PASS: Find subtotal and total for tax calculation
  let subtotalIndex = -1;
  let totalIndex = -1;
  let taxLineIndex = -1;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    if (subtotalPattern.test(line)) {
      subtotalIndex = i;
      console.log(`Found SUBTOTAL keyword at line ${i}`);
    }
    
    if (taxPattern.test(line) && !subtotalPattern.test(line)) {
      taxLineIndex = i;
      console.log(`Found TAX keyword at line ${i}`);
    }
    
    if (totalPattern.test(line) && !subtotalPattern.test(line)) {
      totalIndex = i;
      console.log(`Found TOTAL keyword at line ${i}`);
    }
  }
  
  // Extract amounts by looking ahead from keywords
  if (subtotalIndex >= 0) {
    for (let j = subtotalIndex + 1; j < Math.min(subtotalIndex + 6, lines.length); j++) {
      const amountLine = lines[j].trim();
      const amountMatch = amountLine.match(/^(\d{1,3}(?:[,\.]\d{3})*(?:[,\.]\d{2})?)$/);
      if (amountMatch) {
        const amount = parsePrice(amountMatch[1]);
        if (amount > 0 && amount < 10000000) {
          subtotal = amount;
          console.log(`Found SUBTOTAL amount: ${subtotal}`);
          break;
        }
      }
    }
  }
  
  if (totalIndex >= 0) {
    const possibleTotals = [];
    for (let j = totalIndex + 1; j < Math.min(totalIndex + 9, lines.length); j++) {
      const amountLine = lines[j].trim();
      const amountMatch = amountLine.match(/^(\d{1,3}(?:[,\.]\d{3})*(?:[,\.]\d{2})?)$/);
      if (amountMatch) {
        const amount = parsePrice(amountMatch[1]);
        if (amount > 0 && amount < 10000000) {
          possibleTotals.push({ amount, line: j });
        }
      }
    }
    if (possibleTotals.length > 0) {
      possibleTotals.sort((a, b) => b.amount - a.amount);
      total = possibleTotals[0].amount;
      console.log(`Found TOTAL amount: ${total}`);
    }
  }
  
  // Calculate tax from difference
  if (subtotal && total && total > subtotal) {
    const taxAmount = total - subtotal;
    let taxPercent = 10;
    let taxName = 'Tax (PB1)';
    
    if (taxLineIndex >= 0) {
      const taxLine = lines[taxLineIndex];
      const percentMatch = taxLine.match(/(\d+(?:\.\d+)?)\s*%/);
      if (percentMatch) {
        taxPercent = parseFloat(percentMatch[1]);
      }
      
      if (/ppn/i.test(taxLine)) {
        taxName = `PPN ${taxPercent}%`;
      } else if (/pb1/i.test(taxLine)) {
        taxName = `PB1 ${taxPercent}%`;
      } else {
        taxName = `Tax ${taxPercent}%`;
      }
    }
    
    tax = { 
      name: taxName, 
      amount: Math.round(taxAmount * 100) / 100 
    };
    console.log(`✅ Calculated TAX: ${tax.name} = ${tax.amount}`);
  }

  // SECOND PASS: Parse items
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

    // Check for tax (price might be on next line)
    if (taxPattern.test(line)) {
      const match = line.match(pricePattern);
      let amount = 0;
      
      if (match) {
        amount = parsePrice(match[1]);
      } else if (i + 1 < lines.length) {
        // Look ahead to next line for price
        const nextLine = lines[i + 1].trim();
        const nextMatch = nextLine.match(/^(\d{1,3}(?:[,\.]\d{3})*(?:[,\.]\d{2})?)$/);
        if (nextMatch) {
          amount = parsePrice(nextMatch[1]);
          i++; // Skip next line
        }
      }
      
      if (amount > 0) {
        // Extract percentage if present
        const percentMatch = line.match(/(\d+(?:\.\d+)?)\s*%/);
        const percent = percentMatch ? parseFloat(percentMatch[1]) : null;
        
        tax = { 
          name: percent ? `Tax (PB1 ${percent}%)` : 'Tax (PB1)', 
          amount 
        };
        console.log(`Found tax: ${amount}${percent ? ' (' + percent + '%)' : ''}`);
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

    // MULTI-LINE FORMAT: Check if this is an item line (starts with quantity)
    const itemMatch = line.match(itemLinePattern);
    if (itemMatch && i + 2 < lines.length) {
      const quantity = parseInt(itemMatch[1]);
      const itemName = itemMatch[2].trim();
      
      // Look ahead for unit price line (next line should start with @)
      const nextLine = lines[i + 1].trim();
      const unitPriceMatch = nextLine.match(unitPricePattern);
      
      if (unitPriceMatch) {
        const unitPrice = parsePrice(unitPriceMatch[1]);
        
        // Look ahead for line total (2 lines ahead)
        const lineTotalLine = lines[i + 2].trim();
        const lineTotalMatch = lineTotalLine.match(/^(\d{1,3}(?:[,\.]\d{3})*(?:[,\.]\d{2})?)/);
        
        if (lineTotalMatch) {
          const lineTotal = parsePrice(lineTotalMatch[1]);
          
          // Validate: lineTotal should be close to quantity * unitPrice
          const expectedTotal = quantity * unitPrice;
          const difference = Math.abs(lineTotal - expectedTotal);
          
          if ((difference < 1 || difference / expectedTotal < 0.1) && lineTotal > 0) {
            // Valid item - use line total as the price
            // Check for duplicates
            const isDuplicate = items.some(item => 
              item.name.toLowerCase() === itemName.toLowerCase() && 
              Math.abs(item.price - lineTotal) < 0.01
            );
            
            if (!isDuplicate) {
              items.push({ 
                name: itemName, 
                price: lineTotal,
                quantity: quantity,
                unitPrice: unitPrice
              });
              console.log(`Added item: ${itemName} (${quantity}x${unitPrice}) = ${lineTotal}`);
            } else {
              console.log(`Skipped (duplicate): ${itemName} - ${lineTotal}`);
            }
            
            // Skip the next 2 lines since we've processed them
            i += 2;
            continue;
          } else if (lineTotal === 0) {
            console.log(`Skipped (free item): ${itemName}`);
            i += 2;
            continue;
          }
        }
      }
    }

    // SINGLE-LINE FORMAT: Try to extract items with prices on the same line
    const priceMatches = [...line.matchAll(new RegExp(pricePattern.source, 'g'))];
    
    if (priceMatches.length >= 1) {
      // Skip if line starts with @ (unit price line)
      if (line.startsWith('@')) {
        console.log(`Skipped (unit price line): ${line}`);
        continue;
      }
      
      // Skip if line is just a number (probably a line total)
      if (/^\d{1,3}(?:[,\.]\d{3})*(?:[,\.]\d{2})?$/.test(line)) {
        console.log(`Skipped (standalone price): ${line}`);
        continue;
      }
      
      // Take the rightmost price (usually the line total)
      const lastPrice = priceMatches[priceMatches.length - 1][1];
      const price = parsePrice(lastPrice);

      // Validate price (must be > 0)
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

        // Validate name
        if (name.length >= 3 && /[a-zA-Z]/.test(name)) {
          // Check for duplicates
          const isDuplicate = items.some(item => 
            item.name.toLowerCase() === name.toLowerCase() && 
            Math.abs(item.price - price) < 0.01
          );
          
          if (!isDuplicate) {
            items.push({ name, price });
            console.log(`Added item (single-line): ${name} - ${price}`);
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