import Tesseract from 'tesseract.js';
import { dataUrlToImage, imageToCanvas } from './imageLoader';
import { detectLines, findRoomBox } from './lineDetector';

/**
 * Parse dimension text and extract width and height in feet
 * Supports multiple formats:
 * - 5' 10" x 6' 3"
 * - 3' - 7" x 12' - 0"
 * - 5.2 ft x 6.3 ft
 * - 21.3 feet x 11.1 feet
 * - 12 x 10 (assumed feet)
 * Returns format type: 'inches' for feet-inches format, 'decimal' for decimal feet
 */
const parseDimensions = (text) => {
  // Pattern 1: Feet and inches (e.g., 5' 10" x 6' 3" or 3' - 7" x 12' - 0")
  const feetInchesPattern = /(\d+)\s*'\s*-?\s*(\d+)\s*"\s*x\s*(\d+)\s*'\s*-?\s*(\d+)\s*"/i;
  const feetInchesMatch = text.match(feetInchesPattern);
  if (feetInchesMatch) {
    const width = parseInt(feetInchesMatch[1]) + parseInt(feetInchesMatch[2]) / 12;
    const height = parseInt(feetInchesMatch[3]) + parseInt(feetInchesMatch[4]) / 12;
    return { width, height, match: feetInchesMatch[0], format: 'inches' };
  }
  
  // Pattern 2: Decimal feet with "ft" or "feet" (e.g., 5.2 ft x 6.3 ft)
  const decimalFeetPattern = /(\d+(?:\.\d+)?)\s*(?:ft|feet)\s*x\s*(\d+(?:\.\d+)?)\s*(?:ft|feet)/i;
  const decimalFeetMatch = text.match(decimalFeetPattern);
  if (decimalFeetMatch) {
    const width = parseFloat(decimalFeetMatch[1]);
    const height = parseFloat(decimalFeetMatch[2]);
    return { width, height, match: decimalFeetMatch[0], format: 'decimal' };
  }
  
  // Pattern 3: Simple numbers with x (e.g., 12 x 10, assumed feet)
  // Check if it has decimal points to determine format
  const simplePattern = /(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)/i;
  const simpleMatch = text.match(simplePattern);
  if (simpleMatch) {
    const width = parseFloat(simpleMatch[1]);
    const height = parseFloat(simpleMatch[2]);
    // If either number has a decimal point, assume decimal format
    const hasDecimal = simpleMatch[1].includes('.') || simpleMatch[2].includes('.');
    return { width, height, match: simpleMatch[0], format: hasDecimal ? 'decimal' : 'decimal' };
  }
  
  return null;
};

// Detect room dimensions using OCR and line detection
export const detectRoom = async (imageDataUrl) => {
  try {
    // Convert data URL to image
    const img = await dataUrlToImage(imageDataUrl);
    const canvas = imageToCanvas(img);
    
    // Detect lines in the image
    console.log('Detecting lines...');
    const lineData = detectLines(img);
    console.log(`Found ${lineData.horizontal.length} horizontal and ${lineData.vertical.length} vertical lines`);
    
    // Run OCR on the image
    console.log('Running OCR...');
    const result = await Tesseract.recognize(
      canvas,
      'eng',
      {
        logger: (m) => console.log('OCR Progress:', m),
        workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/worker.min.js',
        langPath: 'https://tessdata.projectnaptha.com/4.0.0',
        corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@6.0.1/tesseract-core.wasm.js'
      }
    );
    
    // Parse text for room dimensions (scan left-to-right, top-to-bottom)
    const text = result.data.text;
    const textLines = text.split('\n');
    
    let firstDimension = null;
    let dimensionBBox = null;
    
    // Scan through text lines to find first dimension (left-to-right reading order)
    for (const line of textLines) {
      const parsed = parseDimensions(line);
      if (parsed) {
        firstDimension = parsed;
        
        // Find the bounding box for this dimension in the OCR result
        for (const word of result.data.words) {
          if (word.text && parsed.match.includes(word.text.replace(/\s/g, ''))) {
            if (!dimensionBBox) {
              dimensionBBox = {
                x: word.bbox.x0,
                y: word.bbox.y0,
                width: word.bbox.x1 - word.bbox.x0,
                height: word.bbox.y1 - word.bbox.y0
              };
            } else {
              const minX = Math.min(dimensionBBox.x, word.bbox.x0);
              const minY = Math.min(dimensionBBox.y, word.bbox.y0);
              const maxX = Math.max(dimensionBBox.x + dimensionBBox.width, word.bbox.x1);
              const maxY = Math.max(dimensionBBox.y + dimensionBBox.height, word.bbox.y1);
              dimensionBBox = {
                x: minX,
                y: minY,
                width: maxX - minX,
                height: maxY - minY
              };
            }
          }
        }
        break; // Found first dimension, stop searching
      }
    }
    
    if (!firstDimension) {
      console.log('No room dimensions found in OCR text:', text);
      return null;
    }
    
    console.log(`Found dimension: ${firstDimension.width} x ${firstDimension.height} ft`);
    
    // Use line detection to find the room box
    let roomOverlay = null;
    if (dimensionBBox && lineData.horizontal.length > 0 && lineData.vertical.length > 0) {
      console.log('Finding room box using line detection...');
      roomOverlay = findRoomBox(dimensionBBox, lineData.horizontal, lineData.vertical);
    }
    
    // Fallback if line detection didn't work
    if (!roomOverlay) {
      console.log('Line detection failed, using fallback room box');
      if (dimensionBBox) {
        // Create a box around the dimension text
        const padding = 50;
        roomOverlay = {
          x1: Math.max(0, dimensionBBox.x - padding),
          y1: Math.max(0, dimensionBBox.y - padding),
          x2: Math.min(img.width, dimensionBBox.x + dimensionBBox.width + padding),
          y2: Math.min(img.height, dimensionBBox.y + dimensionBBox.height + padding)
        };
      } else {
        // Default to center
        roomOverlay = {
          x1: img.width * 0.25,
          y1: img.height * 0.25,
          x2: img.width * 0.75,
          y2: img.height * 0.75
        };
      }
    }
    
    return {
      dimensions: { 
        width: firstDimension.width.toString(), 
        height: firstDimension.height.toString() 
      },
      overlay: roomOverlay,
      lineData, // Return line data for use by other functions
      detectedFormat: firstDimension.format // Return the detected format ('inches' or 'decimal')
    };
  } catch (error) {
    console.error('Error in room detection:', error);
    return null;
  }
};

// Get all detected dimensions for manual mode (only left-to-right reading order)
export const detectAllDimensions = async (imageDataUrl) => {
  try {
    const img = await dataUrlToImage(imageDataUrl);
    const canvas = imageToCanvas(img);
    
    // Run OCR on the image
    const result = await Tesseract.recognize(
      canvas,
      'eng',
      {
        logger: (m) => console.log('OCR Progress:', m),
        workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/worker.min.js',
        langPath: 'https://tessdata.projectnaptha.com/4.0.0',
        corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@6.0.1/tesseract-core.wasm.js'
      }
    );
    
    // Find all dimension patterns (left-to-right reading order)
    const text = result.data.text;
    const textLines = text.split('\n');
    
    const dimensions = [];
    let detectedFormat = null; // Track the first detected format
    
    for (const line of textLines) {
      const parsed = parseDimensions(line);
      if (parsed) {
        // Store the first detected format
        if (!detectedFormat) {
          detectedFormat = parsed.format;
        }
        
        // Find the bounding box for this dimension
        let bbox = null;
        for (const word of result.data.words) {
          if (word.text && parsed.match.includes(word.text.replace(/\s/g, ''))) {
            if (!bbox) {
              bbox = {
                x: word.bbox.x0,
                y: word.bbox.y0,
                width: word.bbox.x1 - word.bbox.x0,
                height: word.bbox.y1 - word.bbox.y0
              };
            } else {
              const minX = Math.min(bbox.x, word.bbox.x0);
              const minY = Math.min(bbox.y, word.bbox.y0);
              const maxX = Math.max(bbox.x + bbox.width, word.bbox.x1);
              const maxY = Math.max(bbox.y + bbox.height, word.bbox.y1);
              bbox = {
                x: minX,
                y: minY,
                width: maxX - minX,
                height: maxY - minY
              };
            }
          }
        }
        
        if (bbox) {
          dimensions.push({
            width: parsed.width,
            height: parsed.height,
            text: parsed.match,
            bbox,
            format: parsed.format
          });
        }
      }
    }
    
    console.log(`Found ${dimensions.length} dimensions for manual mode`);
    return { dimensions, detectedFormat };
  } catch (error) {
    console.error('Error detecting all dimensions:', error);
    return [];
  }
};
