/**
 * Wall Centerline Extraction Module
 * 
 * Handles thick walls (double lines or solid regions) and extracts centerlines.
 * Implements:
 * - Skeleton extraction (thinning)
 * - Distance transform
 * - Centerline detection for thick walls
 */

/**
 * Extract wall centerlines from thick walls using skeletonization
 * @param {Uint8Array} binary - Binary image with walls
 * @param {number} width - Image width
 * @param {number} height - Image height
 * @param {Object} options - Extraction options
 * @returns {Uint8Array} Skeleton image
 */
export const extractSkeleton = (binary, width, height, options = {}) => {
  const {
    maxIterations = 100,
    preserveEndpoints = true
  } = options;
  
  console.log('Extracting wall centerlines via skeletonization...');
  
  let current = new Uint8Array(binary);
  let changed = true;
  let iteration = 0;
  
  while (changed && iteration < maxIterations) {
    changed = false;
    const next = new Uint8Array(current);
    
    // Two-pass thinning (Zhang-Suen algorithm)
    // Pass 1
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        if (current[idx] === 0) continue;
        
        if (shouldRemovePixel(current, width, x, y, 1)) {
          next[idx] = 0;
          changed = true;
        }
      }
    }
    
    current = next;
    const next2 = new Uint8Array(current);
    
    // Pass 2
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        if (current[idx] === 0) continue;
        
        if (shouldRemovePixel(current, width, x, y, 2)) {
          next2[idx] = 0;
          changed = true;
        }
      }
    }
    
    current = next2;
    iteration++;
  }
  
  console.log(`Skeletonization completed in ${iteration} iterations`);
  
  return current;
};

/**
 * Zhang-Suen thinning algorithm helper
 * Determines if a pixel should be removed in a thinning pass
 */
const shouldRemovePixel = (binary, width, x, y, pass) => {
  const idx = y * width + x;
  
  // Get 8-connected neighbors (clockwise from top)
  const p2 = binary[(y - 1) * width + x];      // N
  const p3 = binary[(y - 1) * width + (x + 1)]; // NE
  const p4 = binary[y * width + (x + 1)];       // E
  const p5 = binary[(y + 1) * width + (x + 1)]; // SE
  const p6 = binary[(y + 1) * width + x];       // S
  const p7 = binary[(y + 1) * width + (x - 1)]; // SW
  const p8 = binary[y * width + (x - 1)];       // W
  const p9 = binary[(y - 1) * width + (x - 1)]; // NW
  
  // Count black neighbors (A)
  const neighbors = [p2, p3, p4, p5, p6, p7, p8, p9];
  const A = neighbors.reduce((sum, p) => sum + p, 0);
  
  // Count 0->1 transitions (B)
  let B = 0;
  for (let i = 0; i < 8; i++) {
    if (neighbors[i] === 0 && neighbors[(i + 1) % 8] === 1) {
      B++;
    }
  }
  
  // Conditions for both passes
  if (B !== 1) return false;
  if (A < 2 || A > 6) return false;
  
  // Pass-specific conditions
  if (pass === 1) {
    if (p2 * p4 * p6 !== 0) return false;
    if (p4 * p6 * p8 !== 0) return false;
  } else {
    if (p2 * p4 * p8 !== 0) return false;
    if (p2 * p6 * p8 !== 0) return false;
  }
  
  return true;
};

/**
 * Compute distance transform
 * Returns distance of each pixel to nearest background pixel
 * @param {Uint8Array} binary - Binary image
 * @param {number} width - Image width
 * @param {number} height - Image height
 * @returns {Float32Array} Distance map
 */
export const computeDistanceTransform = (binary, width, height) => {
  console.log('Computing distance transform...');
  
  const dist = new Float32Array(width * height);
  const inf = width + height; // Large enough value
  
  // Initialize
  for (let i = 0; i < dist.length; i++) {
    dist[i] = binary[i] === 1 ? inf : 0;
  }
  
  // Forward pass
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (dist[idx] === 0) continue;
      
      let minDist = dist[idx];
      
      // Check neighbors
      if (x > 0) {
        minDist = Math.min(minDist, dist[idx - 1] + 1);
      }
      if (y > 0) {
        minDist = Math.min(minDist, dist[idx - width] + 1);
      }
      if (x > 0 && y > 0) {
        minDist = Math.min(minDist, dist[idx - width - 1] + Math.SQRT2);
      }
      if (x < width - 1 && y > 0) {
        minDist = Math.min(minDist, dist[idx - width + 1] + Math.SQRT2);
      }
      
      dist[idx] = minDist;
    }
  }
  
  // Backward pass
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const idx = y * width + x;
      if (dist[idx] === 0) continue;
      
      let minDist = dist[idx];
      
      // Check neighbors
      if (x < width - 1) {
        minDist = Math.min(minDist, dist[idx + 1] + 1);
      }
      if (y < height - 1) {
        minDist = Math.min(minDist, dist[idx + width] + 1);
      }
      if (x < width - 1 && y < height - 1) {
        minDist = Math.min(minDist, dist[idx + width + 1] + Math.SQRT2);
      }
      if (x > 0 && y < height - 1) {
        minDist = Math.min(minDist, dist[idx + width - 1] + Math.SQRT2);
      }
      
      dist[idx] = minDist;
    }
  }
  
  return dist;
};

/**
 * Extract wall centerlines using distance transform
 * Finds local maxima in distance map
 * @param {Uint8Array} binary - Binary image with walls
 * @param {number} width - Image width
 * @param {number} height - Image height
 * @param {Object} options - Extraction options
 * @returns {Uint8Array} Centerline image
 */
export const extractCenterlineFromDistance = (binary, width, height, options = {}) => {
  const {
    minWallThickness = 3,
    smoothing = true
  } = options;
  
  console.log('Extracting centerlines from distance transform...');
  
  // Compute distance transform
  const dist = computeDistanceTransform(binary, width, height);
  
  // Find local maxima (ridge detection)
  const centerline = new Uint8Array(width * height);
  
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      
      if (dist[idx] < minWallThickness / 2) continue;
      
      // Check if local maximum in perpendicular direction
      const isMaximum = checkLocalMaximum(dist, width, x, y);
      
      if (isMaximum) {
        centerline[idx] = 1;
      }
    }
  }
  
  // Optional: thin the centerlines
  if (smoothing) {
    return extractSkeleton(centerline, width, height, { maxIterations: 10 });
  }
  
  return centerline;
};

/**
 * Check if pixel is local maximum in distance map
 */
const checkLocalMaximum = (dist, width, x, y) => {
  const idx = y * width + x;
  const value = dist[idx];
  
  // Check 8-connected neighbors
  const neighbors = [
    dist[(y - 1) * width + x],      // N
    dist[(y - 1) * width + (x + 1)], // NE
    dist[y * width + (x + 1)],       // E
    dist[(y + 1) * width + (x + 1)], // SE
    dist[(y + 1) * width + x],       // S
    dist[(y + 1) * width + (x - 1)], // SW
    dist[y * width + (x - 1)],       // W
    dist[(y - 1) * width + (x - 1)]  // NW
  ];
  
  // Must be greater than or equal to all neighbors
  for (const n of neighbors) {
    if (n > value) return false;
  }
  
  // Must be strictly greater than at least one neighbor
  let hasStrictlyGreater = false;
  for (const n of neighbors) {
    if (value > n) {
      hasStrictlyGreater = true;
      break;
    }
  }
  
  return hasStrictlyGreater;
};

/**
 * Detect thick wall boundaries (double lines)
 * Returns inner and outer boundaries
 * @param {Uint8Array} binary - Binary image with walls
 * @param {number} width - Image width
 * @param {number} height - Image height
 * @returns {Object} {inner, outer, thickness}
 */
export const detectWallBoundaries = (binary, width, height) => {
  console.log('Detecting wall boundaries...');
  
  const dist = computeDistanceTransform(binary, width, height);
  
  // Find wall regions (connected components with sufficient thickness)
  const inner = new Uint8Array(width * height);
  const outer = new Uint8Array(width * height);
  const thickness = new Float32Array(width * height);
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      
      if (binary[idx] === 0) continue;
      
      const d = dist[idx];
      thickness[idx] = d;
      
      // Inner boundary: distance > threshold
      if (d > 3) {
        inner[idx] = 1;
      }
      
      // Outer boundary: adjacent to background
      if (hasBackgroundNeighbor(binary, width, height, x, y)) {
        outer[idx] = 1;
      }
    }
  }
  
  return { inner, outer, thickness };
};

/**
 * Check if pixel has a background neighbor
 */
const hasBackgroundNeighbor = (binary, width, height, x, y) => {
  const neighbors = [
    { dx: -1, dy: 0 }, { dx: 1, dy: 0 },
    { dx: 0, dy: -1 }, { dx: 0, dy: 1 }
  ];
  
  for (const { dx, dy } of neighbors) {
    const nx = x + dx;
    const ny = y + dy;
    
    if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
      const nIdx = ny * width + nx;
      if (binary[nIdx] === 0) return true;
    }
  }
  
  return false;
};

/**
 * Estimate wall thickness at each point
 * @param {Uint8Array} binary - Binary image with walls
 * @param {number} width - Image width
 * @param {number} height - Image height
 * @returns {Float32Array} Thickness map
 */
export const estimateWallThickness = (binary, width, height) => {
  const dist = computeDistanceTransform(binary, width, height);
  const thickness = new Float32Array(width * height);
  
  // Wall thickness is approximately 2 * distance from centerline
  for (let i = 0; i < dist.length; i++) {
    thickness[i] = dist[i] * 2;
  }
  
  return thickness;
};
