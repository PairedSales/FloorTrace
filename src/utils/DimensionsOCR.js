import Tesseract from 'tesseract.js';
import { dataUrlToImage, imageToCanvas } from './imageLoader';

const MIN_DIMENSION_FEET = 1;
const MAX_DIMENSION_FEET = 250;

const OCR_REPLACEMENTS = [
  [/\u00D7/g, 'x'], // multiplication sign
  [/\b(?:by|BY)\b/g, 'x'],
  [/\s+[Xx]\s+/g, ' x '],
  [/([0-9])\s*[oO](?=\s*(?:ft|feet|['"]))/g, '$10'],
  [/\b[oO](?=\d)/g, '0']
];

const FEET_INCHES_REGEX = /^(\d{1,3})\s*'\s*(?:(\d{1,2})\s*(?:"|''|in)?)?$/i;

const normalizeOcrText = (text) => {
  let normalized = text || '';

  OCR_REPLACEMENTS.forEach(([pattern, replacement]) => {
    normalized = normalized.replace(pattern, replacement);
  });

  return normalized
    .replace(/[|]/g, '1')
    .replace(/[–—−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
};

const isReasonableDimension = (value) => {
  return Number.isFinite(value) && value >= MIN_DIMENSION_FEET && value <= MAX_DIMENSION_FEET;
};

const parseFeetInchesToken = (token) => {
  const match = token.match(FEET_INCHES_REGEX);
  if (!match) return null;

  const feet = parseInt(match[1], 10);
  const inches = match[2] ? parseInt(match[2], 10) : 0;
  if (inches >= 12) return null;

  return feet + inches / 12;
};

const parseDecimalToken = (token) => {
  const cleaned = token
    .replace(/,/g, '')
    .replace(/\s*(?:ft|feet|inches|inch|in)\.?$/i, '')
    .trim();

  if (!cleaned) return null;

  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
};

const splitDimensionParts = (text) => {
  const separatorRegex = /\s*(?:x|×|by)\s*/i;
  const match = text.match(separatorRegex);
  if (!match) return null;

  const splitIndex = match.index;
  const separatorLength = match[0].length;

  const left = text.slice(0, splitIndex).trim();
  const right = text.slice(splitIndex + separatorLength).trim();
  if (!left || !right) return null;

  return { left, right };
};

const createImageVariants = (img) => {
  const baseCanvas = imageToCanvas(img);
  const highContrastCanvas = document.createElement('canvas');
  highContrastCanvas.width = img.width;
  highContrastCanvas.height = img.height;
  const highContrastCtx = highContrastCanvas.getContext('2d');
  highContrastCtx.drawImage(img, 0, 0);

  const imageData = highContrastCtx.getImageData(0, 0, img.width, img.height);
  const { data } = imageData;

  for (let i = 0; i < data.length; i += 4) {
    const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    const threshold = gray > 165 ? 255 : 0;
    data[i] = threshold;
    data[i + 1] = threshold;
    data[i + 2] = threshold;
  }

  highContrastCtx.putImageData(imageData, 0, 0);

  return [
    { name: 'base', canvas: baseCanvas },
    { name: 'high-contrast', canvas: highContrastCanvas }
  ];
};

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
  const normalized = normalizeOcrText(text);
  const parts = splitDimensionParts(normalized);
  if (!parts) return null;

  const leftFeetInches = parseFeetInchesToken(parts.left);
  const rightFeetInches = parseFeetInchesToken(parts.right);
  if (leftFeetInches !== null && rightFeetInches !== null) {
    if (isReasonableDimension(leftFeetInches) && isReasonableDimension(rightFeetInches)) {
      return {
        width: leftFeetInches,
        height: rightFeetInches,
        match: normalized,
        format: 'inches'
      };
    }
    return null;
  }

  const leftDecimal = parseDecimalToken(parts.left);
  const rightDecimal = parseDecimalToken(parts.right);
  if (leftDecimal !== null && rightDecimal !== null) {
    if (isReasonableDimension(leftDecimal) && isReasonableDimension(rightDecimal)) {
      return {
        width: leftDecimal,
        height: rightDecimal,
        match: normalized,
        format: 'decimal'
      };
    }
    return null;
  }

  // Pattern 1: Feet and inches (e.g., 5' 10" x 6' 3" or 3' - 7" x 12' - 0")
  const feetInchesPattern = /(\d+)\s*'\s*-?\s*(\d+)\s*"?\s*x\s*(\d+)\s*'\s*-?\s*(\d+)\s*"?/i;
  const feetInchesMatch = normalized.match(feetInchesPattern);
  if (feetInchesMatch) {
    const width = parseInt(feetInchesMatch[1]) + parseInt(feetInchesMatch[2]) / 12;
    const height = parseInt(feetInchesMatch[3]) + parseInt(feetInchesMatch[4]) / 12;
    if (isReasonableDimension(width) && isReasonableDimension(height)) {
      return { width, height, match: feetInchesMatch[0], format: 'inches' };
    }
  }
  
  // Pattern 2: Decimal feet with "ft" or "feet" (e.g., 5.2 ft x 6.3 ft)
  const decimalFeetPattern = /(\d+(?:\.\d+)?)\s*(?:ft|feet)\s*x\s*(\d+(?:\.\d+)?)\s*(?:ft|feet)/i;
  const decimalFeetMatch = normalized.match(decimalFeetPattern);
  if (decimalFeetMatch) {
    const width = parseFloat(decimalFeetMatch[1]);
    const height = parseFloat(decimalFeetMatch[2]);
    if (isReasonableDimension(width) && isReasonableDimension(height)) {
      return { width, height, match: decimalFeetMatch[0], format: 'decimal' };
    }
  }
  
  // Pattern 3: Simple numbers with x (e.g., 12 x 10, assumed feet)
  // Check if it has decimal points to determine format
  const simplePattern = /(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)/i;
  const simpleMatch = normalized.match(simplePattern);
  if (simpleMatch) {
    const width = parseFloat(simpleMatch[1]);
    const height = parseFloat(simpleMatch[2]);
    if (!isReasonableDimension(width) || !isReasonableDimension(height)) {
      return null;
    }
    // If either number has a decimal point, assume decimal format
    const hasDecimal = simpleMatch[1].includes('.') || simpleMatch[2].includes('.');
    return { width, height, match: simpleMatch[0], format: hasDecimal ? 'decimal' : 'decimal' };
  }
  
  return null;
};

// Get all detected dimensions for manual mode (only left-to-right reading order)
export const detectAllDimensions = async (imageDataUrl) => {
  try {
    const img = await dataUrlToImage(imageDataUrl);
    const imageVariants = createImageVariants(img);
    
    // Run OCR on the image using v6 worker API with optimizations
    console.log('detectAllDimensions: Starting OCR with v6 worker API (optimized)...');
    const worker = await Tesseract.createWorker('eng', 1, {
      logger: (m) => console.log('OCR Progress:', m)
    });
    
    const collectWordsFromResult = (result) => {
      const collectedWords = [];
      if (!result.data.blocks) return collectedWords;

      for (const block of result.data.blocks) {
        if (!block.paragraphs) continue;
        for (const paragraph of block.paragraphs) {
          if (!paragraph.lines) continue;
          for (const line of paragraph.lines) {
            if (!line.words) continue;
            collectedWords.push(...line.words);
          }
        }
      }

      return collectedWords;
    };

    const aggregatedLines = [];
    const aggregatedWords = [];

    for (const variant of imageVariants) {
      for (const pageSegMode of [Tesseract.PSM.AUTO, Tesseract.PSM.SINGLE_BLOCK]) {
        await worker.setParameters({
          tessedit_char_whitelist: "0123456789'\"ftxXby .,-",
          tessedit_pageseg_mode: pageSegMode,
          preserve_interword_spaces: '1'
        });

        const result = await worker.recognize(variant.canvas, {}, { blocks: true });

        const textLines = result.data.text
          .split('\n')
          .map((line) => normalizeOcrText(line))
          .filter(Boolean);

        aggregatedLines.push(...textLines);
        aggregatedWords.push(...collectWordsFromResult(result));
      }
    }
    await worker.terminate();
    
    console.log('detectAllDimensions: OCR complete');
    
    console.log('detectAllDimensions: Total lines:', aggregatedLines.length);
    
    const dimensions = [];
    let detectedFormat = null; // Track the first detected format
    
    // Get words array for bounding box lookup
    // In Tesseract.js v6, words are nested: blocks → paragraphs → lines → words
    const words = aggregatedWords;
    console.log('detectAllDimensions: Words extracted:', words.length);
    
    // Log first few words for debugging
    if (words.length > 0) {
      console.log('detectAllDimensions: Sample words:', words.slice(0, 5).map(w => ({
        text: w.text,
        bbox: w.bbox
      })));
    } else {
      console.warn('detectAllDimensions: No words found! Check if blocks output is enabled.');
    }
    
    // Track which words have been used across all dimensions
    const globalUsedWordIndices = new Set();
    
    const processedLineSet = new Set();
    for (const line of aggregatedLines) {
      const trimmedLine = line.trim();
      if (!trimmedLine) continue;
      if (processedLineSet.has(trimmedLine)) continue;
      processedLineSet.add(trimmedLine);
      
      console.log(`detectAllDimensions: Testing line: "${trimmedLine}"`);
      const parsed = parseDimensions(trimmedLine);
      
      if (parsed) {
        console.log(`detectAllDimensions: ✓ Found dimension: ${parsed.width} x ${parsed.height} (${parsed.format})`);
        
        // Store the first detected format
        if (!detectedFormat) {
          detectedFormat = parsed.format;
        }
        
        // Find the bounding box for this dimension in the OCR result
        let dimensionBBox = null;
        
        // Extract numeric tokens from the dimension text for precise matching
        // For "13' 5\" x 12' 11\"", extract the numbers: 13, 5, 12, 11
        const numericTokens = parsed.match.match(/\d+/g) || [];
        console.log(`detectAllDimensions: Looking for numeric tokens:`, numericTokens);
        
        // First pass: find words that contain these specific numbers
        const matchingWords = [];
        
        for (let wordIndex = 0; wordIndex < words.length; wordIndex++) {
          const word = words[wordIndex];
          if (!word.text || !word.bbox) continue;
          
          // Skip words that have already been used by previous dimensions
          if (globalUsedWordIndices.has(wordIndex)) continue;
          
          const wordText = word.text.trim();
          if (wordText.length === 0) continue;
          
          // Check if this word contains any of our numeric tokens
          const containsNumber = numericTokens.some(num => wordText.includes(num));
          
          if (containsNumber) {
            matchingWords.push({ word, index: wordIndex });
            console.log(`detectAllDimensions: Matched word "${wordText}" at (${Math.round(word.bbox.x0)}, ${Math.round(word.bbox.y0)})`);
          }
        }
        
        // Second pass: find the cluster of words that are close together
        // This prevents matching words from different parts of the image
        if (matchingWords.length > 0) {
          // Start with the first matching word
          let clusterWords = [matchingWords[0]];
          
          // Add words that are spatially close (within 100 pixels vertically, 300 pixels horizontally)
          const maxVerticalDistance = 100;
          const maxHorizontalDistance = 300;
          
          for (let i = 1; i < matchingWords.length; i++) {
            const { word } = matchingWords[i];
            const wordCenterX = (word.bbox.x0 + word.bbox.x1) / 2;
            const wordCenterY = (word.bbox.y0 + word.bbox.y1) / 2;
            
            // Check if this word is close to any word in the cluster
            let isClose = false;
            for (const clusterItem of clusterWords) {
              const clusterWord = clusterItem.word;
              const clusterCenterX = (clusterWord.bbox.x0 + clusterWord.bbox.x1) / 2;
              const clusterCenterY = (clusterWord.bbox.y0 + clusterWord.bbox.y1) / 2;
              
              const verticalDist = Math.abs(wordCenterY - clusterCenterY);
              const horizontalDist = Math.abs(wordCenterX - clusterCenterX);
              
              if (verticalDist <= maxVerticalDistance && horizontalDist <= maxHorizontalDistance) {
                isClose = true;
                break;
              }
            }
            
            if (isClose) {
              clusterWords.push(matchingWords[i]);
            }
          }
          
          // Build bbox from clustered words only and mark them as used
          for (const { word, index } of clusterWords) {
            // Mark this word as used globally
            globalUsedWordIndices.add(index);
            
            if (!dimensionBBox) {
              dimensionBBox = {
                x: word.bbox.x0,
                y: word.bbox.y0,
                width: word.bbox.x1 - word.bbox.x0,
                height: word.bbox.y1 - word.bbox.y0
              };
            } else {
              // Expand bbox to include this word
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
        
        // If we couldn't find a bbox, create a fallback synthetic one
        if (!dimensionBBox) {
          console.log(`detectAllDimensions: ⚠ No bbox found for "${parsed.match}"`);
          console.log(`detectAllDimensions: Numeric tokens to match:`, numericTokens);
          console.log(`detectAllDimensions: Matching words found:`, matchingWords.length);
          console.log(`detectAllDimensions: Available word texts:`, words.slice(0, 10).map(w => w.text));
          console.log(`detectAllDimensions: Creating synthetic bbox`);
          const imageWidth = img.width;
          const imageHeight = img.height;
          const dimensionIndex = dimensions.length;
          
          dimensionBBox = {
            x: imageWidth / 2 - 100,
            y: imageHeight * 0.3 + (dimensionIndex * 80),
            width: 200,
            height: 50
          };
        } else {
          console.log(`detectAllDimensions: ✓ Found bbox at (${Math.round(dimensionBBox.x)}, ${Math.round(dimensionBBox.y)}), size: ${Math.round(dimensionBBox.width)}x${Math.round(dimensionBBox.height)}`);
          console.log(`detectAllDimensions: Image dimensions: ${img.width}x${img.height}`);
          console.log(`detectAllDimensions: Bbox relative position: ${(dimensionBBox.x / img.width * 100).toFixed(1)}% x, ${(dimensionBBox.y / img.height * 100).toFixed(1)}% y`);
        }
        
        dimensions.push({
          width: parsed.width,
          height: parsed.height,
          text: parsed.match,
          bbox: dimensionBBox,
          format: parsed.format
        });
      } else {
        console.log(`detectAllDimensions: ✗ No dimension pattern matched`);
      }
    }
    
    console.log(`detectAllDimensions: Found ${dimensions.length} dimensions for manual mode`);
    console.log(`detectAllDimensions: Detected format: ${detectedFormat}`);
    return { dimensions, detectedFormat };
  } catch (error) {
    console.error('Error detecting all dimensions:', error);
    return { dimensions: [], detectedFormat: null };
  }
};
