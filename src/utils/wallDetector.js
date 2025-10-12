import { dataUrlToImage, imageToCanvas } from './imageLoader';

/**
 * Advanced Wall Detection System
 * 
 * This system detects walls in floor plan images by:
 * 1. Converting to binary (black/white)
 * 2. Finding all connected dark regions
 * 3. Filtering out text and symbols based on size (walls are longer)
 * 4. Classifying walls as horizontal or vertical
 * 5. Separating exterior walls from interior walls
 * 6. Connecting gaps in exterior walls to form complete perimeter
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
 * Main wall detection function
 * @param {string|HTMLImageElement} imageSource - Image data URL or image element
 * @param {Object} options - Detection options
 * @returns {Object} Detected walls and metadata
 */
export const detectWalls = async (imageSource, options = {}) => {
  const {
    minWallLength = 100, // Minimum pixels to be considered a wall
    binaryThreshold = 128, // Brightness threshold for binary conversion
    debugMode = false
  } = options;

  try {
    // Load and prepare image
    const img = typeof imageSource === 'string' 
      ? await dataUrlToImage(imageSource) 
      : imageSource;
    const canvas = imageToCanvas(img);
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    console.log(`Wall detection started: ${width}x${height}px, minLength=${minWallLength}`);

    // Step 1: Convert to binary
    const binaryImage = convertToBinary(ctx, width, height, binaryThreshold);
    console.log('Binary conversion complete');

    // Step 2: Find all connected components (dark regions)
    const components = findConnectedComponents(binaryImage, width, height);
    console.log(`Found ${components.length} connected components`);

    // Step 3: Filter components to identify walls (long segments)
    const wallSegments = filterWalls(components, minWallLength);
    console.log(`Identified ${wallSegments.length} wall segments`);

    // Step 4: Classify walls as horizontal or vertical
    const { horizontal, vertical } = classifyWalls(wallSegments);
    console.log(`Classified: ${horizontal.length} horizontal, ${vertical.length} vertical`);

    // Step 5: Separate exterior and interior walls
    const { exterior, interior } = separateExteriorInterior(horizontal, vertical, width, height);
    console.log(`Separated: ${exterior.length} exterior, ${interior.length} interior`);

    // Step 6: Build perimeter from exterior walls
    const perimeter = buildPerimeter(exterior, width, height);
    console.log(`Built perimeter with ${perimeter ? perimeter.vertices.length : 0} vertices`);

    const result = {
      allWalls: wallSegments,
      horizontal,
      vertical,
      exterior,
      interior,
      perimeter,
      imageSize: { width, height }
    };

    if (debugMode) {
      result.debug = {
        binaryImage,
        components,
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
 * Convert image to binary (1 = dark/wall, 0 = light/background)
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
 */
const filterWalls = (components, minWallLength) => {
  const walls = [];

  for (const component of components) {
    const { boundingBox } = component;
    const width = boundingBox.x2 - boundingBox.x1;
    const height = boundingBox.y2 - boundingBox.y1;
    const maxDimension = Math.max(width, height);

    // A wall must have at least one dimension >= minWallLength
    if (maxDimension >= minWallLength) {
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
 * @param {Object} wallData - Result from detectWalls
 * @param {Object} dimensionBBox - Bounding box of room dimension text
 * @returns {Object} Room box {x1, y1, x2, y2}
 */
export const findRoomFromWalls = (wallData, dimensionBBox) => {
  const { horizontal, vertical } = wallData;
  const centerX = dimensionBBox.x + dimensionBBox.width / 2;
  const centerY = dimensionBBox.y + dimensionBBox.height / 2;

  // Find walls that could enclose the dimension text
  const wallsAbove = horizontal.filter(w => w.centerY < centerY);
  const wallsBelow = horizontal.filter(w => w.centerY > centerY);
  const wallsLeft = vertical.filter(w => w.centerX < centerX);
  const wallsRight = vertical.filter(w => w.centerX > centerX);

  // Get closest wall on each side
  const topWall = wallsAbove.length > 0
    ? wallsAbove.reduce((closest, w) => 
        Math.abs(w.centerY - centerY) < Math.abs(closest.centerY - centerY) ? w : closest
      )
    : null;

  const bottomWall = wallsBelow.length > 0
    ? wallsBelow.reduce((closest, w) => 
        Math.abs(w.centerY - centerY) < Math.abs(closest.centerY - centerY) ? w : closest
      )
    : null;

  const leftWall = wallsLeft.length > 0
    ? wallsLeft.reduce((closest, w) => 
        Math.abs(w.centerX - centerX) < Math.abs(closest.centerX - centerX) ? w : closest
      )
    : null;

  const rightWall = wallsRight.length > 0
    ? wallsRight.reduce((closest, w) => 
        Math.abs(w.centerX - centerX) < Math.abs(closest.centerX - centerX) ? w : closest
      )
    : null;

  if (!topWall || !bottomWall || !leftWall || !rightWall) {
    return null;
  }

  // Create room box using inner edges of walls
  return {
    x1: leftWall.boundingBox.x2,
    y1: topWall.boundingBox.y2,
    x2: rightWall.boundingBox.x1,
    y2: bottomWall.boundingBox.y1
  };
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
