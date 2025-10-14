/**
 * Thick Wall Detection
 * Detects walls while preserving their full thickness (not just centerlines)
 * Handles both solid thick walls and dashed/multi-line walls
 */

/**
 * ThickWall class - represents a wall with full thickness information
 */
export class ThickWall {
  constructor(region, centerline, isHorizontal) {
    this.region = region; // Array of pixels forming the thick wall region
    this.centerline = centerline; // {x1, y1, x2, y2} for topology/structure
    this.isHorizontal = isHorizontal;
    
    // Calculate bounding box
    const xs = region.map(p => p.x);
    const ys = region.map(p => p.y);
    this.boundingBox = {
      x1: Math.min(...xs),
      y1: Math.min(...ys),
      x2: Math.max(...xs),
      y2: Math.max(...ys)
    };
    
    // Calculate dimensions
    this.length = isHorizontal 
      ? this.boundingBox.x2 - this.boundingBox.x1 
      : this.boundingBox.y2 - this.boundingBox.y1;
    
    this.thickness = isHorizontal
      ? this.boundingBox.y2 - this.boundingBox.y1
      : this.boundingBox.x2 - this.boundingBox.x1;
    
    // Calculate center point
    this.centerX = (this.boundingBox.x1 + this.boundingBox.x2) / 2;
    this.centerY = (this.boundingBox.y1 + this.boundingBox.y2) / 2;
  }
  
  /**
   * Get interior edge (for tracing room interiors)
   */
  getInteriorEdge() {
    return this._extractBoundary('interior');
  }
  
  /**
   * Get exterior edge (for tracing building perimeter)
   */
  getExteriorEdge() {
    return this._extractBoundary('exterior');
  }
  
  /**
   * Extract boundary from thick wall region
   */
  _extractBoundary(side) {
    const offset = this.thickness / 2;
    
    if (this.isHorizontal) {
      const y = side === 'interior' 
        ? this.boundingBox.y2 
        : this.boundingBox.y1;
      return {
        x1: this.centerline.x1,
        y1: y,
        x2: this.centerline.x2,
        y2: y
      };
    } else {
      const x = side === 'interior'
        ? this.boundingBox.x2
        : this.boundingBox.x1;
      return {
        x1: x,
        y1: this.centerline.y1,
        x2: x,
        y2: this.centerline.y2
      };
    }
  }
  
  toJSON() {
    return {
      centerline: this.centerline,
      boundingBox: this.boundingBox,
      length: this.length,
      thickness: this.thickness,
      isHorizontal: this.isHorizontal,
      regionPixelCount: this.region.length
    };
  }
}

/**
 * Find all connected components in binary image
 */
const findConnectedComponents = (binary, width, height) => {
  const visited = new Uint8Array(width * height);
  const components = [];
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (binary[idx] === 1 && !visited[idx]) {
        const component = floodFill(binary, visited, x, y, width, height);
        if (component.pixels.length > 0) {
          components.push(component);
        }
      }
    }
  }
  
  return components;
};

/**
 * Flood fill to find connected component
 */
const floodFill = (binary, visited, startX, startY, width, height) => {
  const pixels = [];
  const queue = [{x: startX, y: startY}];
  const startIdx = startY * width + startX;
  visited[startIdx] = 1;
  
  let minX = startX, maxX = startX, minY = startY, maxY = startY;
  
  while (queue.length > 0) {
    const {x, y} = queue.shift();
    pixels.push({x, y});
    
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
    
    // Check 4-connected neighbors
    const neighbors = [
      {x: x-1, y}, {x: x+1, y},
      {x, y: y-1}, {x, y: y+1}
    ];
    
    for (const n of neighbors) {
      if (n.x >= 0 && n.x < width && n.y >= 0 && n.y < height) {
        const idx = n.y * width + n.x;
        if (binary[idx] === 1 && !visited[idx]) {
          visited[idx] = 1;
          queue.push(n);
        }
      }
    }
  }
  
  return {
    pixels,
    boundingBox: {x1: minX, y1: minY, x2: maxX, y2: maxY}
  };
};

/**
 * Calculate centerline from region using PCA or skeleton
 */
const calculateCenterline = (pixels, boundingBox, isHorizontal) => {
  // Simple approach: use bounding box edges
  if (isHorizontal) {
    const y = (boundingBox.y1 + boundingBox.y2) / 2;
    return {
      x1: boundingBox.x1,
      y1: y,
      x2: boundingBox.x2,
      y2: y
    };
  } else {
    const x = (boundingBox.x1 + boundingBox.x2) / 2;
    return {
      x1: x,
      y1: boundingBox.y1,
      x2: x,
      y2: boundingBox.y2
    };
  }
};

/**
 * Detect thin line segments (for finding parallel lines)
 */
const detectThinLines = (binary, width, height, minLength = 50) => {
  const components = findConnectedComponents(binary, width, height);
  const thinLines = [];
  
  for (const comp of components) {
    const bbox = comp.boundingBox;
    const width_c = bbox.x2 - bbox.x1;
    const height_c = bbox.y2 - bbox.y1;
    
    const isHorizontal = width_c > height_c;
    const length = isHorizontal ? width_c : height_c;
    const thickness = isHorizontal ? height_c : width_c;
    
    // Thin line: very narrow (thickness 1-3px) but long
    if (thickness >= 1 && thickness <= 3 && length >= minLength) {
      const centerline = calculateCenterline(comp.pixels, bbox, isHorizontal);
      thinLines.push({ bbox, centerline, isHorizontal, pixels: comp.pixels });
    }
  }
  
  return thinLines;
};

/**
 * Find pairs of parallel thin lines (irregular walls)
 */
const findParallelLinePairs = (thinLines, options = {}) => {
  const { maxSeparation = 30, minLength = 50 } = options;
  const pairs = [];
  const used = new Set();
  
  for (let i = 0; i < thinLines.length; i++) {
    if (used.has(i)) continue;
    const line1 = thinLines[i];
    
    for (let j = i + 1; j < thinLines.length; j++) {
      if (used.has(j)) continue;
      const line2 = thinLines[j];
      
      // Must be same orientation
      if (line1.isHorizontal !== line2.isHorizontal) continue;
      
      // Check if parallel and close enough
      if (line1.isHorizontal) {
        const yDist = Math.abs(line1.centerline.y1 - line2.centerline.y1);
        const xOverlap = Math.min(line1.bbox.x2, line2.bbox.x2) - Math.max(line1.bbox.x1, line2.bbox.x1);
        
        if (yDist >= 4 && yDist <= maxSeparation && xOverlap >= minLength) {
          pairs.push({ line1, line2, separation: yDist });
          used.add(i);
          used.add(j);
          break;
        }
      } else {
        const xDist = Math.abs(line1.centerline.x1 - line2.centerline.x1);
        const yOverlap = Math.min(line1.bbox.y2, line2.bbox.y2) - Math.max(line1.bbox.y1, line2.bbox.y1);
        
        if (xDist >= 4 && xDist <= maxSeparation && yOverlap >= minLength) {
          pairs.push({ line1, line2, separation: xDist });
          used.add(i);
          used.add(j);
          break;
        }
      }
    }
  }
  
  return pairs;
};

/**
 * Fill region between parallel lines to create thick wall
 */
const fillBetweenParallelLines = (pair) => {
  const { line1, line2 } = pair;
  const isHorizontal = line1.isHorizontal;
  
  // Create bounding box that encompasses both lines
  const bbox = {
    x1: Math.min(line1.bbox.x1, line2.bbox.x1),
    y1: Math.min(line1.bbox.y1, line2.bbox.y1),
    x2: Math.max(line1.bbox.x2, line2.bbox.x2),
    y2: Math.max(line1.bbox.y2, line2.bbox.y2)
  };
  
  // Generate filled region between lines
  const pixels = [];
  if (isHorizontal) {
    for (let x = bbox.x1; x <= bbox.x2; x++) {
      for (let y = bbox.y1; y <= bbox.y2; y++) {
        pixels.push({ x, y });
      }
    }
  } else {
    for (let y = bbox.y1; y <= bbox.y2; y++) {
      for (let x = bbox.x1; x <= bbox.x2; x++) {
        pixels.push({ x, y });
      }
    }
  }
  
  const centerline = calculateCenterline(pixels, bbox, isHorizontal);
  return new ThickWall(pixels, centerline, isHorizontal);
};

/**
 * Detect all walls: solid thick walls + irregular parallel-line walls
 */
export const detectThickWalls = (binary, width, height, options = {}) => {
  const {
    minWallLength = 50,
    minThickness = 2,
    maxThickness = 30,
    minAspectRatio = 3,
    maxParallelSeparation = 30
  } = options;
  
  console.log('Detecting walls (solid thick + irregular parallel lines)...');
  
  // Find all connected components
  const components = findConnectedComponents(binary, width, height);
  console.log(`Found ${components.length} connected components`);
  
  // PATH 1: Detect solid thick walls
  const solidWalls = [];
  const possiblyThin = [];
  
  for (const comp of components) {
    const bbox = comp.boundingBox;
    const width_c = bbox.x2 - bbox.x1;
    const height_c = bbox.y2 - bbox.y1;
    
    const isHorizontal = width_c > height_c;
    const length = isHorizontal ? width_c : height_c;
    const thickness = isHorizontal ? height_c : width_c;
    const aspectRatio = length / Math.max(thickness, 1);
    
    // Solid thick wall
    if (length >= minWallLength && 
        thickness >= minThickness && 
        thickness <= maxThickness &&
        aspectRatio >= minAspectRatio) {
      
      const centerline = calculateCenterline(comp.pixels, bbox, isHorizontal);
      const wall = new ThickWall(comp.pixels, centerline, isHorizontal);
      solidWalls.push(wall);
    }
    // Store thin lines for parallel pair detection
    else if (thickness >= 1 && thickness <= 3 && length >= minWallLength) {
      const centerline = calculateCenterline(comp.pixels, bbox, isHorizontal);
      possiblyThin.push({ bbox, centerline, isHorizontal, pixels: comp.pixels });
    }
  }
  
  console.log(`Found ${solidWalls.length} solid thick walls`);
  
  // PATH 2: Find irregular walls (parallel line pairs)
  const pairs = findParallelLinePairs(possiblyThin, {
    maxSeparation: maxParallelSeparation,
    minLength: minWallLength
  });
  
  console.log(`Found ${pairs.length} parallel line pairs (irregular walls)`);
  
  const irregularWalls = pairs.map(pair => fillBetweenParallelLines(pair));
  
  // Combine both types
  const allWalls = [...solidWalls, ...irregularWalls];
  console.log(`Total walls detected: ${allWalls.length} (${solidWalls.length} solid + ${irregularWalls.length} irregular)`);
  
  return allWalls;
};

/**
 * Merge nearby parallel thick walls (for dashed walls)
 */
export const mergeThickWalls = (walls, options = {}) => {
  const {
    maxDistance = 50,
    maxGap = 50,
    angleTolerance = 0.15
  } = options;
  
  const merged = [];
  const used = new Set();
  
  for (let i = 0; i < walls.length; i++) {
    if (used.has(i)) continue;
    
    const group = [walls[i]];
    used.add(i);
    
    // Find all walls that should merge with this one
    for (let j = i + 1; j < walls.length; j++) {
      if (used.has(j)) continue;
      
      if (shouldMergeWalls(walls[i], walls[j], maxDistance, maxGap, angleTolerance)) {
        group.push(walls[j]);
        used.add(j);
      }
    }
    
    // Merge the group into one thick wall
    if (group.length > 1) {
      merged.push(mergeWallGroup(group));
    } else {
      merged.push(group[0]);
    }
  }
  
  console.log(`Merged ${walls.length} walls into ${merged.length} thick walls`);
  return merged;
};

/**
 * Check if two walls should be merged
 */
const shouldMergeWalls = (wall1, wall2, maxDistance, maxGap, angleTolerance) => {
  // Must be same orientation
  if (wall1.isHorizontal !== wall2.isHorizontal) return false;
  
  // Check if they're aligned and close enough
  if (wall1.isHorizontal) {
    const yDist = Math.abs(wall1.centerY - wall2.centerY);
    const xGap = Math.min(
      Math.abs(wall1.boundingBox.x2 - wall2.boundingBox.x1),
      Math.abs(wall2.boundingBox.x2 - wall1.boundingBox.x1)
    );
    return yDist <= maxDistance && xGap <= maxGap;
  } else {
    const xDist = Math.abs(wall1.centerX - wall2.centerX);
    const yGap = Math.min(
      Math.abs(wall1.boundingBox.y2 - wall2.boundingBox.y1),
      Math.abs(wall2.boundingBox.y2 - wall1.boundingBox.y1)
    );
    return xDist <= maxDistance && yGap <= maxGap;
  }
};

/**
 * Merge a group of walls into one
 */
const mergeWallGroup = (group) => {
  // Combine all pixels
  const allPixels = [];
  for (const wall of group) {
    allPixels.push(...wall.region);
  }
  
  // Calculate combined bounding box
  const xs = allPixels.map(p => p.x);
  const ys = allPixels.map(p => p.y);
  const bbox = {
    x1: Math.min(...xs),
    y1: Math.min(...ys),
    x2: Math.max(...xs),
    y2: Math.max(...ys)
  };
  
  const isHorizontal = group[0].isHorizontal;
  const centerline = calculateCenterline(allPixels, bbox, isHorizontal);
  
  return new ThickWall(allPixels, centerline, isHorizontal);
};
