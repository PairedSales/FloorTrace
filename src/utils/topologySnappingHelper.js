/**
 * topologySnappingHelper.js
 * Topology-based snapping to corners (junctions) and edges (wall segments)
 * Replaces old line-based snapping with graph-based snapping
 */

import { distance, pointToLineDistance, getOrientation } from './geometryUtils.js';

// Snap distances in pixels
export const SNAP_TO_CORNER_DISTANCE = 10;    // Snap to junction points
export const SNAP_TO_EDGE_DISTANCE = 8;       // Snap to wall edges
export const SECONDARY_ALIGNMENT_DISTANCE = 10; // Align nearby vertices

/**
 * Extract snap points from topology data
 * @param {Object} topologyData - Topology data from room/perimeter detection
 * @returns {Object} { corners, edges, walls }
 */
export function extractSnapPointsFromTopology(topologyData) {
  if (!topologyData) {
    return { corners: [], edges: [], walls: [] };
  }
  
  const corners = [];
  const edges = [];
  const walls = topologyData.walls || [];
  
  // Extract corners from graph junctions
  if (topologyData.graph && topologyData.graph.junctions) {
    for (const junction of topologyData.graph.junctions) {
      corners.push({
        x: junction.x,
        y: junction.y,
        type: junction.type,
        degree: junction.degree
      });
    }
  }
  
  // Also extract all graph nodes as potential corners
  if (topologyData.graph && topologyData.graph.nodes) {
    for (const node of topologyData.graph.nodes) {
      // Check if not already added as junction
      const alreadyAdded = corners.some(c => 
        Math.abs(c.x - node.x) < 1 && Math.abs(c.y - node.y) < 1
      );
      
      if (!alreadyAdded) {
        corners.push({
          x: node.x,
          y: node.y,
          type: 'node',
          degree: node.segments ? node.segments.length : 0
        });
      }
    }
  }
  
  // Extract edges from walls
  if (walls && walls.length > 0) {
    for (const wall of walls) {
      if (wall.chain) {
        edges.push({
          x1: wall.chain.x1,
          y1: wall.chain.y1,
          x2: wall.chain.x2,
          y2: wall.chain.y2,
          orientation: wall.orientation || getOrientation(wall.chain),
          wallId: wall.id,
          length: wall.length
        });
      }
    }
  }
  
  return { corners, edges, walls };
}

/**
 * Find nearest corner to snap to
 * @param {Object} position - Current position {x, y}
 * @param {Array} corners - Array of corner points
 * @param {number} snapDistance - Maximum snap distance
 * @returns {Object|null} Snapped position or null
 */
export function findNearestCorner(position, corners, snapDistance = SNAP_TO_CORNER_DISTANCE) {
  if (!corners || corners.length === 0) return null;
  
  let nearestCorner = null;
  let minDistance = Infinity;
  
  for (const corner of corners) {
    const dist = distance(position, corner);
    
    if (dist < minDistance && dist <= snapDistance) {
      minDistance = dist;
      nearestCorner = {
        x: corner.x,
        y: corner.y,
        snapType: 'corner',
        cornerType: corner.type,
        distance: dist
      };
    }
  }
  
  return nearestCorner;
}

/**
 * Find nearest edge to snap to
 * @param {Object} position - Current position {x, y}
 * @param {Array} edges - Array of wall edges
 * @param {number} snapDistance - Maximum snap distance
 * @returns {Object|null} Snapped position or null
 */
export function findNearestEdge(position, edges, snapDistance = SNAP_TO_EDGE_DISTANCE) {
  if (!edges || edges.length === 0) return null;
  
  let nearestEdge = null;
  let minDistance = Infinity;
  
  for (const edge of edges) {
    const dist = pointToLineDistance(position, edge);
    
    if (dist < minDistance && dist <= snapDistance) {
      minDistance = dist;
      
      // Calculate the snapped point on the edge
      const snappedPoint = projectPointOntoEdge(position, edge);
      
      nearestEdge = {
        x: snappedPoint.x,
        y: snappedPoint.y,
        snapType: 'edge',
        orientation: edge.orientation,
        wallId: edge.wallId,
        distance: dist
      };
    }
  }
  
  return nearestEdge;
}

/**
 * Project a point onto an edge (line segment)
 * @param {Object} point - Point to project
 * @param {Object} edge - Edge with x1, y1, x2, y2
 * @returns {Object} Projected point {x, y}
 */
function projectPointOntoEdge(point, edge) {
  const { x1, y1, x2, y2 } = edge;
  const { x, y } = point;
  
  const A = x - x1;
  const B = y - y1;
  const C = x2 - x1;
  const D = y2 - y1;
  
  const dot = A * C + B * D;
  const lenSq = C * C + D * D;
  
  if (lenSq === 0) return { x: x1, y: y1 };
  
  let param = dot / lenSq;
  
  // Clamp to line segment
  param = Math.max(0, Math.min(1, param));
  
  return {
    x: x1 + param * C,
    y: y1 + param * D
  };
}

/**
 * Find the best snap point (corner or edge) with priority to corners
 * @param {Object} position - Current position {x, y}
 * @param {Object} snapData - { corners, edges }
 * @param {Object} options - { cornerDistance, edgeDistance, disableSnapping }
 * @returns {Object|null} Best snap point or null
 */
export function findBestSnapPoint(position, snapData, options = {}) {
  const {
    cornerDistance = SNAP_TO_CORNER_DISTANCE,
    edgeDistance = SNAP_TO_EDGE_DISTANCE,
    disableSnapping = false
  } = options;
  
  // If snapping is disabled (e.g., Ctrl key held), return null
  if (disableSnapping) return null;
  
  const { corners = [], edges = [] } = snapData;
  
  // Priority 1: Snap to corners (higher priority)
  const cornerSnap = findNearestCorner(position, corners, cornerDistance);
  
  // Priority 2: Snap to edges (lower priority, only if no corner nearby)
  const edgeSnap = findNearestEdge(position, edges, edgeDistance);
  
  // If both found, prefer corner (closer to actual geometry)
  if (cornerSnap && edgeSnap) {
    // Prefer corner if distances are similar
    if (cornerSnap.distance <= edgeSnap.distance * 1.2) {
      return cornerSnap;
    }
    return edgeSnap;
  }
  
  // Return whichever was found
  return cornerSnap || edgeSnap;
}

/**
 * Apply secondary alignment to nearby vertices
 * Aligns vertices that are close in horizontal or vertical direction
 * @param {Array} points - Array of points
 * @param {number} snappedIndex - Index of snapped point
 * @param {Object} snappedPosition - Snapped position {x, y}
 * @param {number} alignDistance - Alignment distance
 */
export function applySecondaryAlignment(points, snappedIndex, snappedPosition, alignDistance = SECONDARY_ALIGNMENT_DISTANCE) {
  if (!points || snappedIndex < 0 || snappedIndex >= points.length) {
    return;
  }
  
  // Check all other vertices for alignment opportunities
  for (let i = 0; i < points.length; i++) {
    if (i === snappedIndex) continue;
    
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
}

/**
 * Get snapping visual feedback data for rendering
 * @param {Object} snapPoint - Snap point returned from findBestSnapPoint
 * @returns {Object} Visual feedback data
 */
export function getSnapVisualFeedback(snapPoint) {
  if (!snapPoint) return null;
  
  return {
    position: { x: snapPoint.x, y: snapPoint.y },
    type: snapPoint.snapType,
    color: snapPoint.snapType === 'corner' ? '#FF6B6B' : '#4ECDC4',
    radius: snapPoint.snapType === 'corner' ? 6 : 4,
    label: snapPoint.snapType === 'corner' 
      ? `Corner (${snapPoint.cornerType})`
      : `Edge (${snapPoint.orientation})`
  };
}

/**
 * Backward compatibility: find nearest intersection (now uses corners)
 * @param {Object} position - Position to snap from
 * @param {Array} corners - Array of corner points (or old-style intersections)
 * @param {number} snapDistance - Snap distance
 * @returns {Object|null} Snapped position or null
 */
export function findNearestIntersection(position, corners, snapDistance) {
  return findNearestCorner(position, corners, snapDistance);
}
