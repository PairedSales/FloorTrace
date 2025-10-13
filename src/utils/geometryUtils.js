/**
 * geometryUtils.js
 * Core geometric utility functions for line segment analysis
 */

/**
 * Calculate Euclidean distance between two points
 * @param {Object} p1 - Point with x, y coordinates
 * @param {Object} p2 - Point with x, y coordinates
 * @returns {number} Distance between points
 */
export function distance(p1, p2) {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Calculate the length of a line segment
 * @param {Object} line - Line with x1, y1, x2, y2
 * @returns {number} Length of the line
 */
export function lineLength(line) {
  return distance({ x: line.x1, y: line.y1 }, { x: line.x2, y: line.y2 });
}

/**
 * Calculate angle of a line segment in radians (-PI to PI)
 * @param {Object} line - Line with x1, y1, x2, y2
 * @returns {number} Angle in radians
 */
export function lineAngle(line) {
  return Math.atan2(line.y2 - line.y1, line.x2 - line.x1);
}

/**
 * Calculate angle of a line segment in degrees (0 to 360)
 * @param {Object} line - Line with x1, y1, x2, y2
 * @returns {number} Angle in degrees
 */
export function lineAngleDegrees(line) {
  let angle = (Math.atan2(line.y2 - line.y1, line.x2 - line.x1) * 180) / Math.PI;
  if (angle < 0) angle += 360;
  return angle;
}

/**
 * Calculate the absolute angle difference between two lines (0 to 90 degrees)
 * Normalized to account for parallel lines in opposite directions
 * @param {Object} line1 - First line
 * @param {Object} line2 - Second line
 * @returns {number} Angle difference in degrees (0-90)
 */
export function angleBetween(line1, line2) {
  const angle1 = lineAngle(line1);
  const angle2 = lineAngle(line2);
  
  let diff = Math.abs(angle1 - angle2) * (180 / Math.PI);
  
  // Normalize to 0-180
  if (diff > 180) diff = 360 - diff;
  
  // Normalize to 0-90 (parallel lines can point opposite directions)
  if (diff > 90) diff = 180 - diff;
  
  return diff;
}

/**
 * Calculate perpendicular distance from a point to a line
 * @param {Object} point - Point with x, y
 * @param {Object} line - Line with x1, y1, x2, y2
 * @returns {number} Perpendicular distance
 */
export function pointToLineDistance(point, line) {
  const { x1, y1, x2, y2 } = line;
  const { x, y } = point;
  
  const A = x - x1;
  const B = y - y1;
  const C = x2 - x1;
  const D = y2 - y1;
  
  const dot = A * C + B * D;
  const lenSq = C * C + D * D;
  
  let param = -1;
  if (lenSq !== 0) param = dot / lenSq;
  
  let xx, yy;
  
  if (param < 0) {
    xx = x1;
    yy = y1;
  } else if (param > 1) {
    xx = x2;
    yy = y2;
  } else {
    xx = x1 + param * C;
    yy = y1 + param * D;
  }
  
  const dx = x - xx;
  const dy = y - yy;
  
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Check if two lines are collinear (parallel and aligned)
 * @param {Object} line1 - First line
 * @param {Object} line2 - Second line
 * @param {Object} options - Configuration
 * @param {number} options.angleTolerance - Max angle difference in degrees (default: 5)
 * @param {number} options.distanceTolerance - Max perpendicular distance (default: 10)
 * @returns {boolean} True if collinear
 */
export function isCollinear(line1, line2, options = {}) {
  const { angleTolerance = 5, distanceTolerance = 10 } = options;
  
  // Check angle similarity
  const angleDiff = angleBetween(line1, line2);
  if (angleDiff > angleTolerance) return false;
  
  // Check if endpoints of line2 are close to line1
  const p1 = { x: line2.x1, y: line2.y1 };
  const p2 = { x: line2.x2, y: line2.y2 };
  
  const dist1 = pointToLineDistance(p1, line1);
  const dist2 = pointToLineDistance(p2, line1);
  
  return dist1 <= distanceTolerance && dist2 <= distanceTolerance;
}

/**
 * Check if two line segments are parallel
 * @param {Object} line1 - First line
 * @param {Object} line2 - Second line
 * @param {number} tolerance - Max angle difference in degrees (default: 5)
 * @returns {boolean} True if parallel
 */
export function isParallel(line1, line2, tolerance = 5) {
  return angleBetween(line1, line2) <= tolerance;
}

/**
 * Get the endpoints of a line as point objects
 * @param {Object} line - Line with x1, y1, x2, y2
 * @returns {Array} Array of two point objects [{x, y}, {x, y}]
 */
export function getEndpoints(line) {
  return [
    { x: line.x1, y: line.y1 },
    { x: line.x2, y: line.y2 }
  ];
}

/**
 * Find the closest pair of endpoints between two lines
 * @param {Object} line1 - First line
 * @param {Object} line2 - Second line
 * @returns {Object} { point1, point2, distance }
 */
export function closestEndpoints(line1, line2) {
  const endpoints1 = getEndpoints(line1);
  const endpoints2 = getEndpoints(line2);
  
  let minDist = Infinity;
  let closest = null;
  
  for (const p1 of endpoints1) {
    for (const p2 of endpoints2) {
      const dist = distance(p1, p2);
      if (dist < minDist) {
        minDist = dist;
        closest = { point1: p1, point2: p2, distance: dist };
      }
    }
  }
  
  return closest;
}

/**
 * Check if two line segments share an endpoint (within tolerance)
 * @param {Object} line1 - First line
 * @param {Object} line2 - Second line
 * @param {number} tolerance - Distance tolerance (default: 3)
 * @returns {boolean} True if they share an endpoint
 */
export function sharesEndpoint(line1, line2, tolerance = 3) {
  const closest = closestEndpoints(line1, line2);
  return closest.distance <= tolerance;
}

/**
 * Determine orientation of a line
 * @param {Object} line - Line with x1, y1, x2, y2
 * @param {number} threshold - Angle threshold for horizontal/vertical (default: 15 degrees)
 * @returns {string} "horizontal", "vertical", or "diagonal"
 */
export function getOrientation(line, threshold = 15) {
  const angle = Math.abs(lineAngleDegrees(line));
  
  // Horizontal: 0°, 180°, 360°
  if (angle < threshold || angle > (180 - threshold) && angle < (180 + threshold) || angle > (360 - threshold)) {
    return "horizontal";
  }
  
  // Vertical: 90°, 270°
  if (angle > (90 - threshold) && angle < (90 + threshold) || angle > (270 - threshold) && angle < (270 + threshold)) {
    return "vertical";
  }
  
  return "diagonal";
}

/**
 * Compute the midpoint of a line segment
 * @param {Object} line - Line with x1, y1, x2, y2
 * @returns {Object} Point {x, y}
 */
export function midpoint(line) {
  return {
    x: (line.x1 + line.x2) / 2,
    y: (line.y1 + line.y2) / 2
  };
}

/**
 * Extend a line segment by a certain distance at both ends
 * @param {Object} line - Line with x1, y1, x2, y2
 * @param {number} distance - Distance to extend
 * @returns {Object} Extended line
 */
export function extendLine(line, distance) {
  const len = lineLength(line);
  if (len === 0) return { ...line };
  
  const ratio = distance / len;
  const dx = (line.x2 - line.x1) * ratio;
  const dy = (line.y2 - line.y1) * ratio;
  
  return {
    x1: line.x1 - dx,
    y1: line.y1 - dy,
    x2: line.x2 + dx,
    y2: line.y2 + dy
  };
}

/**
 * Check if a point lies on or very close to a line segment
 * @param {Object} point - Point with x, y
 * @param {Object} line - Line with x1, y1, x2, y2
 * @param {number} tolerance - Distance tolerance (default: 5)
 * @returns {boolean} True if point is on the line
 */
export function isPointOnLine(point, line, tolerance = 5) {
  return pointToLineDistance(point, line) <= tolerance;
}

/**
 * Compute bounding box of a line segment
 * @param {Object} line - Line with x1, y1, x2, y2
 * @returns {Object} { minX, minY, maxX, maxY }
 */
export function lineBounds(line) {
  return {
    minX: Math.min(line.x1, line.x2),
    minY: Math.min(line.y1, line.y2),
    maxX: Math.max(line.x1, line.x2),
    maxY: Math.max(line.y1, line.y2)
  };
}

/**
 * Check if two line bounding boxes overlap (with margin)
 * @param {Object} line1 - First line
 * @param {Object} line2 - Second line
 * @param {number} margin - Additional margin (default: 10)
 * @returns {boolean} True if bounding boxes overlap
 */
export function boundsOverlap(line1, line2, margin = 10) {
  const b1 = lineBounds(line1);
  const b2 = lineBounds(line2);
  
  return !(
    b1.maxX + margin < b2.minX ||
    b2.maxX + margin < b1.minX ||
    b1.maxY + margin < b2.minY ||
    b2.maxY + margin < b1.minY
  );
}

/**
 * Normalize line direction (ensure x1 <= x2, or if vertical, y1 <= y2)
 * @param {Object} line - Line with x1, y1, x2, y2
 * @returns {Object} Normalized line
 */
export function normalizeLine(line) {
  if (line.x1 < line.x2) return { ...line };
  if (line.x1 > line.x2) return { x1: line.x2, y1: line.y2, x2: line.x1, y2: line.y1 };
  // Vertical line: order by y
  if (line.y1 <= line.y2) return { ...line };
  return { x1: line.x2, y1: line.y2, x2: line.x1, y2: line.y1 };
}

/**
 * Calculate the projection of a point onto a line (infinite line)
 * @param {Object} point - Point with x, y
 * @param {Object} line - Line with x1, y1, x2, y2
 * @returns {Object} Projected point {x, y}
 */
export function projectPointOnLine(point, line) {
  const { x1, y1, x2, y2 } = line;
  const { x, y } = point;
  
  const A = x - x1;
  const B = y - y1;
  const C = x2 - x1;
  const D = y2 - y1;
  
  const dot = A * C + B * D;
  const lenSq = C * C + D * D;
  
  if (lenSq === 0) return { x: x1, y: y1 };
  
  const param = dot / lenSq;
  
  return {
    x: x1 + param * C,
    y: y1 + param * D
  };
}

/**
 * Snap a point to the nearest endpoint if within tolerance
 * @param {Object} point - Point with x, y
 * @param {Object} line - Line with x1, y1, x2, y2
 * @param {number} tolerance - Distance tolerance (default: 5)
 * @returns {Object} Snapped point or original point
 */
export function snapToEndpoint(point, line, tolerance = 5) {
  const endpoints = getEndpoints(line);
  
  for (const endpoint of endpoints) {
    if (distance(point, endpoint) <= tolerance) {
      return endpoint;
    }
  }
  
  return point;
}

/**
 * Average two points
 * @param {Object} p1 - First point
 * @param {Object} p2 - Second point
 * @returns {Object} Average point {x, y}
 */
export function averagePoints(p1, p2) {
  return {
    x: (p1.x + p2.x) / 2,
    y: (p1.y + p2.y) / 2
  };
}
