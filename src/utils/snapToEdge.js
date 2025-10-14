/**
 * Snap-to-Edge Module
 * 
 * Pixel-based snapping that finds wall edges by detecting white→black transitions.
 * Independent from the line detection system - works directly with image data.
 */

/**
 * Find the nearest wall edge from a point
 * @param {Uint8Array} grayscale - Grayscale image data
 * @param {number} width - Image width
 * @param {number} height - Image height
 * @param {number} x - Point x coordinate
 * @param {number} y - Point y coordinate
 * @param {Object} options - Snapping options
 * @returns {Object|null} Snapped point {x, y, type: 'edge'|'corner', edges: [...]}
 */
export const snapToNearestEdge = (grayscale, width, height, x, y, options = {}) => {
  const {
    searchRadius = 20,        // How far to search for edges
    edgeThreshold = 128,      // Threshold for white/black (walls are < 128)
    numDirections = 16,       // Number of radial directions to scan
    cornerThreshold = 2       // Minimum edges to consider a corner
  } = options;
  
  // Clamp point to image bounds
  x = Math.max(0, Math.min(width - 1, Math.round(x)));
  y = Math.max(0, Math.min(height - 1, Math.round(y)));
  
  // Scan in multiple directions to find edges
  const edges = [];
  
  for (let i = 0; i < numDirections; i++) {
    const angle = (i / numDirections) * 2 * Math.PI;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    
    const edge = findEdgeInDirection(grayscale, width, height, x, y, dx, dy, searchRadius, edgeThreshold);
    if (edge) {
      edges.push({
        ...edge,
        angle,
        direction: { dx, dy }
      });
    }
  }
  
  if (edges.length === 0) {
    return null; // No edges found
  }
  
  // If multiple edges from different directions, likely a corner
  if (edges.length >= cornerThreshold) {
    const corner = detectCorner(edges, x, y);
    if (corner) {
      return {
        x: corner.x,
        y: corner.y,
        type: 'corner',
        edges: edges,
        confidence: edges.length / numDirections
      };
    }
  }
  
  // Otherwise, snap to nearest single edge
  const nearestEdge = edges.reduce((nearest, edge) => {
    const dist = Math.sqrt((edge.x - x) ** 2 + (edge.y - y) ** 2);
    const nearestDist = Math.sqrt((nearest.x - x) ** 2 + (nearest.y - y) ** 2);
    return dist < nearestDist ? edge : nearest;
  });
  
  return {
    x: nearestEdge.x,
    y: nearestEdge.y,
    type: 'edge',
    edges: [nearestEdge],
    confidence: 1.0
  };
};

/**
 * Find edge transition in a specific direction
 * @returns {Object|null} Edge point {x, y, distance, isWhiteToBlack}
 */
const findEdgeInDirection = (grayscale, width, height, startX, startY, dx, dy, maxDistance, threshold) => {
  let prevPixel = null;
  
  for (let dist = 1; dist <= maxDistance; dist++) {
    const x = Math.round(startX + dx * dist);
    const y = Math.round(startY + dy * dist);
    
    // Check bounds
    if (x < 0 || x >= width || y < 0 || y >= height) {
      break;
    }
    
    const idx = y * width + x;
    const pixel = grayscale[idx];
    
    if (prevPixel !== null) {
      // Check for white→black transition (entering wall)
      if (prevPixel >= threshold && pixel < threshold) {
        return {
          x,
          y,
          distance: dist,
          isWhiteToBlack: true,
          edgeStrength: prevPixel - pixel
        };
      }
      
      // Check for black→white transition (exiting wall)
      if (prevPixel < threshold && pixel >= threshold) {
        return {
          x: Math.round(startX + dx * (dist - 1)),
          y: Math.round(startY + dy * (dist - 1)),
          distance: dist - 1,
          isWhiteToBlack: false,
          edgeStrength: pixel - prevPixel
        };
      }
    }
    
    prevPixel = pixel;
  }
  
  return null;
};

/**
 * Detect corner from multiple edge intersections
 */
const detectCorner = (edges, centerX, centerY) => {
  if (edges.length < 2) return null;
  
  // Group edges by approximate angle to find distinct directions
  const angleGroups = groupEdgesByAngle(edges, Math.PI / 8); // 22.5 degree bins
  
  // Corner requires at least 2 distinct directions
  if (angleGroups.length < 2) return null;
  
  // Find intersection point of the two most prominent edge directions
  // For now, use weighted average of edge points
  let sumX = 0, sumY = 0, totalWeight = 0;
  
  for (const edge of edges) {
    // Weight by edge strength and inverse distance
    const weight = edge.edgeStrength / Math.max(1, edge.distance);
    sumX += edge.x * weight;
    sumY += edge.y * weight;
    totalWeight += weight;
  }
  
  return {
    x: Math.round(sumX / totalWeight),
    y: Math.round(sumY / totalWeight),
    numEdges: edges.length,
    angleGroups: angleGroups.length
  };
};

/**
 * Group edges by similar angles
 */
const groupEdgesByAngle = (edges, tolerance) => {
  const groups = [];
  
  for (const edge of edges) {
    let foundGroup = false;
    
    for (const group of groups) {
      const avgAngle = group.reduce((sum, e) => sum + e.angle, 0) / group.length;
      const angleDiff = Math.abs(edge.angle - avgAngle);
      const normalizedDiff = Math.min(angleDiff, 2 * Math.PI - angleDiff);
      
      if (normalizedDiff < tolerance) {
        group.push(edge);
        foundGroup = true;
        break;
      }
    }
    
    if (!foundGroup) {
      groups.push([edge]);
    }
  }
  
  return groups;
};

/**
 * Snap a line segment to nearest edges
 * @param {Uint8Array} grayscale - Grayscale image data
 * @param {number} width - Image width
 * @param {number} height - Image height
 * @param {Object} line - Line segment {x1, y1, x2, y2}
 * @param {Object} options - Snapping options
 * @returns {Object} Snapped line {x1, y1, x2, y2}
 */
export const snapLineToEdges = (grayscale, width, height, line, options = {}) => {
  const {
    searchRadius = 20,
    snapEndpoints = true,
    snapMidpoints = false
  } = options;
  
  const snapped = { ...line };
  
  if (snapEndpoints) {
    // Snap start point
    const snap1 = snapToNearestEdge(grayscale, width, height, line.x1, line.y1, { 
      searchRadius,
      ...options 
    });
    if (snap1) {
      snapped.x1 = snap1.x;
      snapped.y1 = snap1.y;
    }
    
    // Snap end point
    const snap2 = snapToNearestEdge(grayscale, width, height, line.x2, line.y2, { 
      searchRadius,
      ...options 
    });
    if (snap2) {
      snapped.x2 = snap2.x;
      snapped.y2 = snap2.y;
    }
  }
  
  return snapped;
};

/**
 * Snap multiple points (e.g., polygon vertices) to nearest edges
 * @param {Uint8Array} grayscale - Grayscale image data
 * @param {number} width - Image width
 * @param {number} height - Image height
 * @param {Array<{x, y}>} points - Array of points
 * @param {Object} options - Snapping options
 * @returns {Array<{x, y}>} Snapped points
 */
export const snapPointsToEdges = (grayscale, width, height, points, options = {}) => {
  return points.map(point => {
    const snapped = snapToNearestEdge(grayscale, width, height, point.x, point.y, options);
    return snapped ? { x: snapped.x, y: snapped.y } : point;
  });
};

/**
 * Get edge profile along a line (for visualization/debugging)
 * @param {Uint8Array} grayscale - Grayscale image data
 * @param {number} width - Image width
 * @param {number} height - Image height
 * @param {number} x1 - Start x
 * @param {number} y1 - Start y
 * @param {number} x2 - End x
 * @param {number} y2 - End y
 * @param {number} numSamples - Number of samples along line
 * @returns {Array<number>} Pixel values along line
 */
export const getEdgeProfile = (grayscale, width, height, x1, y1, x2, y2, numSamples = 50) => {
  const profile = [];
  
  for (let i = 0; i < numSamples; i++) {
    const t = i / (numSamples - 1);
    const x = Math.round(x1 + t * (x2 - x1));
    const y = Math.round(y1 + t * (y2 - y1));
    
    if (x >= 0 && x < width && y >= 0 && y < height) {
      const idx = y * width + x;
      profile.push(grayscale[idx]);
    }
  }
  
  return profile;
};

/**
 * Find all edges within a rectangular region
 * @param {Uint8Array} grayscale - Grayscale image data
 * @param {number} width - Image width
 * @param {number} height - Image height
 * @param {Object} rect - Region {x, y, width, height}
 * @param {Object} options - Detection options
 * @returns {Array<{x, y, type}>} Array of edge points
 */
export const findEdgesInRegion = (grayscale, width, height, rect, options = {}) => {
  const {
    edgeThreshold = 128,
    step = 2  // Sample every N pixels
  } = options;
  
  const edges = [];
  const x1 = Math.max(0, rect.x);
  const y1 = Math.max(0, rect.y);
  const x2 = Math.min(width, rect.x + rect.width);
  const y2 = Math.min(height, rect.y + rect.height);
  
  // Scan horizontally
  for (let y = y1; y < y2; y += step) {
    let prevPixel = null;
    for (let x = x1; x < x2; x++) {
      const idx = y * width + x;
      const pixel = grayscale[idx];
      
      if (prevPixel !== null) {
        if ((prevPixel >= edgeThreshold && pixel < edgeThreshold) ||
            (prevPixel < edgeThreshold && pixel >= edgeThreshold)) {
          edges.push({ x, y, type: 'horizontal' });
        }
      }
      prevPixel = pixel;
    }
  }
  
  // Scan vertically
  for (let x = x1; x < x2; x += step) {
    let prevPixel = null;
    for (let y = y1; y < y2; y++) {
      const idx = y * width + x;
      const pixel = grayscale[idx];
      
      if (prevPixel !== null) {
        if ((prevPixel >= edgeThreshold && pixel < edgeThreshold) ||
            (prevPixel < edgeThreshold && pixel >= edgeThreshold)) {
          edges.push({ x, y, type: 'vertical' });
        }
      }
      prevPixel = pixel;
    }
  }
  
  return edges;
};
