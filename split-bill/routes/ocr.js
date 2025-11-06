const express = require('express');
const router = express.Router();

let visionClient = null;
let visionAvailable = false;

// Try to initialize Google Cloud Vision client (don't crash if it fails)
try {
  const vision = require('@google-cloud/vision');
  
  // Check if credentials file exists before initializing
  const fs = require('fs');
  const path = require('path');
  const credPath = path.join(__dirname, '../google-vision-key.json');
  
  if (fs.existsSync(credPath)) {
    visionClient = new vision.ImageAnnotatorClient();
    visionAvailable = true;
    console.log('✅ Google Cloud Vision initialized');
  } else {
    console.log('⚠️  Google Vision credentials not found, will use Tesseract fallback');
  }
} catch (error) {
  console.log('⚠️  Google Cloud Vision not available:', error.message);
  console.log('   OCR will fall back to Tesseract (client-side)');
}

// Process receipt with Google Cloud Vision
router.post('/process', async (req, res) => {
  if (!visionAvailable || !visionClient) {
    return res.status(503).json({ 
      error: 'OCR service not configured',
      fallback: true,
      message: 'Google Vision not available, use client-side Tesseract'
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
      fallback: true,
      message: 'Google Vision failed, use client-side Tesseract'
    });
  }
});

// ENHANCED PARSER - Better multi-line detection and validation
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

  // Enhanced patterns
  const pricePattern = /(\d{1,3}(?:[,\.]\d{3})*(?:[,\.]\d{2})?)/;
  const totalPattern = /\b(total|grand\s*total|amount|jumlah)\b/i;
  const taxPattern = /\b(pb1|ppn|tax|pajak|vat)\b/i;
  const servicePattern = /\b(service|srv|layanan|charge)\b/i;
  const subtotalPattern = /\b(subtotal|sub\s*total)\b/i;
  
  // Multi-line format patterns
  const itemLinePattern = /^(\d+)\s+(.+)/; // "5 Mineral Water..."
  const unitPricePattern = /^@\s*(\d{1,3}(?:[,\.]\d{3})*(?:[,\.]\d{2})?)/; // "@35,000.00"
  const qtyPattern = /^(\d+)\s*x/i; // "5x" or "5 x"
  
  // Skip patterns - expanded
  const skipPatterns = [
    /^(date|time|table|outlet|store|cashier|number|dine\s*in|idr|receipt|bill|nota|struk)\b/i,
    /^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/, // Dates
    /^\d{1,2}:\d{2}/, // Times
    /^pc\d+/i,
    /^avg\s*per\s*pax/i,
    /temporary/i,
    /^\*+$/,
    /^-+$/,
    /^=+$/,
    /^de$/i,
    /^#\d+$/,
    /^r\s+serv/i,
    /^\+\s*(dingin|normal|panas|ice|hot|cold)/i,
    /^(ap|kon|ak)$/i,
    /^terima\s*kasih/i,
    /^thank\s*you/i,
    /^note:/i,
    /^customer/i,
    /^server/i,
    /^order/i
  ];

  console.log(`Processing ${lines.length} lines...`);

  // FIRST PASS: Find key amounts (subtotal, tax, total)
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
    for (let j = subtotalIndex; j < Math.min(subtotalIndex + 8, lines.length); j++) {
      const amountLine = lines[j].trim();
      const amountMatch = amountLine.match(pricePattern);
      if (amountMatch) {
        const amount = parsePrice(amountMatch[1]);
        if (amount > 0 && amount < 10000000) {
          subtotal = amount;
          console.log(`Found SUBTOTAL amount: ${subtotal} at line ${j}`);
          break;
        }
      }
    }
  }
  
  if (totalIndex >= 0) {
    const possibleTotals = [];
    for (let j = totalIndex; j < Math.min(totalIndex + 10, lines.length); j++) {
      const amountLine = lines[j].trim();
      const amountMatch = amountLine.match(pricePattern);
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
      } else if (/vat/i.test(taxLine)) {
        taxName = `VAT ${taxPercent}%`;
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

  // SECOND PASS: Parse items with enhanced multi-line detection
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    
    if (!line || line.length < 2) {
      i++;
      continue;
    }

    // Skip obvious non-items
    if (skipPatterns.some(p => p.test(line))) {
      console.log(`Skipped (pattern): ${line}`);
      i++;
      continue;
    }

    // Skip subtotal/total lines
    if (subtotalPattern.test(line) || totalPattern.test(line)) {
      console.log(`Skipped (keyword): ${line}`);
      i++;
      continue;
    }

    // NEW: Handle format where item name is on one line, qty+price on next
    // Format: "Ayam Geprek" followed by "1 Rp15.000"
    if (i + 1 < lines.length && !/\d/.test(line)) {
      const nextLine = lines[i + 1].trim();
      const qtyPriceMatch = nextLine.match(/^(\d+)\s+(?:Rp|IDR)?\s*(\d{1,3}(?:[,\.]\d{3})*(?:[,\.]\d{2})?)/i);
      
      if (qtyPriceMatch) {
        const itemName = line.trim();
        const quantity = parseInt(qtyPriceMatch[1]);
        const unitPrice = parsePrice(qtyPriceMatch[2]);
        const lineTotal = quantity * unitPrice;
        
        // Validate item name
        if (itemName.length >= 3 && /[a-zA-Z]/.test(itemName)) {
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
            console.log(`✅ Item (name+qty): ${quantity} ${itemName} @ ${unitPrice} = ${lineTotal}`);
            i += 2; // Skip both lines
            continue;
          }
        }
      }
    }

    // ENHANCED MULTI-LINE FORMAT DETECTION
    const itemMatch = line.match(itemLinePattern);
    const hasNextLine = i + 1 < lines.length;
    const hasLineAfterNext = i + 2 < lines.length;
    
    if (hasNextLine && hasLineAfterNext) {
      const nextLine = lines[i + 1].trim();
      const lineAfterNext = lines[i + 2].trim();
      
      // Check if next line is unit price line
      const unitPriceMatch = nextLine.match(unitPricePattern) || 
                             nextLine.match(/^(\d+)\s*x?\s*@\s*(\d{1,3}(?:[,\.]\d{3})*(?:[,\.]\d{2})?)/i);
      
      if (unitPriceMatch) {
        // Check if line after next is total
        const lineTotalMatch = lineAfterNext.match(/^(\d{1,3}(?:[,\.]\d{3})*(?:[,\.]\d{2})?)$/);
        
        if (lineTotalMatch) {
          let quantity = 1;
          let itemName = line;
          let unitPrice = 0;
          
          // Extract quantity from first line if present
          if (itemMatch) {
            quantity = parseInt(itemMatch[1]);
            itemName = itemMatch[2].trim();
          }
          
          // Extract unit price
          if (unitPriceMatch[2]) {
            // Format: "1 @10,000" or "1x @10,000"
            quantity = parseInt(unitPriceMatch[1]) || quantity;
            unitPrice = parsePrice(unitPriceMatch[2]);
          } else {
            // Format: "@10,000"
            unitPrice = parsePrice(unitPriceMatch[1]);
          }
          
          const lineTotal = parsePrice(lineTotalMatch[1]);
          
          // Validate: lineTotal should be close to quantity * unitPrice
          const expectedTotal = quantity * unitPrice;
          const difference = Math.abs(lineTotal - expectedTotal);
          
          if ((difference < 1 || difference / expectedTotal < 0.1) && lineTotal > 0) {
            // Valid multi-line item
            const isDuplicate = items.some(item => 
              item.name.toLowerCase() === itemName.toLowerCase() && 
              Math.abs(item.price - lineTotal) < 0.01
            );
            
            if (!isDuplicate && itemName.length >= 3) {
              items.push({ 
                name: itemName, 
                price: lineTotal,
                quantity: quantity,
                unitPrice: unitPrice
              });
              console.log(`✅ Multi-line item: ${quantity} ${itemName} @ ${unitPrice} = ${lineTotal}`);
            }
            
            // Skip the next 2 lines
            i += 3;
            continue;
          }
        }
      }
    }

    // SINGLE-LINE FORMAT: "Item Name    10,000" or "Item Name 10,000"
    const priceMatches = [...line.matchAll(new RegExp(pricePattern.source, 'g'))];
    
    if (priceMatches.length >= 1) {
      // Skip if line starts with @ (unit price line)
      if (line.startsWith('@')) {
        console.log(`Skipped (unit price line): ${line}`);
        i++;
        continue;
      }
      
      // Skip if line is just a number
      if (/^\d{1,3}(?:[,\.]\d{3})*(?:[,\.]\d{2})?$/.test(line)) {
        console.log(`Skipped (standalone price): ${line}`);
        i++;
        continue;
      }
      
      // Take the rightmost price
      const lastPrice = priceMatches[priceMatches.length - 1][1];
      const price = parsePrice(lastPrice);

      // Validate price
      if (price > 0 && price < 10000000) {
        // Extract item name
        let name = line;
        priceMatches.forEach(m => {
          name = name.replace(m[0], '');
        });
        
        // Clean item name
        name = name
          .replace(/^\d+\s+/, '')
          .replace(/[@#\+\*]/g, '')
          .replace(/\s+/g, ' ')
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
            console.log(`✅ Single-line item: ${name} = ${price}`);
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
    
    i++;
  }

  console.log(`=== PARSING COMPLETE: Found ${items.length} items ===`);

  return {
    items,
    charges: { tax, serviceCharge, gratuity: null },
    total
  };
}

// Enhanced price parser
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