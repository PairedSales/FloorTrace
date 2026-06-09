/**
 * Centralized geometry validation utility for FloorTrace perimeter operations.
 * Enforces strict simple polygon invariants:
 *  - No edge crossings
 *  - No overlapping collinear edges
 *  - No duplicate non-adjacent vertices
 *  - No zero-length edges
 *  - Adjacent shared endpoints only
 */

const EPSILON = 1e-5;
const EPSILON_SQ = EPSILON * EPSILON;

/**
 * Computes the orientation of the ordered triplet (p, q, r).
 * Returns:
 *  0 -> Collinear
 *  1 -> Clockwise (visually in Y-down screen coordinates)
 *  2 -> Counterclockwise (visually in Y-down screen coordinates)
 */
export function getOrientation(p, q, r) {
  const val = (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y);
  if (Math.abs(val) < 1e-9) {
    return 0; // Collinear
  }
  return val < 0 ? 1 : 2; // In Y-down: val < 0 is Clockwise, val > 0 is Counterclockwise
}

/**
 * Checks if point q lies on line segment pr (assuming they are collinear).
 */
export function onSegment(p, q, r) {
  return (
    q.x <= Math.max(p.x, r.x) + 1e-9 &&
    q.x >= Math.min(p.x, r.x) - 1e-9 &&
    q.y <= Math.max(p.y, r.y) + 1e-9 &&
    q.y >= Math.min(p.y, r.y) - 1e-9
  );
}

/**
 * Checks if two line segments p1q1 and p2q2 intersect.
 */
export function segmentsIntersect(p1, q1, p2, q2) {
  const o1 = getOrientation(p1, q1, p2);
  const o2 = getOrientation(p1, q1, q2);
  const o3 = getOrientation(p2, q2, p1);
  const o4 = getOrientation(p2, q2, q1);

  // General Case
  if (o1 !== o2 && o3 !== o4) {
    return true;
  }

  // Collinear Overlapping Special Cases
  if (o1 === 0 && onSegment(p1, p2, q1)) return true;
  if (o2 === 0 && onSegment(p1, q2, q1)) return true;
  if (o3 === 0 && onSegment(p2, p1, q2)) return true;
  if (o4 === 0 && onSegment(p2, q1, q2)) return true;

  return false;
}

/**
 * Helper to check if adjacent segments AB and BC (sharing B) overlap collinearly.
 * AB and BC overlap if they are collinear and point in the same direction from B.
 */
function checkAdjacentOverlap(A, B, C) {
  const v1 = { x: A.x - B.x, y: A.y - B.y };
  const v2 = { x: C.x - B.x, y: C.y - B.y };
  const cross = v1.x * v2.y - v1.y * v2.x;
  const dot = v1.x * v2.x + v1.y * v2.y;
  return Math.abs(cross) < 1e-9 && dot > 0;
}

/**
 * Performs a full O(n^2) simplicity check on a polygon.
 * Ensures no edge crossings, no collinear overlaps, no zero-length edges,
 * and no duplicate non-adjacent vertices.
 */
export function hasSelfIntersection(vertices, isClosed = true) {
  if (!vertices || vertices.length < 3) return false;
  if (!isClosed && vertices.length < 4) {
    // Check coincident vertices for a small open path
    const N = vertices.length;
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        const dx = vertices[i].x - vertices[j].x;
        const dy = vertices[i].y - vertices[j].y;
        if (dx * dx + dy * dy < EPSILON_SQ) {
          return true; // Zero-length edge or duplicate
        }
      }
    }
    // Check collinear overlap of V0-V1-V2
    if (N === 3) {
      if (checkAdjacentOverlap(vertices[0], vertices[1], vertices[2])) {
        return true;
      }
    }
    return false;
  }

  const N = vertices.length;

  // 1. Check for zero-length edges and duplicate vertices
  for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < N; j++) {
      const dx = vertices[i].x - vertices[j].x;
      const dy = vertices[i].y - vertices[j].y;
      if (dx * dx + dy * dy < EPSILON_SQ) {
        return true; // Coincident vertices
      }
    }
  }

  // 2. Build edge list
  const edges = [];
  const numEdges = isClosed ? N : N - 1;
  for (let i = 0; i < numEdges; i++) {
    edges.push({
      start: vertices[i],
      end: vertices[(i + 1) % N],
      startIndex: i,
      endIndex: (i + 1) % N,
    });
  }

  // 3. Check all pairs of edges
  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      const e1 = edges[i];
      const e2 = edges[j];

      // Determine adjacency
      const isAdj = isClosed
        ? (j === i + 1) || (i === 0 && j === edges.length - 1)
        : (j === i + 1);

      if (isAdj) {
        // Find the shared vertex
        let A, B, C; // B is the shared vertex
        if (e1.endIndex === e2.startIndex) {
          A = e1.start; B = e1.end; C = e2.end;
        } else if (e1.startIndex === e2.endIndex) {
          A = e1.end; B = e1.start; C = e2.start;
        } else if (e1.startIndex === e2.startIndex) {
          A = e1.end; B = e1.start; C = e2.end;
        } else {
          A = e1.start; B = e1.end; C = e2.start;
        }

        if (checkAdjacentOverlap(A, B, C)) {
          return true; // Collinear overlapping adjacent edges
        }
      } else {
        // Non-adjacent edges must not intersect
        if (segmentsIntersect(e1.start, e1.end, e2.start, e2.end)) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Performs an incremental O(n) simplicity check for a single vertex modification.
 * Used during mousemove dragging to maintain 60fps performance.
 * Checks only the edges connected to the modified vertex against the rest of the polygon.
 */
export function validateVertexMove(vertices, dragIndex, newPoint, isClosed = true) {
  if (!vertices || vertices.length < 3) return true;
  const N = vertices.length;

  // 1. Distance checks (No zero-length edges and no duplicate vertices)
  for (let i = 0; i < N; i++) {
    if (i === dragIndex) continue;
    const dx = vertices[i].x - newPoint.x;
    const dy = vertices[i].y - newPoint.y;
    if (dx * dx + dy * dy < EPSILON_SQ) {
      return false; // Point is too close to another vertex
    }
  }

  // 2. Define the two changed segments
  const prevIdx = (dragIndex - 1 + N) % N;
  const nextIdx = (dragIndex + 1) % N;

  const hasPrevSeg = isClosed || dragIndex > 0;
  const hasNextSeg = isClosed || dragIndex < N - 1;

  const prevSeg = hasPrevSeg ? { start: vertices[prevIdx], end: newPoint } : null;
  const nextSeg = hasNextSeg ? { start: newPoint, end: vertices[nextIdx] } : null;

  // 3. If both segments exist, they are adjacent at newPoint. Check if they overlap.
  if (prevSeg && nextSeg) {
    if (checkAdjacentOverlap(prevSeg.start, newPoint, nextSeg.end)) {
      return false;
    }
  }

  // 4. Compare changed segments against all other edges of the polygon
  const numEdges = isClosed ? N : N - 1;
  for (let i = 0; i < numEdges; i++) {
    const idx1 = i;
    const idx2 = (i + 1) % N;

    // Skip checking edges that involve dragIndex since we are replacing them
    if (idx1 === dragIndex || idx2 === dragIndex) {
      continue;
    }

    const otherStart = vertices[idx1];
    const otherEnd = vertices[idx2];

    // Compare with prevSeg
    if (prevSeg) {
      const isAdjacentToPrev = (idx1 === prevIdx) || (idx2 === prevIdx);
      if (isAdjacentToPrev) {
        const A = (idx1 === prevIdx) ? otherEnd : otherStart;
        const B = vertices[prevIdx];
        const C = newPoint;
        if (checkAdjacentOverlap(A, B, C)) {
          return false;
        }
      } else {
        if (segmentsIntersect(prevSeg.start, prevSeg.end, otherStart, otherEnd)) {
          return false;
        }
      }
    }

    // Compare with nextSeg
    if (nextSeg) {
      const isAdjacentToNext = (idx1 === nextIdx) || (idx2 === nextIdx);
      if (isAdjacentToNext) {
        const A = newPoint;
        const B = vertices[nextIdx];
        const C = (idx1 === nextIdx) ? otherEnd : otherStart;
        if (checkAdjacentOverlap(A, B, C)) {
          return false;
        }
      } else {
        if (segmentsIntersect(nextSeg.start, nextSeg.end, otherStart, otherEnd)) {
          return false;
        }
      }
    }
  }

  return true;
}

/**
 * Determines the winding order of the polygon.
 * Uses the signed Shoelace area.
 * Returns: 'CW' (visually clockwise in Y-down), 'CCW' (counterclockwise), or 'degenerate'.
 */
export function getPolygonWinding(vertices) {
  if (!vertices || vertices.length < 3) return 'degenerate';
  let sum = 0;
  const N = vertices.length;
  for (let i = 0; i < N; i++) {
    const v1 = vertices[i];
    const v2 = vertices[(i + 1) % N];
    sum += (v2.x - v1.x) * (v2.y + v1.y);
  }
  if (Math.abs(sum) < 1e-5) {
    return 'degenerate';
  }
  return sum < 0 ? 'CW' : 'CCW'; // In Y-down: negative sum is Clockwise, positive is Counterclockwise
}

/**
 * Normalizes the winding order of a polygon to a target winding (defaults to 'CCW').
 * Reverses the vertices if the winding does not match the target.
 */
export function normalizePolygonWinding(vertices, targetWinding = 'CCW') {
  if (!vertices || vertices.length < 3) return [...vertices];
  const currentWinding = getPolygonWinding(vertices);
  if (currentWinding === 'degenerate' || currentWinding === targetWinding) {
    return [...vertices];
  }
  return [...vertices].reverse();
}
