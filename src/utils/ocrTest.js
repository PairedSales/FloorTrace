import Tesseract from 'tesseract.js';
import { dataUrlToImage, imageToCanvas } from './imageLoader';

/**
 * Test OCR functionality and regex patterns
 */
export const testOCR = async (imageDataUrl) => {
  console.log('=== OCR TEST START ===');
  
  try {
    // Convert data URL to image
    const img = await dataUrlToImage(imageDataUrl);
    const canvas = imageToCanvas(img);
    
    console.log('Image loaded:', {
      width: img.width,
      height: img.height
    });
    
    // Run OCR on the image
    console.log('Running OCR...');
    const result = await Tesseract.recognize(
      canvas,
      'eng',
      {
        logger: (m) => {
          if (m.status === 'recognizing text') {
            console.log(`OCR Progress: ${Math.round(m.progress * 100)}%`);
          }
        },
        workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/worker.min.js',
        langPath: 'https://tessdata.projectnaptha.com/4.0.0',
        corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5/tesseract-core.wasm.js'
      }
    );
    
    console.log('=== RAW OCR TEXT ===');
    console.log(result.data.text);
    console.log('=== END RAW TEXT ===');
    
    console.log('\n=== OCR DATA STRUCTURE ===');
    console.log('Available keys:', Object.keys(result.data));
    console.log('Words available:', Array.isArray(result.data.words));
    if (result.data.words) {
      console.log('Number of words:', result.data.words.length);
      if (result.data.words.length > 0) {
        console.log('First word sample:', result.data.words[0]);
      }
    }
    console.log('=== END STRUCTURE ===');
    
    // Test regex patterns
    console.log('\n=== TESTING REGEX PATTERNS ===');
    
    const text = result.data.text;
    const textLines = text.split('\n');
    
    console.log(`Total lines: ${textLines.length}`);
    
    // Pattern 1: Feet and inches (e.g., 5' 10" x 6' 3" or 3' - 7" x 12' - 0")
    const feetInchesPattern = /(\d+)\s*'\s*-?\s*(\d+)\s*"\s*x\s*(\d+)\s*'\s*-?\s*(\d+)\s*"/i;
    
    // Pattern 2: Decimal feet with "ft" or "feet" (e.g., 5.2 ft x 6.3 ft)
    const decimalFeetPattern = /(\d+(?:\.\d+)?)\s*(?:ft|feet)\s*x\s*(\d+(?:\.\d+)?)\s*(?:ft|feet)/i;
    
    // Pattern 3: Simple numbers with x (e.g., 12 x 10)
    const simplePattern = /(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)/i;
    
    let matchCount = 0;
    
    textLines.forEach((line, index) => {
      const trimmedLine = line.trim();
      if (!trimmedLine) return;
      
      console.log(`\nLine ${index + 1}: "${trimmedLine}"`);
      
      // Test Pattern 1
      const match1 = trimmedLine.match(feetInchesPattern);
      if (match1) {
        matchCount++;
        const width = parseInt(match1[1]) + parseInt(match1[2]) / 12;
        const height = parseInt(match1[3]) + parseInt(match1[4]) / 12;
        console.log(`  ✓ Pattern 1 (Feet-Inches): ${width.toFixed(2)} x ${height.toFixed(2)} ft`);
        console.log(`    Match: "${match1[0]}"`);
        return;
      }
      
      // Test Pattern 2
      const match2 = trimmedLine.match(decimalFeetPattern);
      if (match2) {
        matchCount++;
        console.log(`  ✓ Pattern 2 (Decimal Feet): ${match2[1]} x ${match2[2]} ft`);
        console.log(`    Match: "${match2[0]}"`);
        return;
      }
      
      // Test Pattern 3
      const match3 = trimmedLine.match(simplePattern);
      if (match3) {
        matchCount++;
        console.log(`  ✓ Pattern 3 (Simple): ${match3[1]} x ${match3[2]}`);
        console.log(`    Match: "${match3[0]}"`);
        return;
      }
      
      console.log('  ✗ No pattern matched');
    });
    
    console.log(`\n=== SUMMARY ===`);
    console.log(`Total matches found: ${matchCount}`);
    
    // Test with sample strings
    console.log('\n=== TESTING WITH SAMPLE STRINGS ===');
    const testStrings = [
      "13' 5\" x 12' 11\"",
      "12' 5\" x 16' 4\"",
      "16' 7\" x 25' 10\"",
      "10' 9\" x 7' 11\"",
      "13'5\"x12'11\"",     // No spaces
      "13' - 5\" x 12' - 11\"", // With dashes
    ];
    
    testStrings.forEach(testStr => {
      console.log(`\nTest: "${testStr}"`);
      const match = testStr.match(feetInchesPattern);
      if (match) {
        const width = parseInt(match[1]) + parseInt(match[2]) / 12;
        const height = parseInt(match[3]) + parseInt(match[4]) / 12;
        console.log(`  ✓ Matched: ${width.toFixed(2)} x ${height.toFixed(2)} ft`);
      } else {
        console.log('  ✗ No match');
      }
    });
    
    console.log('\n=== OCR TEST COMPLETE ===');
    
    return {
      success: true,
      rawText: result.data.text,
      matchCount,
      lines: textLines.length
    };
    
  } catch (error) {
    console.error('=== OCR TEST FAILED ===');
    console.error(error);
    return {
      success: false,
      error: error.message
    };
  }
};
