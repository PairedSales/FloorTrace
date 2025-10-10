import { dataUrlToImage, imageToCanvas } from './imageLoader';

/**
 * Morphological Room Detector
 * Finds rectangular rooms around OCR-detected dimension text using:
 * 1. Binary image conversion
 * 2. Flood-fill from dimension center to find enclosed space
 * 3. Rectangular bounding box extraction with wall alignment
 */

/**
 * Find the rectangular room containing the given dimension text
 * @param {string} imageDataUrl - The image data URL
 * @param {Object} dimensionBBox - Bounding box of dimension text {x, y, width, height}
 * @returns {Object} Room overlay {x1, y1, x2, y2} or null
 */
export const findRoomMorphological = async (imageDataUrl, dimensionBBox) => {
  try {
    console.log('Starting morphological room detection...');
    const img = await dataUrlToImage(imageDataUrl);
    const canvas = imageToCanvas(img);
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    
    // Step 1: Convert to binary image (1 = wall/black, 0 = space/white)
    const binaryImage = convertToBinary(ctx, width, height);
    console.log('Binary conversion complete');
    
    // Step 2: Invert the image (1 = space, 0 = wall) for flood-fill
    const invertedImage = invertBinary(binaryImage, width, height);
    
    // Step 3: Find the center of the dimension text
    const seedX = Math.floor(dimensionBBox.x + dimensionBBox.width / 2);
    const seedY = Math.floor(dimensionBBox.y + dimensionBBox.height / 2);
    console.log(`Seed point: (${seedX}, ${seedY})`);
    
    // Step 4: Flood-fill from the seed point to find the room
    const roomMask = floodFill(invertedImage, width, height, seedX, seedY);
    console.log('Flood-fill complete');
    
    // Step 5: Find the bounding box of the filled region
    const boundingBox = findBoundingBox(roomMask, width, height);
    
    if (!boundingBox) {
      console.log('No room found around dimension text');
      return null;
    }
    
    console.log(`Room bounding box: (${boundingBox.x1}, ${boundingBox.y1}) to (${boundingBox.x2}, ${boundingBox.y2})`);
    
    // Step 6: Refine the bounding box to align with walls
    const refinedBox = refineRoomBox(binaryImage, width, height, boundingBox);
    console.log(`Refined room box: (${refinedBox.x1}, ${refinedBox.y1}) to (${refinedBox.x2}, ${refinedBox.y2})`);
    
    return refinedBox;
  } catch (error) {
    console.error('Error in morphological room detection:', error);
    return null;
  }
};

/**
 * Convert image to binary (1 = black/dark/wall, 0 = white/light/space)
 */
const convertToBinary = (ctx, width, height) => {
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  const binary = new Uint8Array(width * height);
  const threshold = 128;
  
  for (let i = 0; i < data.length; i += 4) {
    const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3;
    binary[i / 4] = brightness < threshold ? 1 : 0;
  }
  
  return binary;
};

/**
 * Invert binary image (0 becomes 1, 1 becomes 0)
 */
const invertBinary = (binary, width, height) => {
  const inverted = new Uint8Array(width * height);
  for (let i = 0; i < binary.length; i++) {
    inverted[i] = binary[i] === 0 ? 1 : 0;
  }
  return inverted;
};

/**
 * Flood-fill algorithm to find connected white space
 * Returns a mask where 1 = part of the room, 0 = not part of room
 */
const floodFill = (image, width, height, seedX, seedY) => {
  const mask = new Uint8Array(width * height);
  
  // Check if seed point is valid (should be in white space)
  if (seedX < 0 || seedX >= width || seedY < 0 || seedY >= height) {
    console.log('Seed point out of bounds');
    return mask;
  }
  
  if (image[seedY * width + seedX] === 0) {
    console.log('Seed point is on a wall (black pixel)');
    return mask;
  }
  
  // Use a queue-based flood-fill (BFS)
  const queue = [{ x: seedX, y: seedY }];
  const visited = new Set();
  visited.add(`${seedX},${seedY}`);
  
  let pixelsFilled = 0;
  const maxPixels = width * height / 4; // Safety limit: max 25% of image
  
  while (queue.length > 0 && pixelsFilled < maxPixels) {
    const { x, y } = queue.shift();
    const idx = y * width + x;
    
    mask[idx] = 1;
    pixelsFilled++;
    
    // Check 4-connected neighbors
    const neighbors = [
      { x: x + 1, y: y },
      { x: x - 1, y: y },
      { x: x, y: y + 1 },
      { x: x, y: y - 1 }
    ];
    
    for (const neighbor of neighbors) {
      const nx = neighbor.x;
      const ny = neighbor.y;
      const key = `${nx},${ny}`;
      
      if (nx >= 0 && nx < width && ny >= 0 && ny < height && !visited.has(key)) {
        visited.add(key);
        
        const nIdx = ny * width + nx;
        if (image[nIdx] === 1) { // White space
          queue.push({ x: nx, y: ny });
        }
      }
    }
  }
  
  console.log(`Flood-fill filled ${pixelsFilled} pixels`);
  return mask;
};

/**
 * Find the bounding box of the filled region
 */
const findBoundingBox = (mask, width, height) => {
  let minX = width, maxX = 0;
  let minY = height, maxY = 0;
  let hasPixels = false;
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x] === 1) {
        hasPixels = true;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  }
  
  if (!hasPixels) {
    return null;
  }
  
  return {
    x1: minX,
    y1: minY,
    x2: maxX,
    y2: maxY
  };
};

/**
 * Refine the room box to align with wall edges
 * Scans outward from the bounding box to find the inner edge of walls
 */
const refineRoomBox = (binaryImage, width, height, boundingBox) => {
  const { x1, y1, x2, y2 } = boundingBox;
  
  // Find the inner edge of walls on each side
  const refinedBox = { ...boundingBox };
  
  // Scan left: find the rightmost black pixel (wall) to the left of x1
  let leftWall = x1;
  for (let x = x1; x >= 0; x--) {
    let hasWall = false;
    for (let y = y1; y <= y2; y++) {
      if (binaryImage[y * width + x] === 1) {
        hasWall = true;
        break;
      }
    }
    if (hasWall) {
      leftWall = x;
      break;
    }
  }
  
  // Scan right: find the leftmost black pixel (wall) to the right of x2
  let rightWall = x2;
  for (let x = x2; x < width; x++) {
    let hasWall = false;
    for (let y = y1; y <= y2; y++) {
      if (binaryImage[y * width + x] === 1) {
        hasWall = true;
        break;
      }
    }
    if (hasWall) {
      rightWall = x;
      break;
    }
  }
  
  // Scan top: find the bottommost black pixel (wall) above y1
  let topWall = y1;
  for (let y = y1; y >= 0; y--) {
    let hasWall = false;
    for (let x = x1; x <= x2; x++) {
      if (binaryImage[y * width + x] === 1) {
        hasWall = true;
        break;
      }
    }
    if (hasWall) {
      topWall = y;
      break;
    }
  }
  
  // Scan bottom: find the topmost black pixel (wall) below y2
  let bottomWall = y2;
  for (let y = y2; y < height; y++) {
    let hasWall = false;
    for (let x = x1; x <= x2; x++) {
      if (binaryImage[y * width + x] === 1) {
        hasWall = true;
        break;
      }
    }
    if (hasWall) {
      bottomWall = y;
      break;
    }
  }
  
  // Set the refined box to the inner edge of walls
  refinedBox.x1 = leftWall;
  refinedBox.y1 = topWall;
  refinedBox.x2 = rightWall;
  refinedBox.y2 = bottomWall;
  
  return refinedBox;
};

/**
 * Alternative approach: Use line detection to find room boundaries
 * This is a more sophisticated approach that finds actual wall lines
 */
export const findRoomByLines = async (imageDataUrl, dimensionBBox, horizontalLines, verticalLines) => {
  try {
    console.log('Finding room using line detection...');
    
    const centerX = dimensionBBox.x + dimensionBBox.width / 2;
    const centerY = dimensionBBox.y + dimensionBBox.height / 2;
    
    // Find lines that could form a room around the dimension text
    // Look for lines that enclose the dimension text
    
    // Find horizontal lines above and below
    const linesAbove = horizontalLines.filter(l => {
      const lineY = l.position + l.thickness / 2;
      return lineY < centerY && 
             l.start <= centerX && 
             l.end >= centerX;
    });
    
    const linesBelow = horizontalLines.filter(l => {
      const lineY = l.position + l.thickness / 2;
      return lineY > centerY && 
             l.start <= centerX && 
             l.end >= centerX;
    });
    
    // Find vertical lines left and right
    const linesLeft = verticalLines.filter(l => {
      const lineX = l.position + l.thickness / 2;
      return lineX < centerX && 
             l.start <= centerY && 
             l.end >= centerY;
    });
    
    const linesRight = verticalLines.filter(l => {
      const lineX = l.position + l.thickness / 2;
      return lineX > centerX && 
             l.start <= centerY && 
             l.end >= centerY;
    });
    
    // Get the closest line on each side
    const topLine = linesAbove.length > 0
      ? linesAbove.reduce((closest, line) => {
          const closestY = closest.position + closest.thickness / 2;
          const lineY = line.position + line.thickness / 2;
          return Math.abs(lineY - centerY) < Math.abs(closestY - centerY) ? line : closest;
        })
      : null;
    
    const bottomLine = linesBelow.length > 0
      ? linesBelow.reduce((closest, line) => {
          const closestY = closest.position + closest.thickness / 2;
          const lineY = line.position + line.thickness / 2;
          return Math.abs(lineY - centerY) < Math.abs(closestY - centerY) ? line : closest;
        })
      : null;
    
    const leftLine = linesLeft.length > 0
      ? linesLeft.reduce((closest, line) => {
          const closestX = closest.position + closest.thickness / 2;
          const lineX = line.position + line.thickness / 2;
          return Math.abs(lineX - centerX) < Math.abs(closestX - centerX) ? line : closest;
        })
      : null;
    
    const rightLine = linesRight.length > 0
      ? linesRight.reduce((closest, line) => {
          const closestX = closest.position + closest.thickness / 2;
          const lineX = line.position + line.thickness / 2;
          return Math.abs(lineX - centerX) < Math.abs(closestX - centerX) ? line : closest;
        })
      : null;
    
    // Create room box using the inner edges of walls
    if (topLine && bottomLine && leftLine && rightLine) {
      console.log('Found room using all four walls');
      return {
        x1: leftLine.position + leftLine.thickness,
        y1: topLine.position + topLine.thickness,
        x2: rightLine.position,
        y2: bottomLine.position
      };
    }
    
    console.log('Could not find complete room boundaries with lines');
    return null;
  } catch (error) {
    console.error('Error in line-based room detection:', error);
    return null;
  }
};

/**
 * Debug function to visualize the flood-fill mask
 */
export const visualizeRoomMask = (mask, width, height) => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const imageData = ctx.createImageData(width, height);
  
  for (let i = 0; i < mask.length; i++) {
    const val = mask[i] * 255;
    imageData.data[i * 4] = 0;
    imageData.data[i * 4 + 1] = val;
    imageData.data[i * 4 + 2] = 0;
    imageData.data[i * 4 + 3] = 255;
  }
  
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL();
};
