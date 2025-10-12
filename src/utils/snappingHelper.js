/**
 * Vertex Snapping Helper
 * Direct translation of FloorTrace-NET snapping system
 * Provides vertex-to-intersection snapping and secondary alignment
 */

// Snap distances in pixels (from .NET Constants)
export const SNAP_TO_INTERSECTION_DISTANCE = 10;
export const SECONDARY_ALIGNMENT_DISTANCE = 10;

/**
 * Finds all intersection points from crossing horizontal and vertical wall lines.
 * @param {Array<number>} horizontalLines - List of Y-coordinates for horizontal wall lines
 * @param {Array<number>} verticalLines - List of X-coordinates for vertical wall lines
 * @returns {Array<{x: number, y: number}>} List of all intersection points
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
 * @returns {{x: number, y: number}|null} The snapped position if an intersection is found within snap distance, otherwise null
 */
export const findNearestIntersection = (position, intersections, snapDistance) => {
  if (!intersections || intersections.length === 0) {
    return null;
  }

  let nearestIntersection = null;
  let minDistance = Number.MAX_VALUE;

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
 * @returns {Array<{x: number, y: number}>} Modified points array with aligned vertices
 */
export const applySecondaryAlignment = (points, snappedIndex, snappedPosition, alignDistance) => {
  if (!points || snappedIndex < 0 || snappedIndex >= points.length) {
    return points;
  }

  // Create a copy to avoid mutation
  const newPoints = [...points];

  // Check all other vertices for alignment opportunities
  for (let i = 0; i < newPoints.length; i++) {
    // Skip the snapped vertex itself
    if (i === snappedIndex) {
      continue;
    }

    const point = newPoints[i];
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
      newPoints[i] = { x: newX, y: newY };
    }
  }

  return newPoints;
};
