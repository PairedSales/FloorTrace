import { dataUrlToImage, imageToCanvas } from './imageLoader';

/**
 * Morphological Perimeter Detector
 * Uses morphological closing to fill gaps and outer contour detection to find the perimeter
 * Designed for floorplans with varying wall thicknesses, window openings, and corner columns
 */

/**
 * Detect the perimeter of a floor plan using morphological closing and outer contour detection
 * @param {string} imageDataUrl - The image data URL
 * @returns {Object} Perimeter overlay with vertices
 */
export const detectPerimeterMorphological = async (imageDataUrl) => {
  try {
    console.log('Starting morphological perimeter detection...');
    const img = await dataUrlToImage(imageDataUrl);
    const canvas = imageToCanvas(img);
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    
    // Step 1: Convert to binary image (black on white background)
    const binaryImage = convertToBinary(ctx, width, height);
    console.log('Binary conversion complete');
    
    // Step 2: Apply morphological closing to fill gaps in walls
    const closedImage = morphologicalClosing(binaryImage, width, height, 15);
    console.log('Morphological closing complete');
    
    // Step 3: Find the outer contour
    const contour = findOuterContour(closedImage, width, height);
    console.log(`Found outer contour with ${contour.length} points`);
    
    if (contour.length < 4) {
      console.log('Contour too small, using fallback');
      return createFallbackPerimeter(width, height);
    }
    
    // Step 4: Extract vertices from the contour (corners only)
    const vertices = extractRectangularVertices(contour);
    console.log(`Extracted ${vertices.length} vertices`);
    
    // Step 5: Simplify and align to axis
    const simplifiedVertices = simplifyRectangularPerimeter(vertices);
    console.log(`Simplified to ${simplifiedVertices.length} vertices`);
    
    return {
      vertices: simplifiedVertices,
      contour: contour // Keep original contour for debugging
    };
  } catch (error) {
    console.error('Error in morphological perimeter detection:', error);
    return null;
  }
};

/**
 * Convert image to binary (1 = black/dark, 0 = white/light)
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
 * Morphological closing operation (dilation followed by erosion)
 * Fills small gaps and holes in the structure
 */
const morphologicalClosing = (binary, width, height, kernelSize = 15) => {
  // First dilate to close gaps
  const dilated = dilate(binary, width, height, kernelSize);
  // Then erode to restore approximate original size
  const closed = erode(dilated, width, height, kernelSize);
  return closed;
};

/**
 * Dilation operation - expands dark regions
 */
const dilate = (binary, width, height, kernelSize) => {
  const result = new Uint8Array(width * height);
  const radius = Math.floor(kernelSize / 2);
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let maxVal = 0;
      
      // Check neighborhood
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const ny = y + dy;
          const nx = x + dx;
          
          if (ny >= 0 && ny < height && nx >= 0 && nx < width) {
            maxVal = Math.max(maxVal, binary[ny * width + nx]);
          }
        }
      }
      
      result[y * width + x] = maxVal;
    }
  }
  
  return result;
};

/**
 * Erosion operation - shrinks dark regions
 */
const erode = (binary, width, height, kernelSize) => {
  const result = new Uint8Array(width * height);
  const radius = Math.floor(kernelSize / 2);
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let minVal = 1;
      
      // Check neighborhood
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const ny = y + dy;
          const nx = x + dx;
          
          if (ny >= 0 && ny < height && nx >= 0 && nx < width) {
            minVal = Math.min(minVal, binary[ny * width + nx]);
          }
        }
      }
      
      result[y * width + x] = minVal;
    }
  }
  
  return result;
};

/**
 * Find the outer contour of the largest connected component
 * Uses Moore-Neighbor tracing algorithm
 */
const findOuterContour = (binary, width, height) => {
  // Find the starting point (topmost-leftmost black pixel)
  let startX = -1, startY = -1;
  
  outerLoop:
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (binary[y * width + x] === 1) {
        startX = x;
        startY = y;
        break outerLoop;
      }
    }
  }
  
  if (startX === -1) {
    console.log('No black pixels found');
    return [];
  }
  
  console.log(`Starting contour trace at (${startX}, ${startY})`);
  
  // Moore-Neighbor directions (8-connected)
  const directions = [
    { dx: 1, dy: 0 },   // 0: East
    { dx: 1, dy: 1 },   // 1: SE
    { dx: 0, dy: 1 },   // 2: South
    { dx: -1, dy: 1 },  // 3: SW
    { dx: -1, dy: 0 },  // 4: West
    { dx: -1, dy: -1 }, // 5: NW
    { dx: 0, dy: -1 },  // 6: North
    { dx: 1, dy: -1 }   // 7: NE
  ];
  
  const contour = [];
  let currentX = startX;
  let currentY = startY;
  let currentDir = 6; // Start looking North
  let iterations = 0;
  const maxIterations = width * height; // Safety limit
  
  do {
    contour.push({ x: currentX, y: currentY });
    
    // Find next contour point
    let found = false;
    for (let i = 0; i < 8; i++) {
      const checkDir = (currentDir + i) % 8;
      const nextX = currentX + directions[checkDir].dx;
      const nextY = currentY + directions[checkDir].dy;
      
      if (nextX >= 0 && nextX < width && nextY >= 0 && nextY < height) {
        if (binary[nextY * width + nextX] === 1) {
          currentX = nextX;
          currentY = nextY;
          currentDir = (checkDir + 6) % 8; // Turn left for next search
          found = true;
          break;
        }
      }
    }
    
    if (!found) {
      console.log('Contour tracing stopped - no next point found');
      break;
    }
    
    iterations++;
    if (iterations >= maxIterations) {
      console.log('Max iterations reached');
      break;
    }
    
  } while (!(currentX === startX && currentY === startY) || contour.length < 4);
  
  console.log(`Contour traced in ${iterations} iterations`);
  return contour;
};

/**
 * Extract vertices from contour by finding corners
 * For rectangular perimeters, we look for direction changes
 */
const extractRectangularVertices = (contour) => {
  if (contour.length < 4) return contour;
  
  const vertices = [];
  const angleThreshold = 20; // Degrees
  const minSegmentLength = 10; // Minimum pixels between vertices
  
  // Calculate direction changes along the contour
  for (let i = 0; i < contour.length; i++) {
    const prev = contour[(i - minSegmentLength + contour.length) % contour.length];
    const curr = contour[i];
    const next = contour[(i + minSegmentLength) % contour.length];
    
    // Calculate angles
    const angle1 = Math.atan2(curr.y - prev.y, curr.x - prev.x);
    const angle2 = Math.atan2(next.y - curr.y, next.x - curr.x);
    
    // Calculate angle difference
    let angleDiff = Math.abs((angle2 - angle1) * 180 / Math.PI);
    if (angleDiff > 180) angleDiff = 360 - angleDiff;
    
    // If significant direction change, mark as vertex
    if (angleDiff > angleThreshold) {
      vertices.push(curr);
    }
  }
  
  // Remove vertices that are too close together
  const filteredVertices = [];
  for (let i = 0; i < vertices.length; i++) {
    const curr = vertices[i];
    const next = vertices[(i + 1) % vertices.length];
    const dist = Math.sqrt((next.x - curr.x) ** 2 + (next.y - curr.y) ** 2);
    
    if (dist > minSegmentLength || i === vertices.length - 1) {
      filteredVertices.push(curr);
    }
  }
  
  return filteredVertices.length > 0 ? filteredVertices : vertices;
};

/**
 * Simplify rectangular perimeter by aligning to horizontal/vertical axes
 * Groups nearby vertices and creates clean rectangular corners
 */
const simplifyRectangularPerimeter = (vertices) => {
  if (vertices.length < 4) return vertices;
  
  // Step 1: Classify each edge as horizontal or vertical
  const edges = [];
  for (let i = 0; i < vertices.length; i++) {
    const v1 = vertices[i];
    const v2 = vertices[(i + 1) % vertices.length];
    
    const dx = Math.abs(v2.x - v1.x);
    const dy = Math.abs(v2.y - v1.y);
    
    // Determine if edge is more horizontal or vertical
    const isHorizontal = dx > dy;
    
    edges.push({
      v1,
      v2,
      isHorizontal,
      length: Math.sqrt(dx * dx + dy * dy)
    });
  }
  
  // Step 2: Align vertices to create clean horizontal/vertical lines
  const alignedVertices = [];
  
  for (let i = 0; i < vertices.length; i++) {
    const prevEdge = edges[(i - 1 + edges.length) % edges.length];
    const nextEdge = edges[i];
    const vertex = vertices[i];
    
    let alignedVertex = { ...vertex };
    
    // If both edges are horizontal, keep X but align Y
    if (prevEdge.isHorizontal && nextEdge.isHorizontal) {
      const avgY = (prevEdge.v1.y + prevEdge.v2.y + nextEdge.v1.y + nextEdge.v2.y) / 4;
      alignedVertex.y = Math.round(avgY);
    }
    // If both edges are vertical, keep Y but align X
    else if (!prevEdge.isHorizontal && !nextEdge.isHorizontal) {
      const avgX = (prevEdge.v1.x + prevEdge.v2.x + nextEdge.v1.x + nextEdge.v2.x) / 4;
      alignedVertex.x = Math.round(avgX);
    }
    // Corner: one horizontal, one vertical
    else {
      alignedVertex.x = Math.round(vertex.x);
      alignedVertex.y = Math.round(vertex.y);
    }
    
    alignedVertices.push(alignedVertex);
  }
  
  // Step 3: Remove duplicate or very close vertices
  const finalVertices = [];
  for (let i = 0; i < alignedVertices.length; i++) {
    const curr = alignedVertices[i];
    const next = alignedVertices[(i + 1) % alignedVertices.length];
    
    const dist = Math.sqrt((next.x - curr.x) ** 2 + (next.y - curr.y) ** 2);
    
    if (dist > 5) { // Minimum distance threshold
      finalVertices.push(curr);
    }
  }
  
  return finalVertices.length >= 4 ? finalVertices : alignedVertices;
};

/**
 * Create a fallback perimeter when detection fails
 */
const createFallbackPerimeter = (width, height) => {
  const margin = 50;
  return {
    vertices: [
      { x: margin, y: margin },
      { x: width - margin, y: margin },
      { x: width - margin, y: height - margin },
      { x: margin, y: height - margin }
    ]
  };
};

/**
 * Debug function to visualize the binary image
 */
export const visualizeBinary = (binary, width, height) => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const imageData = ctx.createImageData(width, height);
  
  for (let i = 0; i < binary.length; i++) {
    const val = binary[i] * 255;
    imageData.data[i * 4] = val;
    imageData.data[i * 4 + 1] = val;
    imageData.data[i * 4 + 2] = val;
    imageData.data[i * 4 + 3] = 255;
  }
  
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL();
};
