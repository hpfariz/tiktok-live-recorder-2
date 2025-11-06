const express = require('express');
const router = express.Router();

let visionClient = null;
let visionAvailable = false;

try {
  const vision = require('@google-cloud/vision');
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

    const [result] = await visionClient.documentTextDetection({
      image: { content: Buffer.from(image, 'base64') }
    });

    const fullText = result.fullTextAnnotation?.text || '';
    
    if (!fullText) {
      throw new Error('No text detected in image');
    }

    console.log('Text detected, parsing...');

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

  const pricePattern = /(\d{1,3}(?:[,\.]\d{3})*(?:[,\.]\d{2})?)/;
  
  // IMPROVED: Patterns match with OR without colons
  const totalPattern = /\b(total|grand\s*total|amount|jumlah)\s*:?/i;
  const taxPattern = /\b(pb1|ppn|tax|pajak|vat)\s*(?:\([\d.]+%\))?:?/i;
  const servicePattern = /\b(service|srv|layanan|charge)\s*:?/i;
  const subtotalPattern = /\b(subtotal|sub\s*total)\s*:?/i;
  
  const itemLinePattern = /^(\d+)\s+(.+)/;
  const unitPricePattern = /^@\s*(\d{1,3}(?:[,\.]\d{3})*(?:[,\.]\d{2})?)/;
  const zeroUnitPricePattern = /^@\s*0(?:\.00?)?$/;
  
  // COMPREHENSIVE SKIP PATTERNS
  const skipPatterns = [
    /^(date|time|table|outlet|store|cashier|number|dine\s*in|idr|receipt|bill|nota|struk|bistro)\b/i,
    /^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/,
    /^\d{1,2}:\d{2}/,
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
    /^order/i,
    /^lunas/i,
    /^(tunai|tunal|cash|bayar|dibayar|kembalian|embalian|kembali|kembali|change)\s*:?/i,
    /^pb\s*\d+/i,
    // NEW: Skip common header patterns with numbers/codes
    /^(no\.|kode|tanggal|kasir|order|struk|invoice|pesan|pegawai|jam)[\s:]/i,
    /^(nama|alamat|nomer|telpon|meja|tamu|qty|harga|barang)[\s:]/i,
    /^(jl|jalan|street|road)\b/i, // Address lines
    /^0\d{9,}/, // Phone numbers
    /^[a-z0-9]{10,}/i, // Long alphanumeric codes
  ];

  console.log(`Processing ${lines.length} lines...`);

  // FIRST PASS: Extract totals/tax/subtotal
  let subtotalIndex = -1;
  let totalIndex = -1;
  let taxLineIndex = -1;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    if (subtotalPattern.test(line) && !total) {
      subtotalIndex = i;
      console.log(`Found SUBTOTAL keyword at line ${i}`);
    }
    
    if (taxPattern.test(line) && !subtotalPattern.test(line) && !total) {
      taxLineIndex = i;
      console.log(`Found TAX keyword at line ${i}`);
    }
    
    if (totalPattern.test(line) && !subtotalPattern.test(line)) {
      totalIndex = i;
      console.log(`Found TOTAL keyword at line ${i}`);
    }
  }
  
  // Extract subtotal
  if (subtotalIndex >= 0) {
    const subtotalLine = lines[subtotalIndex].trim();
    const allPrices = [...subtotalLine.matchAll(new RegExp(pricePattern.source, 'g'))];
    
    if (allPrices.length > 0) {
      const lastPrice = allPrices[allPrices.length - 1][1];
      const amount = parsePrice(lastPrice);
      
      if (amount > 0 && amount < 100000000) {
        subtotal = amount;
        console.log(`Found SUBTOTAL amount: ${subtotal} from line ${subtotalIndex}`);
      }
    }
    
    // Look at next lines if not found on same line
    if (!subtotal) {
      for (let j = subtotalIndex + 1; j < Math.min(subtotalIndex + 5, lines.length); j++) {
        const amountLine = lines[j].trim();
        
        // Skip if it looks like a tax or total line
        if (taxPattern.test(amountLine) || totalPattern.test(amountLine)) continue;
        
        const amountMatch = amountLine.match(pricePattern);
        if (amountMatch) {
          const amount = parsePrice(amountMatch[1]);
          if (amount > 0 && amount < 100000000) {
            subtotal = amount;
            console.log(`Found SUBTOTAL amount: ${subtotal} at line ${j}`);
            break;
          }
        }
      }
    }
  }
  
  // Extract tax
  if (taxLineIndex >= 0) {
    const taxLine = lines[taxLineIndex].trim();
    const allPrices = [...taxLine.matchAll(new RegExp(pricePattern.source, 'g'))];
    
    let taxPercent = 10;
    let taxName = 'Tax';
    
    // Extract percentage from line
    const percentMatch = taxLine.match(/(\d+(?:\.\d+)?)\s*%/);
    if (percentMatch) {
      taxPercent = parseFloat(percentMatch[1]);
    }
    
    // Determine tax name
    if (/ppn/i.test(taxLine)) {
      taxName = `PPN ${taxPercent}%`;
    } else if (/pb1/i.test(taxLine)) {
      taxName = `PB1 ${taxPercent}%`;
    } else if (/vat/i.test(taxLine)) {
      taxName = `VAT ${taxPercent}%`;
    } else if (/pajak/i.test(taxLine)) {
      taxName = `Pajak ${taxPercent}%`;
    } else {
      taxName = `Tax ${taxPercent}%`;
    }
    
    // FIXED: Filter out prices that look like percentages
    if (allPrices.length > 0) {
      // Filter out the percentage number itself (e.g., "10.00" from "PB1 (10.00%)")
      const validPrices = allPrices.filter(m => {
        const val = parsePrice(m[1]);
        // If value is same as taxPercent (or very close), it's the percentage, not the tax amount
        return Math.abs(val - taxPercent) > 0.1;
      });
      
      if (validPrices.length > 0) {
        const lastPrice = validPrices[validPrices.length - 1][1];
        const amount = parsePrice(lastPrice);
        
        if (amount > 0 && amount < 100000000) {
          tax = {
            name: taxName,
            amount: Math.round(amount * 100) / 100
          };
          console.log(`✅ Found TAX: ${tax.name} = ${tax.amount} from line ${taxLineIndex}`);
        }
      }
    }
    
    // Look at next line if not found on same line
    if (!tax) {
      for (let j = taxLineIndex + 1; j < Math.min(taxLineIndex + 3, lines.length); j++) {
        const amountLine = lines[j].trim();
        
        // Skip if it's a total line
        if (totalPattern.test(amountLine)) continue;
        
        const amountMatch = amountLine.match(pricePattern);
        if (amountMatch) {
          const amount = parsePrice(amountMatch[1]);
          if (amount > 0 && amount < 100000000) {
            tax = {
              name: taxName,
              amount: Math.round(amount * 100) / 100
            };
            console.log(`✅ Found TAX: ${tax.name} = ${tax.amount} from next line`);
            break;
          }
        }
      }
    }
  }
  
  // Extract total
  if (totalIndex >= 0) {
    const totalLine = lines[totalIndex].trim();
    const allPrices = [...totalLine.matchAll(new RegExp(pricePattern.source, 'g'))];
    
    if (allPrices.length > 0) {
      const lastPrice = allPrices[allPrices.length - 1][1];
      const amount = parsePrice(lastPrice);
      
      if (amount > 0 && amount < 100000000) {
        total = amount;
        console.log(`Found TOTAL amount: ${total} from line ${totalIndex}`);
      }
    }
    
    // Look at next lines if not found on same line
    if (!total) {
      for (let j = totalIndex + 1; j < Math.min(totalIndex + 3, lines.length); j++) {
        const amountLine = lines[j].trim();
        
        // Skip payment lines
        if (/^(tunai|tunal|cash|bayar|dibayar|kembalian|embalian|kembali|change)/i.test(amountLine)) {
          console.log(`Skipped payment line when looking for total: ${amountLine}`);
          continue;
        }
        
        const amountMatch = amountLine.match(pricePattern);
        if (amountMatch) {
          const amount = parsePrice(amountMatch[1]);
          if (amount > 0 && amount < 100000000) {
            total = amount;
            console.log(`Found TOTAL amount: ${total} at line ${j}`);
            break;
          }
        }
      }
    }
  }
  
  // Calculate tax if we have subtotal and total but no tax
  if (!tax && subtotal && total && total > subtotal) {
    const taxAmount = total - subtotal;
    tax = { 
      name: 'Tax 10%', 
      amount: Math.round(taxAmount * 100) / 100 
    };
    console.log(`✅ Calculated TAX: ${tax.name} = ${tax.amount}`);
  }

  // SECOND PASS: Parse items
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    
    if (!line || line.length < 2) {
      i++;
      continue;
    }

    // Skip patterns
    if (skipPatterns.some(p => p.test(line))) {
      console.log(`Skipped (pattern): ${line}`);
      i++;
      continue;
    }

    // Skip keyword lines
    if (subtotalPattern.test(line) || totalPattern.test(line) || taxPattern.test(line)) {
      console.log(`Skipped (keyword): ${line}`);
      i++;
      continue;
    }

    // Skip lines with colons but no valid prices (headers)
    if (/:/.test(line)) {
      const priceMatches = [...line.matchAll(new RegExp(pricePattern.source, 'g'))];
      
      // If it has a colon but no price, skip
      if (priceMatches.length === 0) {
        console.log(`Skipped (header with colon, no price): ${line}`);
        i++;
        continue;
      }
      
      // If all "prices" are very small (likely codes/dates), skip
      const allSmall = priceMatches.every(m => parsePrice(m[1]) < 100);
      if (allSmall) {
        console.log(`Skipped (header with small numbers): ${line}`);
        i++;
        continue;
      }
      
      // If it's a payment/change line, skip
      if (/^(tunai|tunal|cash|bayar|dibayar|kembalian|embalian|kembali|change)/i.test(line)) {
        console.log(`Skipped (payment/change line): ${line}`);
        i++;
        continue;
      }
    }

    // NEW: Handle "ITEM × QTY PRICE" format (all on one line)
    // Example: "THAI TEA & GREEN TEA × 2 20.000"
    const singleLineQtyMatch = line.match(/^(.+?)\s*[×x]\s*(\d+)\s+(\d{1,3}(?:[,\.]\d{3})*(?:[,\.]\d{2})?)$/i);
    if (singleLineQtyMatch) {
      const itemName = singleLineQtyMatch[1].trim();
      const quantity = parseInt(singleLineQtyMatch[2]);
      const price = parsePrice(singleLineQtyMatch[3]);
      
      if (itemName.length >= 3 && price > 0) {
        const unitPrice = price / quantity;
        
        const isDuplicate = items.some(item => 
          item.name.toLowerCase() === itemName.toLowerCase() && 
          Math.abs(item.price - price) < 0.01
        );
        
        if (!isDuplicate) {
          items.push({
            name: itemName,
            price: price,
            quantity: quantity,
            unitPrice: unitPrice
          });
          console.log(`✅ Single-line with qty: ${quantity} ${itemName} @ ${unitPrice} = ${price}`);
          i++;
          continue;
        }
      }
    }

    // Handle "ITEM × QTY" on one line, price on next
    // Example: "ICE MOJITO × 1" followed by "8.000"
    if (i + 1 < lines.length) {
      const nextLine = lines[i + 1].trim();
      
      // Check if current line has × or x with quantity but no price
      const qtyNoPrice = line.match(/^(.+?)\s*[×x]\s*(\d+)$/i);
      
      // Check if next line is just a price
      const isNextLinePrice = /^(\d{1,3}(?:[,\.]\d{3})*(?:[,\.]\d{2})?)$/.test(nextLine);
      
      if (qtyNoPrice && isNextLinePrice) {
        const itemName = qtyNoPrice[1].trim();
        const quantity = parseInt(qtyNoPrice[2]);
        const price = parsePrice(nextLine);
        
        if (itemName.length >= 3 && price > 0) {
          const unitPrice = price / quantity;
          
          const isDuplicate = items.some(item => 
            item.name.toLowerCase() === itemName.toLowerCase() && 
            Math.abs(item.price - price) < 0.01
          );
          
          if (!isDuplicate) {
            items.push({
              name: itemName,
              price: price,
              quantity: quantity,
              unitPrice: unitPrice
            });
            console.log(`✅ Item (name+qty, price next line): ${quantity} ${itemName} @ ${unitPrice} = ${price}`);
            i += 2; // Skip both lines
            continue;
          }
        }
      }
    }

    // Handle format: name on one line, "qty price" on next
    if (i + 1 < lines.length && !/\d/.test(line)) {
      const nextLine = lines[i + 1].trim();
      const qtyPriceMatch = nextLine.match(/^(\d+)\s+(?:Rp|IDR)?\s*(\d{1,3}(?:[,\.]\d{3})*(?:[,\.]\d{2})?)/i);
      
      if (qtyPriceMatch) {
        const itemName = line.trim();
        const quantity = parseInt(qtyPriceMatch[1]);
        const unitPrice = parsePrice(qtyPriceMatch[2]);
        const lineTotal = quantity * unitPrice;
        
        if (itemName.length >= 3 && /[a-zA-Z]/.test(itemName) && lineTotal > 0) {
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
            console.log(`✅ Item (name, then qty+price): ${quantity} ${itemName} @ ${unitPrice} = ${lineTotal}`);
            i += 2;
            continue;
          }
        }
      }
    }

    // Multi-line format with @ notation
    const itemMatch = line.match(itemLinePattern);
    const hasNextLine = i + 1 < lines.length;
    const hasLineAfterNext = i + 2 < lines.length;
    
    if (hasNextLine && hasLineAfterNext) {
      const nextLine = lines[i + 1].trim();
      const lineAfterNext = lines[i + 2].trim();
      
      const unitPriceMatch = nextLine.match(unitPricePattern) || 
                             nextLine.match(/^(\d+)\s*x?\s*@\s*(\d{1,3}(?:[,\.]\d{3})*(?:[,\.]\d{2})?)/i);
      
      const isZeroPrice = zeroUnitPricePattern.test(nextLine);
      
      if (isZeroPrice) {
        console.log(`Skipped (unit price @0.00): ${nextLine}`);
        
        if (/^0(?:\.00?)?$/.test(lineAfterNext)) {
          console.log(`Skipped (zero total): ${lineAfterNext}`);
          i += 3;
          continue;
        }
        i += 2;
        continue;
      }
      
      if (unitPriceMatch) {
        const lineTotalMatch = lineAfterNext.match(/^(\d{1,3}(?:[,\.]\d{3})*(?:[,\.]\d{2})?)$/);
        
        if (lineTotalMatch) {
          let quantity = 1;
          let itemName = line;
          let unitPrice = 0;
          
          if (itemMatch) {
            quantity = parseInt(itemMatch[1]);
            itemName = itemMatch[2].trim();
          }
          
          if (unitPriceMatch[2]) {
            quantity = parseInt(unitPriceMatch[1]) || quantity;
            unitPrice = parsePrice(unitPriceMatch[2]);
          } else {
            unitPrice = parsePrice(unitPriceMatch[1]);
          }
          
          const lineTotal = parsePrice(lineTotalMatch[1]);
          
          const expectedTotal = quantity * unitPrice;
          const difference = Math.abs(lineTotal - expectedTotal);
          
          if ((difference < 1 || difference / expectedTotal < 0.1) && lineTotal > 0) {
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
            
            i += 3;
            continue;
          }
        }
      }
    }

    // Single-line format: "Item Name    10,000"
    const priceMatches = [...line.matchAll(new RegExp(pricePattern.source, 'g'))];
    
    if (priceMatches.length >= 1) {
      if (line.startsWith('@')) {
        console.log(`Skipped (unit price line): ${line}`);
        i++;
        continue;
      }
      
      if (/^\d{1,3}(?:[,\.]\d{3})*(?:[,\.]\d{2})?$/.test(line)) {
        console.log(`Skipped (standalone price): ${line}`);
        i++;
        continue;
      }
      
      const lastPrice = priceMatches[priceMatches.length - 1][1];
      const price = parsePrice(lastPrice);

      if (price > 0 && price < 100000000) {
        let name = line;
        priceMatches.forEach(m => {
          name = name.replace(m[0], '');
        });
        
        name = name
          .replace(/^\d+\s+/, '')
          .replace(/[@#\+\*]/g, '')
          .replace(/\s+/g, ' ')
          .trim();

        const invalidNamePatterns = [
          /^(rp|idr)$/i,
          /^qty$/i,
          /^(pb|ppn|vat)\s*\d+/i,
          /percent|%/i,
          /^avg/i,
          /pajak/i,
          /^(tunai|tunal|cash|bayar|dibayar|kembalian|embalian|kembali|change)/i,
        ];
        
        if (invalidNamePatterns.some(p => p.test(name))) {
          console.log(`Skipped (invalid name pattern): "${name}"`);
          i++;
          continue;
        }

        if (name.length >= 3 && /[a-zA-Z]/.test(name)) {
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

function parsePrice(priceStr) {
  let cleaned = priceStr.replace(/[^\d,\.]/g, '').trim();
  
  if (!cleaned) return 0;
  
  const commas = (cleaned.match(/,/g) || []).length;
  const dots = (cleaned.match(/\./g) || []).length;
  
  if (commas > 1 || dots > 1) {
    const lastComma = cleaned.lastIndexOf(',');
    const lastDot = cleaned.lastIndexOf('.');
    
    if (lastComma > lastDot) {
      cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    } else {
      cleaned = cleaned.replace(/,/g, '');
    }
  } else if (commas === 1 && dots === 1) {
    const commaPos = cleaned.indexOf(',');
    const dotPos = cleaned.indexOf('.');
    
    if (commaPos < dotPos) {
      cleaned = cleaned.replace(',', '');
    } else {
      cleaned = cleaned.replace('.', '').replace(',', '.');
    }
  } else if (commas === 1) {
    const parts = cleaned.split(',');
    if (parts[1] && parts[1].length === 2) {
      cleaned = cleaned.replace(',', '.');
    } else {
      cleaned = cleaned.replace(',', '');
    }
  } else if (dots === 1) {
    const parts = cleaned.split('.');
    if (parts[1] && parts[1].length === 2) {
      // Already correct
    } else if (parts[1] && parts[1].length === 3) {
      cleaned = cleaned.replace('.', '');
    }
  }
  
  const parsed = parseFloat(cleaned);
  
  return isNaN(parsed) ? 0 : parsed;
}

module.exports = router;