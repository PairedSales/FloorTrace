import Tesseract from 'tesseract.js';
import { dataUrlToImage, imageToCanvas } from './imageLoader';
import { detectLines, findRoomBox } from './lineDetector';
import { findRoomMorphological, findRoomByLines } from './morphologicalRoomDetector';

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
    
    // Run OCR on the image using v6 worker API with optimizations
    console.log('Running OCR with v6 worker API (optimized)...');
    const worker = await Tesseract.createWorker('eng', 1, {
      logger: (m) => console.log('OCR Progress:', m)
    });
    
    // Set parameters for faster OCR - only recognize numbers and dimension characters
    await worker.setParameters({
      tessedit_char_whitelist: "0123456789'\"ftx .-",
      tessedit_pageseg_mode: Tesseract.PSM.AUTO
    });
    
    // In Tesseract.js v6, blocks output must be explicitly enabled
    const result = await worker.recognize(canvas, {}, { blocks: true });
    await worker.terminate();
    
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
        // In Tesseract.js v6, extract words from blocks structure
        let words = [];
        if (result.data.blocks) {
          for (const block of result.data.blocks) {
            if (block.paragraphs) {
              for (const paragraph of block.paragraphs) {
                if (paragraph.lines) {
                  for (const line of paragraph.lines) {
                    if (line.words) {
                      words.push(...line.words);
                    }
                  }
                }
              }
            }
          }
        }
        for (const word of words) {
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
    
    // Use morphological room detection (primary method)
    let roomOverlay = null;
    if (dimensionBBox) {
      console.log('Finding room box using morphological detection...');
      roomOverlay = await findRoomMorphological(imageDataUrl, dimensionBBox);
    }
    
    // Fallback 1: Try line-based detection
    if (!roomOverlay && dimensionBBox && lineData.horizontal.length > 0 && lineData.vertical.length > 0) {
      console.log('Morphological detection failed, trying line-based detection...');
      roomOverlay = await findRoomByLines(imageDataUrl, dimensionBBox, lineData.horizontal, lineData.vertical);
    }
    
    // Fallback 2: Try legacy line detection
    if (!roomOverlay && dimensionBBox && lineData.horizontal.length > 0 && lineData.vertical.length > 0) {
      console.log('Line-based detection failed, trying legacy method...');
      roomOverlay = findRoomBox(dimensionBBox, lineData.horizontal, lineData.vertical);
    }
    
    // Fallback 3: Create a box around the dimension text
    if (!roomOverlay) {
      console.log('All detection methods failed, using fallback room box');
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
    
    // Run OCR on the image using v6 worker API with optimizations
    console.log('detectAllDimensions: Starting OCR with v6 worker API (optimized)...');
    const worker = await Tesseract.createWorker('eng', 1, {
      logger: (m) => console.log('OCR Progress:', m)
    });
    
    // Set parameters for faster OCR - only recognize numbers and dimension characters
    await worker.setParameters({
      tessedit_char_whitelist: "0123456789'\"ftx .-",
      tessedit_pageseg_mode: Tesseract.PSM.AUTO
    });
    
    // In Tesseract.js v6, blocks output must be explicitly enabled
    const result = await worker.recognize(canvas, {}, { blocks: true });
    await worker.terminate();
    
    console.log('detectAllDimensions: OCR complete');
    console.log('detectAllDimensions: Raw text:', result.data.text);
    console.log('detectAllDimensions: Available keys:', Object.keys(result.data));
    console.log('detectAllDimensions: result.data.blocks type:', typeof result.data.blocks);
    console.log('detectAllDimensions: result.data.blocks value:', result.data.blocks);
    console.log('detectAllDimensions: Blocks is array:', Array.isArray(result.data.blocks));
    if (result.data.blocks) {
      console.log('detectAllDimensions: Blocks length:', result.data.blocks.length);
      console.log('detectAllDimensions: First block:', result.data.blocks[0]);
    } else {
      console.error('detectAllDimensions: BLOCKS IS FALSY!');
    }
    
    // Find all dimension patterns (left-to-right reading order)
    const text = result.data.text;
    const textLines = text.split('\n');
    
    console.log('detectAllDimensions: Total lines:', textLines.length);
    
    const dimensions = [];
    let detectedFormat = null; // Track the first detected format
    
    // Get words array for bounding box lookup
    // In Tesseract.js v6, words are nested: blocks → paragraphs → lines → words
    let words = [];
    if (result.data.blocks) {
      console.log('detectAllDimensions: Extracting words from blocks structure');
      let blockCount = 0, paragraphCount = 0, lineCount = 0;
      for (const block of result.data.blocks) {
        blockCount++;
        if (block.paragraphs) {
          for (const paragraph of block.paragraphs) {
            paragraphCount++;
            if (paragraph.lines) {
              for (const line of paragraph.lines) {
                lineCount++;
                if (line.words) {
                  console.log(`detectAllDimensions: Line ${lineCount} has ${line.words.length} words`);
                  words.push(...line.words);
                }
              }
            }
          }
        }
      }
      console.log(`detectAllDimensions: Traversed ${blockCount} blocks, ${paragraphCount} paragraphs, ${lineCount} lines`);
    } else {
      console.error('detectAllDimensions: result.data.blocks is undefined! Blocks output not enabled.');
    }
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
    
    for (const line of textLines) {
      const trimmedLine = line.trim();
      if (!trimmedLine) continue;
      
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
