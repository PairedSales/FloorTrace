/**
 * Wall Post-Processing Module
 * 
 * Implements:
 * - Orientation constraints and filtering
 * - Length and thickness filtering
 * - Geometric constraint validation
 * - Vectorization, snapping, and quantization
 * - Wall classification (exterior vs interior)
 */

import { LineSegment } from './lineRefinement.js';

/**
 * Filter segments by orientation
 * @param {Array<LineSegment>} segments - Input segments
 * @param {Object} options - Filter options
 * @returns {Array<LineSegment>} Filtered segments
 */
export const filterByOrientation = (segments, options = {}) => {
  const {
    allowedOrientations = ['horizontal', 'vertical'],
    angleTolerance = Math.PI / 12
  } = options;
  
  console.log('Filtering by orientation...');
  
  const filtered = segments.filter(seg => {
    const orientation = seg.getOrientation(angleTolerance);
    return allowedOrientations.includes(orientation);
  });
  
  console.log(`Orientation filter: ${segments.length} -> ${filtered.length} segments`);
  
  return filtered;
};

/**
 * Filter segments by length
 * @param {Array<LineSegment>} segments - Input segments
 * @param {number} minLength - Minimum length
 * @param {number} maxLength - Maximum length (optional)
 * @returns {Array<LineSegment>} Filtered segments
 */
export const filterByLength = (segments, minLength, maxLength = Infinity) => {
  console.log(`Filtering by length (${minLength} - ${maxLength})...`);
  
  const filtered = segments.filter(seg => 
    seg.length >= minLength && seg.length <= maxLength
  );
  
  console.log(`Length filter: ${segments.length} -> ${filtered.length} segments`);
  
  return filtered;
};

/**
 * Filter isolated segments (not connected to others)
 * @param {Array<LineSegment>} segments - Input segments
 * @param {number} connectionThreshold - Maximum distance for connection
 * @returns {Array<LineSegment>} Connected segments only
 */
export const filterIsolatedSegments = (segments, connectionThreshold = 20) => {
  console.log('Filtering isolated segments...');
  
  const connected = new Set();
  
  // Check each pair for connections
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      const seg1 = segments[i];
      const seg2 = segments[j];
      
      if (areConnected(seg1, seg2, connectionThreshold)) {
        connected.add(i);
        connected.add(j);
      }
    }
  }
  
  const filtered = segments.filter((_, i) => connected.has(i));
  
  console.log(`Isolation filter: ${segments.length} -> ${filtered.length} segments`);
  
  return filtered;
};

/**
 * Check if two segments are connected
 */
const areConnected = (seg1, seg2, threshold) => {
  // Check if endpoints are close
  const distances = [
    distance(seg1.x1, seg1.y1, seg2.x1, seg2.y1),
    distance(seg1.x1, seg1.y1, seg2.x2, seg2.y2),
    distance(seg1.x2, seg1.y2, seg2.x1, seg2.y1),
    distance(seg1.x2, seg1.y2, seg2.x2, seg2.y2)
  ];
  
  return Math.min(...distances) <= threshold;
};

/**
 * Distance between two points
 */
const distance = (x1, y1, x2, y2) => {
  return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
};

/**
 * Snap segments to grid for quantization
 * @param {Array<LineSegment>} segments - Input segments
 * @param {number} gridSize - Grid spacing
 * @returns {Array<LineSegment>} Snapped segments
 */
export const snapToGrid = (segments, gridSize = 5) => {
  console.log(`Snapping to grid (size=${gridSize})...`);
  
  const snapped = segments.map(seg => {
    const x1 = Math.round(seg.x1 / gridSize) * gridSize;
    const y1 = Math.round(seg.y1 / gridSize) * gridSize;
    const x2 = Math.round(seg.x2 / gridSize) * gridSize;
    const y2 = Math.round(seg.y2 / gridSize) * gridSize;
    
    return new LineSegment(x1, y1, x2, y2, seg.score);
  });
  
  return snapped;
};

/**
 * Snap segments to dominant orientations (0°, 90°)
 * @param {Array<LineSegment>} segments - Input segments
 * @param {Object} options - Snapping options
 * @returns {Array<LineSegment>} Orientation-snapped segments
 */
export const snapToOrientations = (segments, options = {}) => {
  const {
    angleTolerance = Math.PI / 12
  } = options;
  
  console.log('Snapping to dominant orientations...');
  
  const snapped = segments.map(seg => {
    const orientation = seg.getOrientation(angleTolerance);
    
    if (orientation === 'horizontal') {
      // Force horizontal
      const avgY = (seg.y1 + seg.y2) / 2;
      return new LineSegment(seg.x1, avgY, seg.x2, avgY, seg.score);
    } else if (orientation === 'vertical') {
      // Force vertical
      const avgX = (seg.x1 + seg.x2) / 2;
      return new LineSegment(avgX, seg.y1, avgX, seg.y2, seg.score);
    }
    
    return seg;
  });
  
  return snapped;
};

/**
 * Remove duplicate segments
 * @param {Array<LineSegment>} segments - Input segments
 * @param {number} threshold - Distance threshold for considering duplicates
 * @returns {Array<LineSegment>} Deduplicated segments
 */
export const removeDuplicates = (segments, threshold = 10) => {
  console.log('Removing duplicates...');
  
  const result = [];
  const used = new Set();
  
  for (let i = 0; i < segments.length; i++) {
    if (used.has(i)) continue;
    
    const seg1 = segments[i];
    const duplicates = [seg1];
    used.add(i);
    
    // Find duplicates
    for (let j = i + 1; j < segments.length; j++) {
      if (used.has(j)) continue;
      
      const seg2 = segments[j];
      
      if (areDuplicates(seg1, seg2, threshold)) {
        duplicates.push(seg2);
        used.add(j);
      }
    }
    
    // Keep the one with highest score
    const best = duplicates.reduce((max, seg) => 
      seg.score > max.score ? seg : max
    );
    
    result.push(best);
  }
  
  console.log(`Duplicate removal: ${segments.length} -> ${result.length} segments`);
  
  return result;
};

/**
 * Check if two segments are duplicates
 */
const areDuplicates = (seg1, seg2, threshold) => {
  // Check if endpoints are close (accounting for direction reversal)
  const dist1 = distance(seg1.x1, seg1.y1, seg2.x1, seg2.y1) + 
                distance(seg1.x2, seg1.y2, seg2.x2, seg2.y2);
  const dist2 = distance(seg1.x1, seg1.y1, seg2.x2, seg2.y2) + 
                distance(seg1.x2, seg1.y2, seg2.x1, seg2.y1);
  
  return Math.min(dist1, dist2) <= threshold * 2;
};

/**
 * Filter by geometric constraints
 * E.g., parallel walls should have consistent spacing
 * @param {Array<LineSegment>} segments - Input segments
 * @param {Object} options - Constraint options
 * @returns {Array<LineSegment>} Validated segments
 */
export const applyGeometricConstraints = (segments, options = {}) => {
  const {
    minWallSpacing = 50,
    maxWallSpacing = 500
  } = options;
  
  console.log('Applying geometric constraints...');
  
  // For each segment, check if it has reasonable spacing from parallel segments
  const filtered = segments.filter(seg => {
    const parallel = findParallelSegments(seg, segments, Math.PI / 12);
    
    if (parallel.length === 0) return true; // No parallel segments, keep it
    
    // Check spacing to closest parallel segment
    const minSpacing = Math.min(...parallel.map(p => 
      perpendicularDistance(seg, p)
    ));
    
    return minSpacing >= minWallSpacing && minSpacing <= maxWallSpacing;
  });
  
  console.log(`Geometric constraints: ${segments.length} -> ${filtered.length} segments`);
  
  return filtered;
};

/**
 * Find parallel segments
 */
const findParallelSegments = (seg, allSegments, angleTolerance) => {
  return allSegments.filter(other => {
    if (other === seg) return false;
    
    const angleDiff = Math.abs(seg.angle - other.angle);
    const normalizedDiff = Math.min(angleDiff, Math.PI - angleDiff);
    
    return normalizedDiff < angleTolerance;
  });
};

/**
 * Calculate perpendicular distance between parallel segments
 */
const perpendicularDistance = (seg1, seg2) => {
  // Use midpoint of seg2
  const midX = seg2.centerX;
  const midY = seg2.centerY;
  
  // Calculate perpendicular distance from midpoint to seg1
  const dx = seg1.x2 - seg1.x1;
  const dy = seg1.y2 - seg1.y1;
  const length = Math.sqrt(dx * dx + dy * dy);
  
  if (length < 1e-6) return Infinity;
  
  const t = ((midX - seg1.x1) * dx + (midY - seg1.y1) * dy) / (length * length);
  const projX = seg1.x1 + t * dx;
  const projY = seg1.y1 + t * dy;
  
  return Math.sqrt((midX - projX) ** 2 + (midY - projY) ** 2);
};

/**
 * Classify segments as exterior or interior walls
 * @param {Array<LineSegment>} segments - Input segments
 * @param {number} width - Image width
 * @param {number} height - Image height
 * @param {number} edgeThreshold - Distance from edge to be exterior
 * @returns {Object} {exterior, interior}
 */
export const classifyWalls = (segments, width, height, edgeThreshold = null) => {
  if (!edgeThreshold) {
    edgeThreshold = Math.min(width, height) * 0.15;
  }
  
  console.log('Classifying walls as exterior/interior...');
  
  const exterior = [];
  const interior = [];
  
  for (const seg of segments) {
    const distToEdge = Math.min(
      seg.centerX,
      seg.centerY,
      width - seg.centerX,
      height - seg.centerY
    );
    
    if (distToEdge < edgeThreshold) {
      exterior.push(seg);
    } else {
      interior.push(seg);
    }
  }
  
  console.log(`Classification: ${exterior.length} exterior, ${interior.length} interior`);
  
  return { exterior, interior };
};

/**
 * Full post-processing pipeline
 * @param {Array<LineSegment>} segments - Input segments
 * @param {number} width - Image width
 * @param {number} height - Image height
 * @param {Object} options - Processing options
 * @returns {Object} Processed segments
 */
export const postProcessSegments = (segments, width, height, options = {}) => {
  const {
    minLength = 50,
    maxLength = Infinity,
    enforceOrientation = true,
    allowedOrientations = ['horizontal', 'vertical'],
    angleTolerance = Math.PI / 12,
    removeIsolated = true,
    connectionThreshold = 20,
    snapGrid = true,
    gridSize = 5,
    snapOrientation = true,
    removeDups = true,
    duplicateThreshold = 10,
    applyConstraints = true,
    classifyExterior = true,
    edgeThreshold = null
  } = options;
  
  console.log('Starting post-processing pipeline...');
  
  let processed = [...segments];
  
  // Filter by length
  processed = filterByLength(processed, minLength, maxLength);
  
  // Filter by orientation
  if (enforceOrientation) {
    processed = filterByOrientation(processed, { allowedOrientations, angleTolerance });
  }
  
  // Snap to orientations
  if (snapOrientation) {
    processed = snapToOrientations(processed, { angleTolerance });
  }
  
  // Snap to grid
  if (snapGrid) {
    processed = snapToGrid(processed, gridSize);
  }
  
  // Remove duplicates
  if (removeDups) {
    processed = removeDuplicates(processed, duplicateThreshold);
  }
  
  // Apply geometric constraints
  if (applyConstraints) {
    processed = applyGeometricConstraints(processed);
  }
  
  // Remove isolated segments
  if (removeIsolated) {
    processed = filterIsolatedSegments(processed, connectionThreshold);
  }
  
  // Classify walls
  let exterior = [];
  let interior = [];
  
  if (classifyExterior) {
    const classified = classifyWalls(processed, width, height, edgeThreshold);
    exterior = classified.exterior;
    interior = classified.interior;
  } else {
    interior = processed;
  }
  
  // Separate by orientation
  const horizontal = processed.filter(s => s.isHorizontal(angleTolerance));
  const vertical = processed.filter(s => s.isVertical(angleTolerance));
  
  console.log('Post-processing complete');
  
  return {
    all: processed,
    horizontal,
    vertical,
    exterior,
    interior
  };
};
