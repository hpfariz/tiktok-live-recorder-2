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
  
  const totalPattern = /\b(total|grand\s*total|amount\s*paid)\s*:?/i;
  const taxPattern = /\b(pb1|ppn|tax|pajak|vat)\s*(?:\d+(?:\.\d+)?%|\(\d+(?:\.\d+)?%\))?:?/i;
  const servicePattern = /\b(service|srv|layanan|charge)\s*:?/i;
  const subtotalPattern = /\b(sub[\s-]?total)\s*:?/i;
  
  const itemLinePattern = /^(\d+)\s+(.+)/;
  const unitPricePattern = /^@\s*(\d{1,3}(?:[,\.]\d{3})*(?:[,\.]\d{2})?)/;
  const zeroUnitPricePattern = /^@\s*0(?:\.00?)?$/;
  
  // Comprehensive skip patterns
  const skipPatterns = [
    /^(date|time|table|outlet|store|cashier|number|dine\s*in|idr|receipt|bill|nota|struk|bistro|counter|member|card\s*balance|amount\s*paid|card\s*no|expired|payment|rounding)\b/i,
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
    /^(terima\s*kasih|thank\s*you|please\s*come\s*again)/i,
    /^lunas/i,
    /^(tunai|tunal|cash|bayar|dibayar|kembalian|embalian|kembali|change)\s*:?/i,
    /^(no\.|kode|tanggal|kasir|order|struk|invoice|pesan|pegawai|jam|bill\s*no)[\s:]/i,
    /^(nama|alamat|nomer|telpon|meja|tamu|qty|harga|barang)[\s:]/i,
    /^(jl|jalan|street|road)\b/i,
    /^0\d{9,}/,
    /^[a-z]{1,2}\d+$/i, // C3, RK21, etc.
    /^[a-z0-9]{10,}/i,
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
      
      if (amount > 100 && amount < 100000000) { // Must be > 100 to be a valid subtotal
        subtotal = amount;
        console.log(`Found SUBTOTAL amount: ${subtotal} from line ${subtotalIndex}`);
      }
    }
    
    if (!subtotal) {
      for (let j = subtotalIndex + 1; j < Math.min(subtotalIndex + 5, lines.length); j++) {
        const amountLine = lines[j].trim();
        
        if (taxPattern.test(amountLine) || totalPattern.test(amountLine)) continue;
        
        const amountMatch = amountLine.match(pricePattern);
        if (amountMatch) {
          const amount = parsePrice(amountMatch[1]);
          if (amount > 100 && amount < 100000000) {
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
    } else if (/pajak/i.test(taxLine)) {
      taxName = `Pajak ${taxPercent}%`;
    } else {
      taxName = `Tax ${taxPercent}%`;
    }
    
    // Filter out percentage number and very small values
    if (allPrices.length > 0) {
      const validPrices = allPrices.filter(m => {
        const val = parsePrice(m[1]);
        return Math.abs(val - taxPercent) > 0.1 && val > 1; // Must be > 1
      });
      
      if (validPrices.length > 0) {
        const lastPrice = validPrices[validPrices.length - 1][1];
        const amount = parsePrice(lastPrice);
        
        if (amount > 1 && amount < 100000000) {
          tax = {
            name: taxName,
            amount: Math.round(amount * 100) / 100
          };
          console.log(`✅ Found TAX: ${tax.name} = ${tax.amount} from line ${taxLineIndex}`);
        }
      }
    }
    
    if (!tax) {
      for (let j = taxLineIndex + 1; j < Math.min(taxLineIndex + 3, lines.length); j++) {
        const amountLine = lines[j].trim();
        
        if (totalPattern.test(amountLine)) continue;
        
        const amountMatch = amountLine.match(pricePattern);
        if (amountMatch) {
          const amount = parsePrice(amountMatch[1]);
          if (amount > 1 && amount < 100000000) {
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
      
      if (amount > 100 && amount < 100000000) {
        total = amount;
        console.log(`Found TOTAL amount: ${total} from line ${totalIndex}`);
      }
    }
    
    if (!total) {
      for (let j = totalIndex + 1; j < Math.min(totalIndex + 3, lines.length); j++) {
        const amountLine = lines[j].trim();
        
        if (/^(tunai|tunal|cash|bayar|dibayar|kembalian|embalian|kembali|change|card\s*balance)/i.test(amountLine)) {
          console.log(`Skipped payment line when looking for total: ${amountLine}`);
          continue;
        }
        
        const amountMatch = amountLine.match(pricePattern);
        if (amountMatch) {
          const amount = parsePrice(amountMatch[1]);
          if (amount > 100 && amount < 100000000) {
            total = amount;
            console.log(`Found TOTAL amount: ${total} at line ${j}`);
            break;
          }
        }
      }
    }
  }
  
  if (!tax && subtotal && total && total > subtotal) {
    const taxAmount = total - subtotal;
    tax = { 
      name: 'Tax 10%', 
      amount: Math.round(taxAmount * 100) / 100 
    };
    console.log(`✅ Calculated TAX: ${tax.name} = ${tax.amount}`);
  }

  // SECOND PASS: Parse items
  // Mark lines to skip (already processed as totals/tax)
  const processedLines = new Set();
  if (subtotalIndex >= 0) {
    for (let j = subtotalIndex; j < Math.min(subtotalIndex + 3, lines.length); j++) {
      processedLines.add(j);
    }
  }
  if (taxLineIndex >= 0) {
    for (let j = taxLineIndex; j < Math.min(taxLineIndex + 3, lines.length); j++) {
      processedLines.add(j);
    }
  }
  if (totalIndex >= 0) {
    for (let j = totalIndex; j < Math.min(totalIndex + 5, lines.length); j++) {
      processedLines.add(j);
    }
  }
  
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    
    if (!line || line.length < 2 || processedLines.has(i)) {
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

    // Skip headers with colons
    if (/:/.test(line)) {
      const priceMatches = [...line.matchAll(new RegExp(pricePattern.source, 'g'))];
      
      if (priceMatches.length === 0) {
        console.log(`Skipped (header with colon, no price): ${line}`);
        i++;
        continue;
      }
      
      const allSmall = priceMatches.every(m => parsePrice(m[1]) < 100);
      if (allSmall) {
        console.log(`Skipped (header with small numbers): ${line}`);
        i++;
        continue;
      }
      
      if (/^(tunai|tunal|cash|bayar|payment|card|expired)/i.test(line)) {
        console.log(`Skipped (payment/card line): ${line}`);
        i++;
        continue;
      }
    }

    // NEW: Format "QTY" + "ITEM NAME" + "PRICE" (three lines)
    // Example: "1" then "Nasi Putih." then "7.272"
    if (i + 2 < lines.length) {
      const isQtyOnly = /^(\d+)$/.test(line) && parseInt(line) > 0 && parseInt(line) < 100;
      const nextLine = lines[i + 1].trim();
      const lineAfterNext = lines[i + 2].trim();
      
      // Check if next line is item name (no price, mostly letters)
      const hasNoPrice = !pricePattern.test(nextLine);
      const hasLetters = /[a-zA-Z]/.test(nextLine);
      
      // Check if line after next is just a price
      const isPriceOnly = /^(\d{1,3}(?:[,\.]\d{3})*(?:[,\.]\d{2})?)$/.test(lineAfterNext);
      
      if (isQtyOnly && hasNoPrice && hasLetters && isPriceOnly && !processedLines.has(i+1) && !processedLines.has(i+2)) {
        const quantity = parseInt(line);
        const itemName = nextLine.trim();
        const price = parsePrice(lineAfterNext);
        
        // Validate
        if (itemName.length >= 3 && price > 0 && !skipPatterns.some(p => p.test(itemName))) {
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
            console.log(`✅ Three-line item: ${quantity} ${itemName} @ ${unitPrice} = ${price}`);
            i += 3;
            continue;
          }
        }
      }
    }

    // Format: "ITEM × QTY PRICE" (single line)
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

    // Format: "ITEM × QTY" then price on next line
    if (i + 1 < lines.length && !processedLines.has(i+1)) {
      const nextLine = lines[i + 1].trim();
      
      const qtyNoPrice = line.match(/^(.+?)\s*[×x]\s*(\d+)$/i);
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
            i += 2;
            continue;
          }
        }
      }
    }

    // Format: "QTY ITEM NAME" then price on next line
    if (i + 1 < lines.length && !processedLines.has(i+1)) {
      const nextLine = lines[i + 1].trim();
      const qtyItemMatch = line.match(/^(\d+)\s+(.+)$/);
      const isNextLinePrice = /^(\d{1,3}(?:[,\.]\d{3})*(?:[,\.]\d{2})?)$/.test(nextLine);
      
      if (qtyItemMatch && isNextLinePrice) {
        const quantity = parseInt(qtyItemMatch[1]);
        const itemName = qtyItemMatch[2].trim();
        const price = parsePrice(nextLine);
        
        if (quantity > 0 && quantity < 100 && itemName.length >= 3 && price > 0 && !skipPatterns.some(p => p.test(itemName))) {
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
            console.log(`✅ Item (qty+name, price next): ${quantity} ${itemName} @ ${unitPrice} = ${price}`);
            i += 2;
            continue;
          }
        }
      }
    }

    // Format: name then "qty price"
    if (i + 1 < lines.length && !/\d/.test(line) && !processedLines.has(i+1)) {
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

    // Multi-line with @ notation
    const itemMatch = line.match(itemLinePattern);
    const hasNextLine = i + 1 < lines.length;
    const hasLineAfterNext = i + 2 < lines.length;
    
    if (hasNextLine && hasLineAfterNext && !processedLines.has(i+1) && !processedLines.has(i+2)) {
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

    // Single-line: "Item Name    10,000"
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

      // Must be reasonable price
      if (price > 0 && price < 100000000 && price > 100) { // > 100 to avoid small numbers
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
          /^(tunai|tunal|cash|bayar|card|expired|member|balance)/i,
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