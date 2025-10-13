/**
 * Utility class for snapping vertices to wall line intersection points and aligning nearby vertices.
 * Line-by-line port from FloorTrace-NET\Utilities\SnappingHelper.cs
 */

// Snap distances in pixels (from Constants.cs)
export const SNAP_TO_INTERSECTION_DISTANCE = 10; // Distance in pixels to snap to intersection points
export const SECONDARY_ALIGNMENT_DISTANCE = 10; // Distance in pixels to align nearby vertices

// Backwards compatibility aliases
export const SNAP_TO_CORNER_DISTANCE = SNAP_TO_INTERSECTION_DISTANCE;

/**
 * Finds all intersection points from crossing horizontal and vertical wall lines.
 * Line-by-line port from SnappingHelper.cs:FindAllIntersectionPoints
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
 * Line-by-line port from SnappingHelper.cs:FindNearestIntersection
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
 * Line-by-line port from SnappingHelper.cs:ApplySecondaryAlignment
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
