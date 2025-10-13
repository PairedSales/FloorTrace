import { dataUrlToImage, imageToCanvas } from './imageLoader';
import { preprocessImage, otsuThreshold } from './imagePreprocessor';
import { segmentWalls, generateAttractionField } from './wallSegmentation';
import { detectLineSegments, mergeCollinearSegments } from './lineRefinement';
import { extractCenterlineFromDistance } from './wallCenterline';
import { fillGapsInSegments, morphologicalGapBridging } from './gapFilling';
import { postProcessSegments } from './wallPostProcessing';

/**
 * Hybrid Deep Learning + Classical Wall Detection System
 * 
 * This system detects walls in floor plan images using a hybrid approach:
 * 1. Preprocessing: Adaptive thresholding, morphological operations, noise removal
 * 2. CNN-based segmentation: Generate wall likelihood maps (with classical fallback)
 * 3. Classical line detection: Extract line segments from likelihood maps
 * 4. Wall centerline extraction: Handle thick walls and double lines
 * 5. Gap filling: Bridge gaps from doors/windows using morphological closing
 * 6. Post-processing: Orientation constraints, filtering, snapping, quantization
 * 7. Classification: Separate exterior from interior walls
 * 8. Perimeter building: Connect exterior walls to form complete perimeter
 */

/**
 * Represents a detected wall segment
 */
export class WallSegment {
  constructor(pixels, boundingBox, isHorizontal) {
    this.pixels = pixels; // Array of {x, y} coordinates
    this.boundingBox = boundingBox; // {x1, y1, x2, y2}
    this.isHorizontal = isHorizontal;
    this.length = isHorizontal 
      ? boundingBox.x2 - boundingBox.x1 
      : boundingBox.y2 - boundingBox.y1;
    this.thickness = isHorizontal
      ? boundingBox.y2 - boundingBox.y1
      : boundingBox.x2 - boundingBox.x1;
  }

  get centerX() {
    return (this.boundingBox.x1 + this.boundingBox.x2) / 2;
  }

  get centerY() {
    return (this.boundingBox.y1 + this.boundingBox.y2) / 2;
  }

  // Get the line representation (position and extent)
  getLine() {
    if (this.isHorizontal) {
      return {
        y: this.centerY,
        x1: this.boundingBox.x1,
        x2: this.boundingBox.x2,
        thickness: this.thickness
      };
    } else {
      return {
        x: this.centerX,
        y1: this.boundingBox.y1,
        y2: this.boundingBox.y2,
        thickness: this.thickness
      };
    }
  }
}

/**
 * Main wall detection function using hybrid approach
 * @param {string|HTMLImageElement} imageSource - Image data URL or image element
 * @param {Object} options - Detection options
 * @returns {Object} Detected walls and metadata
 */
export const detectWalls = async (imageSource, options = {}) => {
  const {
    minWallLength = 50,
    useCNN = false,              // Use CNN-based segmentation (experimental)
    cnnModelPath = null,         // Path to pre-trained model
    thresholdMethod = 'adaptive', // 'global', 'adaptive', or 'otsu'
    orientationConstraints = true, // Only horizontal/vertical walls
    fillGaps = true,             // Bridge gaps from doors/windows
    maxGapLength = 100,
    debugMode = false
  } = options;

  try {
    console.log('=== Hybrid Wall Detection Started ===');
    const startTime = performance.now();
    
    // Load and prepare image
    const img = typeof imageSource === 'string' 
      ? await dataUrlToImage(imageSource) 
      : imageSource;
    const canvas = imageToCanvas(img);
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    const imageData = ctx.getImageData(0, 0, width, height);

    console.log(`Image size: ${width}x${height}px`);

    // STEP 1: Preprocessing
    console.log('\n--- Step 1: Preprocessing ---');
    const preprocessed = preprocessImage(imageData, {
      thresholdMethod,
      removeNoise: true,
      minComponentSize: 30,
      useClosing: true,
      closingKernelSize: 5
    });

    // STEP 2: CNN-based segmentation (or classical fallback)
    console.log('\n--- Step 2: Wall Segmentation ---');
    const likelihood = await segmentWalls(
      preprocessed.grayscale,
      width,
      height,
      {
        useModel: useCNN,
        modelPath: cnnModelPath,
        useFallback: true
      }
    );

    // STEP 3: Line detection and refinement
    console.log('\n--- Step 3: Line Detection ---');
    let segments = detectLineSegments(likelihood, width, height, {
      minLength: minWallLength,
      minScore: 0.2,
      maxGap: 10,
      orientationConstraint: orientationConstraints,
      angleTolerance: Math.PI / 12
    });

    // STEP 4: Merge collinear segments
    console.log('\n--- Step 4: Merging Collinear Segments ---');
    segments = mergeCollinearSegments(segments, {
      maxDistance: 15,
      maxGap: 30,
      angleTolerance: 0.15
    });

    // STEP 5: Gap filling
    if (fillGaps) {
      console.log('\n--- Step 5: Gap Filling ---');
      segments = fillGapsInSegments(segments, {
        maxGapLength,
        alignmentTolerance: 10,
        angleTolerance: 0.1
      });
    }

    // STEP 6: Post-processing and filtering
    console.log('\n--- Step 6: Post-Processing ---');
    const processed = postProcessSegments(segments, width, height, {
      minLength: minWallLength,
      enforceOrientation: orientationConstraints,
      allowedOrientations: ['horizontal', 'vertical'],
      angleTolerance: Math.PI / 12,
      removeIsolated: true,
      connectionThreshold: 25,
      snapGrid: true,
      gridSize: 5,
      snapOrientation: true,
      removeDups: true,
      duplicateThreshold: 10,
      applyConstraints: false, // Disabled to avoid over-filtering
      classifyExterior: true
    });

    // STEP 7: Convert line segments back to WallSegment format for compatibility
    console.log('\n--- Step 7: Format Conversion ---');
    const allWalls = convertLineSegmentsToWallSegments(processed.all);
    const horizontal = convertLineSegmentsToWallSegments(processed.horizontal);
    const vertical = convertLineSegmentsToWallSegments(processed.vertical);
    const exterior = convertLineSegmentsToWallSegments(processed.exterior);
    const interior = convertLineSegmentsToWallSegments(processed.interior);

    // STEP 8: Build perimeter from exterior walls
    console.log('\n--- Step 8: Building Perimeter ---');
    const perimeter = buildPerimeter(exterior, width, height);
    console.log(`Built perimeter with ${perimeter ? perimeter.vertices.length : 0} vertices`);

    const detectionTime = performance.now() - startTime;
    console.log(`\n=== Detection Complete (${detectionTime.toFixed(2)}ms) ===`);
    console.log(`Total walls: ${allWalls.length}`);
    console.log(`Horizontal: ${horizontal.length}, Vertical: ${vertical.length}`);
    console.log(`Exterior: ${exterior.length}, Interior: ${interior.length}`);

    const result = {
      allWalls,
      horizontal,
      vertical,
      exterior,
      interior,
      perimeter,
      imageSize: { width, height },
      detectionTime: `${detectionTime.toFixed(2)}ms`
    };

    if (debugMode) {
      result.debug = {
        preprocessed,
        likelihood,
        lineSegments: processed.all,
        visualizations: createDebugVisualizations(result, width, height)
      };
    }

    return result;
  } catch (error) {
    console.error('Error in wall detection:', error);
    throw error;
  }
};

/**
 * Convert LineSegment objects to WallSegment format for backward compatibility
 * @param {Array<LineSegment>} lineSegments - Array of LineSegment objects
 * @returns {Array<WallSegment>} Array of WallSegment objects
 */
const convertLineSegmentsToWallSegments = (lineSegments) => {
  return lineSegments.map(lineSeg => {
    // Create bounding box from line segment
    const boundingBox = {
      x1: Math.min(lineSeg.x1, lineSeg.x2),
      y1: Math.min(lineSeg.y1, lineSeg.y2),
      x2: Math.max(lineSeg.x1, lineSeg.x2),
      y2: Math.max(lineSeg.y1, lineSeg.y2)
    };
    
    // Determine if horizontal or vertical
    const isHorizontal = lineSeg.isHorizontal();
    
    // Generate pixel array (sample points along the line)
    const pixels = [];
    const numSamples = Math.ceil(lineSeg.length);
    for (let i = 0; i <= numSamples; i++) {
      const t = i / numSamples;
      const x = Math.round(lineSeg.x1 + t * (lineSeg.x2 - lineSeg.x1));
      const y = Math.round(lineSeg.y1 + t * (lineSeg.y2 - lineSeg.y1));
      pixels.push({ x, y });
    }
    
    return new WallSegment(pixels, boundingBox, isHorizontal);
  });
};

/**
 * Convert image to binary (1 = dark/wall, 0 = light/background)
 * @deprecated - Use preprocessImage from imagePreprocessor instead
 */
const convertToBinary = (ctx, width, height, threshold) => {
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  const binary = new Uint8Array(width * height);

  for (let i = 0; i < data.length; i += 4) {
    const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3;
    binary[i / 4] = brightness < threshold ? 1 : 0;
  }

  return binary;
};

/**
 * Find all connected components using flood-fill
 * Returns array of components, each containing pixels and bounding box
 */
const findConnectedComponents = (binary, width, height) => {
  const visited = new Uint8Array(width * height);
  const components = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      
      if (binary[idx] === 1 && visited[idx] === 0) {
        // Found unvisited dark pixel - start new component
        const component = floodFillComponent(binary, visited, width, height, x, y);
        if (component.pixels.length > 0) {
          components.push(component);
        }
      }
    }
  }

  return components;
};

/**
 * Flood-fill to find a single connected component
 */
const floodFillComponent = (binary, visited, width, height, startX, startY) => {
  const pixels = [];
  let minX = width, maxX = 0, minY = height, maxY = 0;
  
  const queue = [{ x: startX, y: startY }];
  const startIdx = startY * width + startX;
  visited[startIdx] = 1;

  while (queue.length > 0) {
    const { x, y } = queue.shift();
    pixels.push({ x, y });

    // Update bounding box
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);

    // Check 4-connected neighbors
    const neighbors = [
      { x: x + 1, y },
      { x: x - 1, y },
      { x, y: y + 1 },
      { x, y: y - 1 }
    ];

    for (const neighbor of neighbors) {
      const nx = neighbor.x;
      const ny = neighbor.y;

      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        const nIdx = ny * width + nx;
        if (binary[nIdx] === 1 && visited[nIdx] === 0) {
          visited[nIdx] = 1;
          queue.push({ x: nx, y: ny });
        }
      }
    }
  }

  return {
    pixels,
    boundingBox: { x1: minX, y1: minY, x2: maxX, y2: maxY }
  };
};

/**
 * Filter components to identify walls (long segments vs text/symbols)
 * Walls are elongated rectangles with high aspect ratio
 */
const filterWalls = (components, minWallLength) => {
  const walls = [];

  for (const component of components) {
    const { boundingBox } = component;
    const width = boundingBox.x2 - boundingBox.x1;
    const height = boundingBox.y2 - boundingBox.y1;
    const maxDimension = Math.max(width, height);
    const minDimension = Math.min(width, height);

    // Calculate aspect ratio to identify elongated shapes
    const aspectRatio = maxDimension / Math.max(minDimension, 1);

    // A wall must be:
    // 1. Long enough (maxDimension >= minWallLength)
    // 2. Elongated (aspect ratio >= 3, meaning length is at least 3x the thickness)
    // This filters out square text blobs while keeping thick walls
    if (maxDimension >= minWallLength && aspectRatio >= 3) {
      // Determine if horizontal or vertical based on aspect ratio
      const isHorizontal = width > height;
      walls.push(new WallSegment(component.pixels, boundingBox, isHorizontal));
    }
  }

  return walls;
};

/**
 * Classify walls as horizontal or vertical
 */
const classifyWalls = (wallSegments) => {
  const horizontal = [];
  const vertical = [];

  for (const wall of wallSegments) {
    if (wall.isHorizontal) {
      horizontal.push(wall);
    } else {
      vertical.push(wall);
    }
  }

  // Sort for easier processing
  horizontal.sort((a, b) => a.centerY - b.centerY);
  vertical.sort((a, b) => a.centerX - b.centerX);

  return { horizontal, vertical };
};

/**
 * Merge aligned wall segments that are separated by gaps (windows/doors)
 * This connects wall segments that are on the same line but broken up
 */
const mergeAlignedWalls = (horizontal, vertical) => {
  const mergedHorizontal = mergeAlignedHorizontalWalls(horizontal);
  const mergedVertical = mergeAlignedVerticalWalls(vertical);
  return { horizontal: mergedHorizontal, vertical: mergedVertical };
};

/**
 * Merge horizontal walls that are aligned (same Y coordinate) and close together
 */
const mergeAlignedHorizontalWalls = (walls) => {
  if (walls.length === 0) return [];
  
  const alignmentTolerance = 10; // pixels - how much Y variation is allowed
  const maxGap = 150; // pixels - maximum gap between wall segments to merge
  
  const merged = [];
  const groups = [];
  
  // Group walls by similar centerY
  for (const wall of walls) {
    let foundGroup = false;
    
    for (const group of groups) {
      const avgY = group.reduce((sum, w) => sum + w.centerY, 0) / group.length;
      if (Math.abs(wall.centerY - avgY) <= alignmentTolerance) {
        group.push(wall);
        foundGroup = true;
        break;
      }
    }
    
    if (!foundGroup) {
      groups.push([wall]);
    }
  }
  
  // For each group, check if walls are close enough to merge
  for (const group of groups) {
    // Sort by x position
    group.sort((a, b) => a.boundingBox.x1 - b.boundingBox.x1);
    
    let currentMerge = [group[0]];
    
    for (let i = 1; i < group.length; i++) {
      const prevWall = currentMerge[currentMerge.length - 1];
      const currWall = group[i];
      
      const gap = currWall.boundingBox.x1 - prevWall.boundingBox.x2;
      
      if (gap <= maxGap) {
        // Close enough to merge
        currentMerge.push(currWall);
      } else {
        // Gap too large, create merged wall from current group and start new one
        if (currentMerge.length > 1) {
          merged.push(createMergedWall(currentMerge, true));
        } else {
          merged.push(currentMerge[0]);
        }
        currentMerge = [currWall];
      }
    }
    
    // Add the last merge
    if (currentMerge.length > 1) {
      merged.push(createMergedWall(currentMerge, true));
    } else {
      merged.push(currentMerge[0]);
    }
  }
  
  return merged;
};

/**
 * Merge vertical walls that are aligned (same X coordinate) and close together
 */
const mergeAlignedVerticalWalls = (walls) => {
  if (walls.length === 0) return [];
  
  const alignmentTolerance = 10; // pixels - how much X variation is allowed
  const maxGap = 150; // pixels - maximum gap between wall segments to merge
  
  const merged = [];
  const groups = [];
  
  // Group walls by similar centerX
  for (const wall of walls) {
    let foundGroup = false;
    
    for (const group of groups) {
      const avgX = group.reduce((sum, w) => sum + w.centerX, 0) / group.length;
      if (Math.abs(wall.centerX - avgX) <= alignmentTolerance) {
        group.push(wall);
        foundGroup = true;
        break;
      }
    }
    
    if (!foundGroup) {
      groups.push([wall]);
    }
  }
  
  // For each group, check if walls are close enough to merge
  for (const group of groups) {
    // Sort by y position
    group.sort((a, b) => a.boundingBox.y1 - b.boundingBox.y1);
    
    let currentMerge = [group[0]];
    
    for (let i = 1; i < group.length; i++) {
      const prevWall = currentMerge[currentMerge.length - 1];
      const currWall = group[i];
      
      const gap = currWall.boundingBox.y1 - prevWall.boundingBox.y2;
      
      if (gap <= maxGap) {
        // Close enough to merge
        currentMerge.push(currWall);
      } else {
        // Gap too large, create merged wall from current group and start new one
        if (currentMerge.length > 1) {
          merged.push(createMergedWall(currentMerge, false));
        } else {
          merged.push(currentMerge[0]);
        }
        currentMerge = [currWall];
      }
    }
    
    // Add the last merge
    if (currentMerge.length > 1) {
      merged.push(createMergedWall(currentMerge, false));
    } else {
      merged.push(currentMerge[0]);
    }
  }
  
  return merged;
};

/**
 * Create a single merged wall from multiple wall segments
 */
const createMergedWall = (walls, isHorizontal) => {
  // Combine all pixels from all walls
  const allPixels = walls.flatMap(w => w.pixels);
  
  // Create combined bounding box
  const boundingBox = {
    x1: Math.min(...walls.map(w => w.boundingBox.x1)),
    y1: Math.min(...walls.map(w => w.boundingBox.y1)),
    x2: Math.max(...walls.map(w => w.boundingBox.x2)),
    y2: Math.max(...walls.map(w => w.boundingBox.y2))
  };
  
  return new WallSegment(allPixels, boundingBox, isHorizontal);
};

/**
 * Separate exterior walls from interior walls
 * Exterior walls are those near the image edges
 */
const separateExteriorInterior = (horizontal, vertical, imageWidth, imageHeight) => {
  const edgeThreshold = Math.min(imageWidth, imageHeight) * 0.15; // 15% from edge
  
  const exterior = [];
  const interior = [];

  // Check horizontal walls
  for (const wall of horizontal) {
    const distFromTop = wall.centerY;
    const distFromBottom = imageHeight - wall.centerY;
    const minDist = Math.min(distFromTop, distFromBottom);

    if (minDist < edgeThreshold) {
      exterior.push(wall);
    } else {
      interior.push(wall);
    }
  }

  // Check vertical walls
  for (const wall of vertical) {
    const distFromLeft = wall.centerX;
    const distFromRight = imageWidth - wall.centerX;
    const minDist = Math.min(distFromLeft, distFromRight);

    if (minDist < edgeThreshold) {
      exterior.push(wall);
    } else {
      interior.push(wall);
    }
  }

  return { exterior, interior };
};

/**
 * Build perimeter polygon from exterior walls
 * Fills gaps by "connecting the dots"
 */
const buildPerimeter = (exteriorWalls, imageWidth, imageHeight) => {
  if (exteriorWalls.length === 0) {
    return null;
  }

  // Separate exterior walls by orientation
  const hWalls = exteriorWalls.filter(w => w.isHorizontal);
  const vWalls = exteriorWalls.filter(w => !w.isHorizontal);

  if (hWalls.length === 0 || vWalls.length === 0) {
    return null;
  }

  // Find the outermost walls on each side
  const topWalls = hWalls.filter(w => w.centerY < imageHeight / 2);
  const bottomWalls = hWalls.filter(w => w.centerY >= imageHeight / 2);
  const leftWalls = vWalls.filter(w => w.centerX < imageWidth / 2);
  const rightWalls = vWalls.filter(w => w.centerX >= imageWidth / 2);

  // Get the extreme wall on each side
  const topWall = topWalls.length > 0 
    ? topWalls.reduce((min, w) => w.centerY < min.centerY ? w : min)
    : null;
  const bottomWall = bottomWalls.length > 0
    ? bottomWalls.reduce((max, w) => w.centerY > max.centerY ? w : max)
    : null;
  const leftWall = leftWalls.length > 0
    ? leftWalls.reduce((min, w) => w.centerX < min.centerX ? w : min)
    : null;
  const rightWall = rightWalls.length > 0
    ? rightWalls.reduce((max, w) => w.centerX > max.centerX ? w : max)
    : null;

  if (!topWall || !bottomWall || !leftWall || !rightWall) {
    return null;
  }

  // Build vertices by tracing the perimeter
  const vertices = buildPerimeterVertices(
    topWall, bottomWall, leftWall, rightWall,
    hWalls, vWalls
  );

  return {
    vertices,
    walls: { top: topWall, bottom: bottomWall, left: leftWall, right: rightWall }
  };
};

/**
 * Build perimeter vertices by connecting wall segments
 * This handles complex perimeters with multiple wall segments
 */
const buildPerimeterVertices = (topWall, bottomWall, leftWall, rightWall, hWalls, vWalls) => {
  const vertices = [];

  // We'll trace the perimeter clockwise starting from top-left
  // Strategy: Follow the outermost walls, connecting gaps as needed

  // Get all top-side horizontal walls (sorted left to right)
  const topSideWalls = hWalls
    .filter(w => w.centerY < (topWall.centerY + bottomWall.centerY) / 2)
    .sort((a, b) => a.boundingBox.x1 - b.boundingBox.x1);

  // Get all right-side vertical walls (sorted top to bottom)
  const rightSideWalls = vWalls
    .filter(w => w.centerX > (leftWall.centerX + rightWall.centerX) / 2)
    .sort((a, b) => a.boundingBox.y1 - b.boundingBox.y1);

  // Get all bottom-side horizontal walls (sorted right to left)
  const bottomSideWalls = hWalls
    .filter(w => w.centerY > (topWall.centerY + bottomWall.centerY) / 2)
    .sort((a, b) => b.boundingBox.x2 - a.boundingBox.x2);

  // Get all left-side vertical walls (sorted bottom to top)
  const leftSideWalls = vWalls
    .filter(w => w.centerX < (leftWall.centerX + rightWall.centerX) / 2)
    .sort((a, b) => b.boundingBox.y2 - a.boundingBox.y2);

  // Use INNER edges of walls for interior perimeter
  // Top wall: use bottom edge (y2)
  const topY = topWall.boundingBox.y2;
  if (topSideWalls.length > 0) {
    for (const wall of topSideWalls) {
      vertices.push({ x: wall.boundingBox.x1, y: topY });
      vertices.push({ x: wall.boundingBox.x2, y: topY });
    }
  }

  // Top-right corner
  // Right wall: use left edge (x1)
  const rightX = rightWall.boundingBox.x1;
  vertices.push({ x: rightX, y: topY });

  // Trace right edge (top to bottom)
  if (rightSideWalls.length > 0) {
    for (const wall of rightSideWalls) {
      vertices.push({ x: rightX, y: wall.boundingBox.y1 });
      vertices.push({ x: rightX, y: wall.boundingBox.y2 });
    }
  }

  // Bottom-right corner
  // Bottom wall: use top edge (y1)
  const bottomY = bottomWall.boundingBox.y1;
  vertices.push({ x: rightX, y: bottomY });

  // Trace bottom edge (right to left)
  if (bottomSideWalls.length > 0) {
    for (const wall of bottomSideWalls) {
      vertices.push({ x: wall.boundingBox.x2, y: bottomY });
      vertices.push({ x: wall.boundingBox.x1, y: bottomY });
    }
  }

  // Bottom-left corner
  // Left wall: use right edge (x2)
  const leftX = leftWall.boundingBox.x2;
  vertices.push({ x: leftX, y: bottomY });

  // Trace left edge (bottom to top)
  if (leftSideWalls.length > 0) {
    for (const wall of leftSideWalls) {
      vertices.push({ x: leftX, y: wall.boundingBox.y2 });
      vertices.push({ x: leftX, y: wall.boundingBox.y1 });
    }
  }

  // Back to top-left corner
  vertices.push({ x: leftX, y: topY });

  // Simplify vertices (remove duplicates and collinear points)
  return simplifyVertices(vertices);
};

/**
 * Simplify vertices by removing duplicates and collinear points
 */
const simplifyVertices = (vertices) => {
  if (vertices.length < 3) return vertices;

  const simplified = [];
  const tolerance = 5; // pixels

  for (let i = 0; i < vertices.length; i++) {
    const curr = vertices[i];
    const next = vertices[(i + 1) % vertices.length];

    // Skip if too close to next vertex
    const dist = Math.sqrt((next.x - curr.x) ** 2 + (next.y - curr.y) ** 2);
    if (dist < tolerance && i < vertices.length - 1) {
      continue;
    }

    simplified.push(curr);
  }

  // Remove collinear points
  const final = [];
  for (let i = 0; i < simplified.length; i++) {
    const prev = simplified[(i - 1 + simplified.length) % simplified.length];
    const curr = simplified[i];
    const next = simplified[(i + 1) % simplified.length];

    // Check if curr is collinear with prev and next
    const dx1 = curr.x - prev.x;
    const dy1 = curr.y - prev.y;
    const dx2 = next.x - curr.x;
    const dy2 = next.y - curr.y;

    // Cross product to check collinearity
    const cross = dx1 * dy2 - dy1 * dx2;

    if (Math.abs(cross) > tolerance) {
      final.push(curr);
    }
  }

  return final.length >= 3 ? final : simplified;
};

/**
 * Find room boundaries using interior walls
 * Strategy: Find the LARGEST rectangular room that encloses the OCR text
 * This avoids selecting closet walls or other interior features
 * @param {Object} wallData - Result from detectWalls
 * @param {Object} dimensionBBox - Bounding box of room dimension text
 * @returns {Object} Room box {x1, y1, x2, y2}
 */
export const findRoomFromWalls = (wallData, dimensionBBox) => {
  const { horizontal, vertical } = wallData;
  const centerX = dimensionBBox.x + dimensionBBox.width / 2;
  const centerY = dimensionBBox.y + dimensionBBox.height / 2;

  console.log('findRoomFromWalls: Finding room for OCR at', { centerX, centerY });
  console.log('findRoomFromWalls: Available walls:', { 
    horizontal: horizontal.length, 
    vertical: vertical.length 
  });

  // Find walls that could enclose the dimension text
  const wallsAbove = horizontal.filter(w => w.centerY < centerY);
  const wallsBelow = horizontal.filter(w => w.centerY > centerY);
  const wallsLeft = vertical.filter(w => w.centerX < centerX);
  const wallsRight = vertical.filter(w => w.centerX > centerX);

  console.log('findRoomFromWalls: Candidate walls:', {
    above: wallsAbove.length,
    below: wallsBelow.length,
    left: wallsLeft.length,
    right: wallsRight.length
  });

  if (wallsAbove.length === 0 || wallsBelow.length === 0 || 
      wallsLeft.length === 0 || wallsRight.length === 0) {
    console.log('findRoomFromWalls: Not enough walls on all sides');
    return null;
  }

  // Strategy: Find the combination of walls that creates the LARGEST rectangle
  // that still contains the OCR text. This avoids selecting closet walls.
  
  // Sort walls by distance from OCR (closest first)
  wallsAbove.sort((a, b) => (centerY - a.centerY) - (centerY - b.centerY));
  wallsBelow.sort((a, b) => (b.centerY - centerY) - (a.centerY - centerY));
  wallsLeft.sort((a, b) => (centerX - a.centerX) - (centerX - b.centerX));
  wallsRight.sort((a, b) => (b.centerX - centerX) - (a.centerX - centerX));

  // Try to find the best rectangular room by maximizing area
  // We'll test combinations and pick the one with the largest area that makes sense
  let bestRoom = null;
  let bestArea = 0;
  const minRoomSize = 100; // Minimum room dimension in pixels

  // Test different wall combinations
  // For efficiency, we'll test the first few walls on each side
  const maxWallsToTest = Math.min(3, 
    Math.min(wallsAbove.length, wallsBelow.length, wallsLeft.length, wallsRight.length)
  );

  for (let topIdx = 0; topIdx < Math.min(maxWallsToTest, wallsAbove.length); topIdx++) {
    for (let bottomIdx = 0; bottomIdx < Math.min(maxWallsToTest, wallsBelow.length); bottomIdx++) {
      for (let leftIdx = 0; leftIdx < Math.min(maxWallsToTest, wallsLeft.length); leftIdx++) {
        for (let rightIdx = 0; rightIdx < Math.min(maxWallsToTest, wallsRight.length); rightIdx++) {
          const topWall = wallsAbove[topIdx];
          const bottomWall = wallsBelow[bottomIdx];
          const leftWall = wallsLeft[leftIdx];
          const rightWall = wallsRight[rightIdx];

          // Calculate room boundaries using inner edges
          const roomBox = {
            x1: leftWall.boundingBox.x2,
            y1: topWall.boundingBox.y2,
            x2: rightWall.boundingBox.x1,
            y2: bottomWall.boundingBox.y1
          };

          const width = roomBox.x2 - roomBox.x1;
          const height = roomBox.y2 - roomBox.y1;

          // Validate the room
          if (width < minRoomSize || height < minRoomSize) {
            continue; // Room too small
          }

          // Check that OCR is fully contained
          if (dimensionBBox.x < roomBox.x1 || 
              dimensionBBox.x + dimensionBBox.width > roomBox.x2 ||
              dimensionBBox.y < roomBox.y1 || 
              dimensionBBox.y + dimensionBBox.height > roomBox.y2) {
            continue; // OCR not fully contained
          }

          // Calculate area
          const area = width * height;

          // Check aspect ratio (rooms shouldn't be too elongated)
          const aspectRatio = Math.max(width, height) / Math.min(width, height);
          if (aspectRatio > 5) {
            continue; // Too elongated
          }

          // Update best if this is larger
          if (area > bestArea) {
            bestArea = area;
            bestRoom = {
              ...roomBox,
              walls: { topWall, bottomWall, leftWall, rightWall }
            };
          }
        }
      }
    }
  }

  if (bestRoom) {
    console.log('findRoomFromWalls: Found best room with area', bestArea, 'pixels²');
    console.log('findRoomFromWalls: Room box:', {
      x1: bestRoom.x1,
      y1: bestRoom.y1,
      x2: bestRoom.x2,
      y2: bestRoom.y2,
      width: bestRoom.x2 - bestRoom.x1,
      height: bestRoom.y2 - bestRoom.y1
    });
    
    // Return room box without walls metadata
    return {
      x1: bestRoom.x1,
      y1: bestRoom.y1,
      x2: bestRoom.x2,
      y2: bestRoom.y2
    };
  }

  console.log('findRoomFromWalls: Could not find valid room');
  return null;
};

/**
 * Create debug visualizations
 */
const createDebugVisualizations = (wallData, width, height) => {
  return {
    allWallsCanvas: visualizeWalls(wallData.allWalls, width, height, 'all'),
    exteriorWallsCanvas: visualizeWalls(wallData.exterior, width, height, 'exterior'),
    interiorWallsCanvas: visualizeWalls(wallData.interior, width, height, 'interior'),
    perimeterCanvas: visualizePerimeter(wallData.perimeter, width, height)
  };
};

/**
 * Visualize walls on a canvas
 */
const visualizeWalls = (walls, width, height, type) => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  // White background
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, width, height);

  // Draw walls
  const colors = {
    all: 'rgba(0, 0, 0, 0.5)',
    exterior: 'rgba(255, 0, 0, 0.7)',
    interior: 'rgba(0, 0, 255, 0.7)'
  };

  ctx.fillStyle = colors[type] || colors.all;

  for (const wall of walls) {
    const { x1, y1, x2, y2 } = wall.boundingBox;
    ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
  }

  return canvas;
};

/**
 * Visualize perimeter on a canvas
 */
const visualizePerimeter = (perimeter, width, height) => {
  if (!perimeter || !perimeter.vertices) return null;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  // White background
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, width, height);

  // Draw perimeter
  ctx.strokeStyle = 'green';
  ctx.lineWidth = 3;
  ctx.beginPath();

  const vertices = perimeter.vertices;
  if (vertices.length > 0) {
    ctx.moveTo(vertices[0].x, vertices[0].y);
    for (let i = 1; i < vertices.length; i++) {
      ctx.lineTo(vertices[i].x, vertices[i].y);
    }
    ctx.closePath();
  }

  ctx.stroke();

  // Draw vertices
  ctx.fillStyle = 'red';
  for (const vertex of vertices) {
    ctx.beginPath();
    ctx.arc(vertex.x, vertex.y, 5, 0, Math.PI * 2);
    ctx.fill();
  }

  return canvas;
};

/**
 * Export canvas as data URL for debugging
 */
export const canvasToDataUrl = (canvas) => {
  return canvas ? canvas.toDataURL() : null;
};
