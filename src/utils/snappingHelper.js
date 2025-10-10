// Constants for snapping behavior
export const SNAP_TO_LINE_DISTANCE = 5; // pixels
export const SNAP_TO_INTERSECTION_DISTANCE = 15; // pixels
export const SECONDARY_ALIGNMENT_DISTANCE = 10; // pixels

/**
 * Finds all intersection points from crossing horizontal and vertical wall lines.
 * @param {number[]} horizontalLines - Array of Y-coordinates for horizontal wall lines
 * @param {number[]} verticalLines - Array of X-coordinates for vertical wall lines
 * @returns {Array<{x: number, y: number}>} Array of all intersection points
 */
export const findAllIntersectionPoints = (horizontalLines, verticalLines) => {
  const intersections = [];
  
  if (!horizontalLines || !verticalLines) {
    return intersections;
  }

  // Create intersections at every crossing point
  for (const horizontalY of horizontalLines) {
    for (const verticalX of verticalLines) {
      intersections.push({ x: verticalX, y: horizontalY });
    }
  }

  return intersections;
};

/**
 * Finds the nearest intersection point to a given position within the snap distance.
 * @param {{x: number, y: number}} position - The current position to snap from
 * @param {Array<{x: number, y: number}>} intersections - List of available intersection points
 * @param {number} snapDistance - Maximum distance for snapping
 * @returns {{x: number, y: number}|null} The snapped position if found, otherwise null
 */
export const findNearestIntersection = (position, intersections, snapDistance) => {
  if (!intersections || intersections.length === 0) {
    return null;
  }

  let nearestIntersection = null;
  let minDistance = Infinity;

  for (const intersection of intersections) {
    const dx = position.x - intersection.x;
    const dy = position.y - intersection.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance < minDistance && distance <= snapDistance) {
      minDistance = distance;
      nearestIntersection = intersection;
    }
  }

  return nearestIntersection;
};

/**
 * Applies secondary alignment to nearby vertices after a vertex has been snapped.
 * Aligns other vertices that are within the alignment distance in either horizontal or vertical direction.
 * @param {Array<{x: number, y: number}>} points - The list of all perimeter points
 * @param {number} snappedIndex - The index of the vertex that was just snapped
 * @param {{x: number, y: number}} snappedPosition - The position the vertex was snapped to
 * @param {number} alignDistance - Maximum distance for secondary alignment
 */
export const applySecondaryAlignment = (points, snappedIndex, snappedPosition, alignDistance) => {
  if (!points || snappedIndex < 0 || snappedIndex >= points.length) {
    return;
  }

  // Check all other vertices for alignment opportunities
  for (let i = 0; i < points.length; i++) {
    // Skip the snapped vertex itself
    if (i === snappedIndex) {
      continue;
    }

    const point = points[i];
    let modified = false;
    let newX = point.x;
    let newY = point.y;

    // Check horizontal alignment (same Y coordinate)
    const verticalDistance = Math.abs(point.y - snappedPosition.y);
    if (verticalDistance <= alignDistance) {
      newY = snappedPosition.y;
      modified = true;
    }

    // Check vertical alignment (same X coordinate)
    const horizontalDistance = Math.abs(point.x - snappedPosition.x);
    if (horizontalDistance <= alignDistance) {
      newX = snappedPosition.x;
      modified = true;
    }

    // Update the point if it was aligned
    if (modified) {
      points[i] = { x: newX, y: newY };
    }
  }
};

/**
 * Snaps a value to the nearest line within threshold.
 * @param {number} value - The value to snap
 * @param {number[]} lines - Array of line positions
 * @param {number} threshold - Maximum distance for snapping
 * @returns {number|null} The snapped value if found, otherwise null
 */
export const snapToNearestLine = (value, lines, threshold) => {
  if (!lines || lines.length === 0) {
    return null;
  }

  let nearestLine = null;
  let minDistance = Infinity;

  for (const line of lines) {
    const distance = Math.abs(line - value);
    if (distance < minDistance && distance <= threshold) {
      minDistance = distance;
      nearestLine = line;
    }
  }

  return nearestLine;
};

/**
 * Snaps an edge (position and size) to the nearest wall lines.
 * @param {number} position - The starting position of the edge
 * @param {number} size - The size of the edge
 * @param {number[]} lines - Array of line positions to snap to
 * @param {number} threshold - Maximum distance for snapping
 * @param {number} direction - Direction of resize: -1 for start edge, +1 for end edge
 * @returns {{position: number, size: number}} The snapped position and size
 */
export const snapEdgeToLines = (position, size, lines, threshold, direction) => {
  let snappedPosition = position;
  let snappedSize = size;

  if (!lines || lines.length === 0) {
    return { position: snappedPosition, size: snappedSize };
  }

  // Snap the start edge (left or top)
  if (direction < 0) {
    const snappedPos = snapToNearestLine(position, lines, threshold);
    if (snappedPos !== null) {
      snappedSize += position - snappedPos;
      snappedPosition = snappedPos;
    }
  }

  // Snap the end edge (right or bottom)
  if (direction > 0) {
    const endEdge = position + size;
    const snappedEnd = snapToNearestLine(endEdge, lines, threshold);
    if (snappedEnd !== null) {
      snappedSize = snappedEnd - position;
    }
  }

  return { position: snappedPosition, size: snappedSize };
};
