/**
 * Line Detection and Refinement Module
 * 
 * Classical line detection algorithms refined by CNN-based likelihood maps.
 * Implements:
 * - Hough Transform for line detection
 * - Line segment detection (LSD algorithm)
 * - Line merging and filtering
 * - Orientation-constrained detection
 */

/**
 * Line segment representation
 */
export class LineSegment {
  constructor(x1, y1, x2, y2, score = 1.0) {
    this.x1 = x1;
    this.y1 = y1;
    this.x2 = x2;
    this.y2 = y2;
    this.score = score;
    
    // Calculate derived properties
    this.length = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
    this.angle = Math.atan2(y2 - y1, x2 - x1);
    this.centerX = (x1 + x2) / 2;
    this.centerY = (y1 + y2) / 2;
  }
  
  /**
   * Check if line is horizontal (within tolerance)
   */
  isHorizontal(tolerance = Math.PI / 12) {
    const normalizedAngle = Math.abs(this.angle) % Math.PI;
    return normalizedAngle < tolerance || normalizedAngle > Math.PI - tolerance;
  }
  
  /**
   * Check if line is vertical (within tolerance)
   */
  isVertical(tolerance = Math.PI / 12) {
    const normalizedAngle = Math.abs(this.angle) % Math.PI;
    const vertAngle = Math.PI / 2;
    return Math.abs(normalizedAngle - vertAngle) < tolerance;
  }
  
  /**
   * Get orientation ('horizontal', 'vertical', or 'diagonal')
   */
  getOrientation(tolerance = Math.PI / 12) {
    if (this.isHorizontal(tolerance)) return 'horizontal';
    if (this.isVertical(tolerance)) return 'vertical';
    return 'diagonal';
  }
}

/**
 * Detect edges using Sobel operator
 * @param {Float32Array} likelihood - Wall likelihood map
 * @param {number} width - Image width
 * @param {number} height - Image height
 * @returns {Object} Edge magnitude and direction
 */
export const detectEdges = (likelihood, width, height) => {
  const magnitude = new Float32Array(width * height);
  const direction = new Float32Array(width * height);
  
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      
      // Sobel operators
      const gx = (
        -likelihood[(y - 1) * width + (x - 1)] - 2 * likelihood[y * width + (x - 1)] - likelihood[(y + 1) * width + (x - 1)] +
        likelihood[(y - 1) * width + (x + 1)] + 2 * likelihood[y * width + (x + 1)] + likelihood[(y + 1) * width + (x + 1)]
      );
      
      const gy = (
        -likelihood[(y - 1) * width + (x - 1)] - 2 * likelihood[(y - 1) * width + x] - likelihood[(y - 1) * width + (x + 1)] +
        likelihood[(y + 1) * width + (x - 1)] + 2 * likelihood[(y + 1) * width + x] + likelihood[(y + 1) * width + (x + 1)]
      );
      
      magnitude[idx] = Math.sqrt(gx * gx + gy * gy);
      direction[idx] = Math.atan2(gy, gx);
    }
  }
  
  return { magnitude, direction };
};

/**
 * Non-maximum suppression for edge thinning
 * @param {Float32Array} magnitude - Edge magnitude
 * @param {Float32Array} direction - Edge direction
 * @param {number} width - Image width
 * @param {number} height - Image height
 * @returns {Float32Array} Suppressed edges
 */
export const nonMaximumSuppression = (magnitude, direction, width, height) => {
  const result = new Float32Array(width * height);
  
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const mag = magnitude[idx];
      const angle = direction[idx];
      
      // Quantize angle to 4 directions
      let angle8 = Math.round(angle / (Math.PI / 4)) % 4;
      if (angle8 < 0) angle8 += 4;
      
      let n1, n2;
      
      // Check neighbors along gradient direction
      if (angle8 === 0) {
        // Horizontal
        n1 = magnitude[idx - 1];
        n2 = magnitude[idx + 1];
      } else if (angle8 === 1) {
        // Diagonal /
        n1 = magnitude[idx - width + 1];
        n2 = magnitude[idx + width - 1];
      } else if (angle8 === 2) {
        // Vertical
        n1 = magnitude[idx - width];
        n2 = magnitude[idx + width];
      } else {
        // Diagonal \
        n1 = magnitude[idx - width - 1];
        n2 = magnitude[idx + width + 1];
      }
      
      // Keep only local maxima
      if (mag >= n1 && mag >= n2) {
        result[idx] = mag;
      }
    }
  }
  
  return result;
};

/**
 * Detect line segments using simplified LSD algorithm
 * @param {Float32Array} likelihood - Wall likelihood map
 * @param {number} width - Image width
 * @param {number} height - Image height
 * @param {Object} options - Detection options
 * @returns {Array<LineSegment>} Detected line segments
 */
export const detectLineSegments = (likelihood, width, height, options = {}) => {
  const {
    minLength = 50,
    minScore = 0.3,
    maxGap = 10,
    orientationConstraint = true,
    angleTolerance = Math.PI / 12 // 15 degrees
  } = options;
  
  console.log('Detecting line segments...');
  
  // Detect edges
  const { magnitude, direction } = detectEdges(likelihood, width, height);
  const edges = nonMaximumSuppression(magnitude, direction, width, height);
  
  // Threshold edges
  const binary = new Uint8Array(width * height);
  const threshold = minScore;
  for (let i = 0; i < edges.length; i++) {
    binary[i] = edges[i] > threshold ? 1 : 0;
  }
  
  // Find connected edge chains
  const chains = findEdgeChains(binary, direction, width, height, maxGap);
  
  console.log(`Found ${chains.length} edge chains`);
  
  // Fit lines to chains
  const segments = [];
  for (const chain of chains) {
    if (chain.length < minLength / 2) continue;
    
    // Fit line using least squares
    const line = fitLineToPoints(chain);
    
    if (line && line.length >= minLength) {
      // Filter by orientation if enabled
      if (orientationConstraint) {
        const orientation = line.getOrientation(angleTolerance);
        if (orientation === 'diagonal') continue;
      }
      
      // Calculate average likelihood along line
      const avgLikelihood = calculateLineLikelihood(likelihood, width, height, line);
      line.score = avgLikelihood;
      
      if (avgLikelihood >= minScore) {
        segments.push(line);
      }
    }
  }
  
  console.log(`Detected ${segments.length} line segments`);
  
  return segments;
};

/**
 * Find connected edge chains
 */
const findEdgeChains = (binary, direction, width, height, maxGap) => {
  const visited = new Uint8Array(width * height);
  const chains = [];
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      
      if (binary[idx] === 1 && visited[idx] === 0) {
        const chain = traceEdgeChain(binary, direction, visited, width, height, x, y, maxGap);
        if (chain.length > 0) {
          chains.push(chain);
        }
      }
    }
  }
  
  return chains;
};

/**
 * Trace a single edge chain
 */
const traceEdgeChain = (binary, direction, visited, width, height, startX, startY, maxGap) => {
  const chain = [];
  const queue = [{ x: startX, y: startY }];
  
  while (queue.length > 0) {
    const { x, y } = queue.shift();
    const idx = y * width + x;
    
    if (visited[idx] === 1) continue;
    visited[idx] = 1;
    chain.push({ x, y });
    
    // Look for neighbors along the edge direction
    const angle = direction[idx];
    const neighbors = getEdgeNeighbors(x, y, angle, maxGap);
    
    for (const { x: nx, y: ny } of neighbors) {
      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        const nIdx = ny * width + nx;
        if (binary[nIdx] === 1 && visited[nIdx] === 0) {
          queue.push({ x: nx, y: ny });
        }
      }
    }
  }
  
  return chain;
};

/**
 * Get neighbors along edge direction
 */
const getEdgeNeighbors = (x, y, angle, maxGap) => {
  const neighbors = [];
  
  // 8-connected neighbors
  for (let dy = -maxGap; dy <= maxGap; dy++) {
    for (let dx = -maxGap; dx <= maxGap; dx++) {
      if (dx === 0 && dy === 0) continue;
      neighbors.push({ x: x + dx, y: y + dy });
    }
  }
  
  return neighbors;
};

/**
 * Fit line to points using least squares
 */
const fitLineToPoints = (points) => {
  if (points.length < 2) return null;
  
  // Calculate centroid
  let sumX = 0, sumY = 0;
  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
  }
  const cx = sumX / points.length;
  const cy = sumY / points.length;
  
  // Calculate covariance matrix
  let cxx = 0, cxy = 0, cyy = 0;
  for (const p of points) {
    const dx = p.x - cx;
    const dy = p.y - cy;
    cxx += dx * dx;
    cxy += dx * dy;
    cyy += dy * dy;
  }
  
  // Find principal direction (eigenvector of covariance matrix)
  const angle = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
  const dirX = Math.cos(angle);
  const dirY = Math.sin(angle);
  
  // Project points onto line and find extent
  let minProj = Infinity, maxProj = -Infinity;
  for (const p of points) {
    const proj = (p.x - cx) * dirX + (p.y - cy) * dirY;
    minProj = Math.min(minProj, proj);
    maxProj = Math.max(maxProj, proj);
  }
  
  // Calculate line endpoints
  const x1 = cx + minProj * dirX;
  const y1 = cy + minProj * dirY;
  const x2 = cx + maxProj * dirX;
  const y2 = cy + maxProj * dirY;
  
  return new LineSegment(x1, y1, x2, y2);
};

/**
 * Calculate average likelihood along a line
 */
const calculateLineLikelihood = (likelihood, width, height, line) => {
  const numSamples = Math.ceil(line.length);
  let sum = 0;
  
  for (let i = 0; i <= numSamples; i++) {
    const t = i / numSamples;
    const x = Math.round(line.x1 + t * (line.x2 - line.x1));
    const y = Math.round(line.y1 + t * (line.y2 - line.y1));
    
    if (x >= 0 && x < width && y >= 0 && y < height) {
      sum += likelihood[y * width + x];
    }
  }
  
  return sum / (numSamples + 1);
};

/**
 * Merge nearby collinear line segments
 * @param {Array<LineSegment>} segments - Input line segments
 * @param {Object} options - Merging options
 * @returns {Array<LineSegment>} Merged segments
 */
export const mergeCollinearSegments = (segments, options = {}) => {
  const {
    maxDistance = 10,    // Maximum perpendicular distance
    maxGap = 20,         // Maximum gap along line
    angleTolerance = 0.1 // Maximum angle difference (radians)
  } = options;
  
  console.log('Merging collinear segments...');
  
  if (segments.length === 0) return [];
  
  const merged = [];
  const used = new Set();
  
  for (let i = 0; i < segments.length; i++) {
    if (used.has(i)) continue;
    
    const line1 = segments[i];
    const group = [line1];
    used.add(i);
    
    // Find all collinear segments
    for (let j = i + 1; j < segments.length; j++) {
      if (used.has(j)) continue;
      
      const line2 = segments[j];
      
      // Check if collinear
      if (areCollinear(line1, line2, maxDistance, maxGap, angleTolerance)) {
        group.push(line2);
        used.add(j);
      }
    }
    
    // Merge group into single line
    if (group.length === 1) {
      merged.push(group[0]);
    } else {
      const mergedLine = mergeLineGroup(group);
      merged.push(mergedLine);
    }
  }
  
  console.log(`Merged ${segments.length} segments into ${merged.length}`);
  
  return merged;
};

/**
 * Check if two lines are collinear
 */
const areCollinear = (line1, line2, maxDistance, maxGap, angleTolerance) => {
  // Check angle similarity
  const angleDiff = Math.abs(line1.angle - line2.angle);
  const normalizedDiff = Math.min(angleDiff, Math.PI - angleDiff);
  if (normalizedDiff > angleTolerance) return false;
  
  // Check perpendicular distance
  const dist1 = perpendicularDistance(line1, line2.x1, line2.y1);
  const dist2 = perpendicularDistance(line1, line2.x2, line2.y2);
  if (Math.max(dist1, dist2) > maxDistance) return false;
  
  // Check gap along line
  const gap = calculateGapAlongLine(line1, line2);
  if (gap > maxGap) return false;
  
  return true;
};

/**
 * Calculate perpendicular distance from point to line
 */
const perpendicularDistance = (line, px, py) => {
  const dx = line.x2 - line.x1;
  const dy = line.y2 - line.y1;
  const length = Math.sqrt(dx * dx + dy * dy);
  
  if (length < 1e-6) return Infinity;
  
  const t = ((px - line.x1) * dx + (py - line.y1) * dy) / (length * length);
  
  // Project point onto line
  const projX = line.x1 + t * dx;
  const projY = line.y1 + t * dy;
  
  return Math.sqrt((px - projX) ** 2 + (py - projY) ** 2);
};

/**
 * Calculate gap between two collinear lines
 */
const calculateGapAlongLine = (line1, line2) => {
  // Project all endpoints onto line1's direction
  const dx = line1.x2 - line1.x1;
  const dy = line1.y2 - line1.y1;
  const length = Math.sqrt(dx * dx + dy * dy);
  
  if (length < 1e-6) return Infinity;
  
  const proj1_1 = 0;
  const proj1_2 = length;
  const proj2_1 = ((line2.x1 - line1.x1) * dx + (line2.y1 - line1.y1) * dy) / length;
  const proj2_2 = ((line2.x2 - line1.x1) * dx + (line2.y2 - line1.y1) * dy) / length;
  
  const min1 = Math.min(proj1_1, proj1_2);
  const max1 = Math.max(proj1_1, proj1_2);
  const min2 = Math.min(proj2_1, proj2_2);
  const max2 = Math.max(proj2_1, proj2_2);
  
  // Calculate gap (negative if overlapping)
  if (max1 < min2) {
    return min2 - max1;
  } else if (max2 < min1) {
    return min1 - max2;
  } else {
    return 0; // Overlapping
  }
};

/**
 * Merge a group of collinear lines
 */
const mergeLineGroup = (lines) => {
  // Find the extreme points
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let sumScore = 0;
  
  for (const line of lines) {
    minX = Math.min(minX, line.x1, line.x2);
    minY = Math.min(minY, line.y1, line.y2);
    maxX = Math.max(maxX, line.x1, line.x2);
    maxY = Math.max(maxY, line.y1, line.y2);
    sumScore += line.score;
  }
  
  const avgScore = sumScore / lines.length;
  
  // Determine if horizontal or vertical
  const avgAngle = lines.reduce((sum, l) => sum + l.angle, 0) / lines.length;
  const isHorizontal = Math.abs(Math.cos(avgAngle)) > Math.abs(Math.sin(avgAngle));
  
  if (isHorizontal) {
    return new LineSegment(minX, (minY + maxY) / 2, maxX, (minY + maxY) / 2, avgScore);
  } else {
    return new LineSegment((minX + maxX) / 2, minY, (minX + maxX) / 2, maxY, avgScore);
  }
};
