/**
 * lineMerging.js
 * Topology-guided merging of line segments into wall chains
 */

import {
  distance,
  angleBetween,
  isCollinear,
  getEndpoints,
  closestEndpoints,
  lineLength,
  lineAngle,
  getOrientation,
  midpoint,
  averagePoints,
  normalizeLine
} from './geometryUtils.js';

import {
  getNeighbors,
  getNodeEdges,
  areBridgeable
} from './topologyGraph.js';

/**
 * Merge connected and collinear segments into wall chains
 * @param {Array} segments - Array of line segments
 * @param {Object} graph - Topology graph
 * @param {Object} options - Merge options
 * @param {number} options.angleTolerance - Max angle difference for merging (default: 5)
 * @param {number} options.gapTolerance - Max gap to bridge (default: 8)
 * @param {boolean} options.mergeCollinear - Merge collinear segments (default: true)
 * @param {boolean} options.snapEndpoints - Snap nearby endpoints (default: true)
 * @returns {Array} Array of merged wall chains
 */
export function mergeLines(segments, graph, options = {}) {
  const {
    angleTolerance = 5,
    gapTolerance = 8,
    mergeCollinear = true,
    snapEndpoints = true
  } = options;
  
  const visited = new Set();
  const chains = [];
  
  // Process each edge in the graph
  graph.edges.forEach((edge, edgeIdx) => {
    if (visited.has(edgeIdx)) return;
    
    // Start a new chain
    const chain = traverseChain(
      edgeIdx,
      edge,
      segments,
      graph,
      visited,
      { angleTolerance, gapTolerance, mergeCollinear }
    );
    
    if (chain && chain.segments.length > 0) {
      chains.push(chain);
    }
  });
  
  // Post-process chains
  const mergedChains = postProcessChains(chains, { snapEndpoints, gapTolerance });
  
  return mergedChains;
}

/**
 * Traverse and build a chain starting from an edge
 * @param {number} startEdgeIdx - Starting edge index
 * @param {Object} startEdge - Starting edge object
 * @param {Array} segments - All segments
 * @param {Object} graph - Topology graph
 * @param {Set} visited - Visited edges
 * @param {Object} options - Traversal options
 * @returns {Object} Chain object
 */
function traverseChain(startEdgeIdx, startEdge, segments, graph, visited, options) {
  const { angleTolerance, gapTolerance, mergeCollinear } = options;
  
  const chainSegments = [];
  const chainEdges = [];
  
  // Traverse in both directions from the starting edge
  const forwardChain = traverseDirection(
    startEdgeIdx,
    startEdge,
    'forward',
    segments,
    graph,
    visited,
    { angleTolerance, gapTolerance, mergeCollinear }
  );
  
  const backwardChain = traverseDirection(
    startEdgeIdx,
    startEdge,
    'backward',
    segments,
    graph,
    visited,
    { angleTolerance, gapTolerance, mergeCollinear }
  );
  
  // Combine chains (backward is reversed, then start edge, then forward)
  const allSegments = [
    ...backwardChain.reverse(),
    startEdge.segment,
    ...forwardChain
  ];
  
  // Mark as visited
  visited.add(startEdgeIdx);
  
  // Compute merged line from all segments
  const mergedLine = computeMergedLine(allSegments);
  
  return {
    id: `chain_${startEdgeIdx}`,
    segments: allSegments,
    merged: mergedLine,
    orientation: getOrientation(mergedLine),
    length: mergedLine.length,
    confidence: computeConfidence(allSegments, mergedLine)
  };
}

/**
 * Traverse in one direction from a starting edge
 * @param {number} edgeIdx - Current edge index
 * @param {Object} edge - Current edge
 * @param {string} direction - 'forward' or 'backward'
 * @param {Array} segments - All segments
 * @param {Object} graph - Topology graph
 * @param {Set} visited - Visited edges
 * @param {Object} options - Options
 * @returns {Array} Array of segments in this direction
 */
function traverseDirection(edgeIdx, edge, direction, segments, graph, visited, options) {
  const { angleTolerance, gapTolerance, mergeCollinear } = options;
  const chain = [];
  
  let currentEdge = edge;
  let currentNode = direction === 'forward' ? edge.endNode : edge.startNode;
  
  while (true) {
    // Get edges connected to current node
    const connectedEdges = getNodeEdges(graph, currentNode);
    
    // Find the best continuation edge
    let bestEdge = null;
    let bestScore = -1;
    
    for (const connEdge of connectedEdges) {
      const connEdgeIdx = graph.edges.indexOf(connEdge);
      
      // Skip if already visited
      if (visited.has(connEdgeIdx)) continue;
      
      // Skip if it's the current edge
      if (connEdge === currentEdge) continue;
      
      // Check if this edge continues the chain
      const score = scoreEdgeContinuation(
        currentEdge.segment,
        connEdge.segment,
        { angleTolerance, gapTolerance, mergeCollinear }
      );
      
      if (score > bestScore) {
        bestScore = score;
        bestEdge = connEdge;
      }
    }
    
    // If no good continuation, stop
    if (!bestEdge || bestScore <= 0) break;
    
    // Add to chain
    chain.push(bestEdge.segment);
    visited.add(graph.edges.indexOf(bestEdge));
    
    // Move to next node
    currentEdge = bestEdge;
    currentNode = bestEdge.startNode === currentNode ? bestEdge.endNode : bestEdge.startNode;
  }
  
  return chain;
}

/**
 * Score how well an edge continues a chain
 * @param {Object} currentSeg - Current segment
 * @param {Object} candidateSeg - Candidate segment
 * @param {Object} options - Scoring options
 * @returns {number} Score (higher is better, 0 or negative means no continuation)
 */
function scoreEdgeContinuation(currentSeg, candidateSeg, options) {
  const { angleTolerance, gapTolerance, mergeCollinear } = options;
  
  // Check angle similarity
  const angle = angleBetween(currentSeg, candidateSeg);
  if (angle > angleTolerance) return 0;
  
  // Check gap
  const closest = closestEndpoints(currentSeg, candidateSeg);
  if (closest.distance > gapTolerance) return 0;
  
  // Check collinearity if required
  if (mergeCollinear && !isCollinear(currentSeg, candidateSeg, { angleTolerance, distanceTolerance: 10 })) {
    return 0;
  }
  
  // Compute score (lower angle and gap = higher score)
  const angleScore = 1 - (angle / angleTolerance);
  const gapScore = 1 - (closest.distance / gapTolerance);
  
  return (angleScore + gapScore) / 2;
}

/**
 * Compute a merged line from a sequence of segments
 * @param {Array} segments - Array of segments to merge
 * @returns {Object} Merged line with x1, y1, x2, y2, length, angle
 */
function computeMergedLine(segments) {
  if (segments.length === 0) {
    return null;
  }
  
  if (segments.length === 1) {
    const seg = segments[0];
    return {
      x1: seg.x1,
      y1: seg.y1,
      x2: seg.x2,
      y2: seg.y2,
      length: lineLength(seg),
      angle: lineAngle(seg)
    };
  }
  
  // Collect all endpoints
  const allEndpoints = segments.flatMap(seg => getEndpoints(seg));
  
  // Find the two most distant points (extremes of the chain)
  let maxDist = 0;
  let p1 = allEndpoints[0];
  let p2 = allEndpoints[1];
  
  for (let i = 0; i < allEndpoints.length; i++) {
    for (let j = i + 1; j < allEndpoints.length; j++) {
      const dist = distance(allEndpoints[i], allEndpoints[j]);
      if (dist > maxDist) {
        maxDist = dist;
        p1 = allEndpoints[i];
        p2 = allEndpoints[j];
      }
    }
  }
  
  // Use weighted average for fine-tuning (average angle)
  const avgAngle = segments.reduce((sum, seg) => sum + lineAngle(seg), 0) / segments.length;
  
  const merged = {
    x1: p1.x,
    y1: p1.y,
    x2: p2.x,
    y2: p2.y,
    length: distance(p1, p2),
    angle: avgAngle
  };
  
  return normalizeLine(merged);
}

/**
 * Compute confidence score for a chain
 * @param {Array} segments - Segments in the chain
 * @param {Object} mergedLine - The merged line
 * @returns {number} Confidence score (0-1)
 */
function computeConfidence(segments, mergedLine) {
  if (segments.length === 0) return 0;
  if (segments.length === 1) return 0.8;
  
  // Factors:
  // 1. Number of segments (more = higher confidence)
  // 2. Angle consistency
  // 3. Gap consistency
  
  const segmentCountScore = Math.min(segments.length / 5, 1) * 0.4;
  
  // Angle consistency
  const angles = segments.map(s => lineAngle(s));
  const avgAngle = angles.reduce((a, b) => a + b, 0) / angles.length;
  const angleVariance = angles.reduce((sum, a) => sum + Math.abs(a - avgAngle), 0) / angles.length;
  const angleScore = Math.max(0, 1 - angleVariance * 10) * 0.4;
  
  // Coverage (how much of merged line is covered by segments)
  const totalSegLength = segments.reduce((sum, s) => sum + lineLength(s), 0);
  const coverageScore = Math.min(totalSegLength / mergedLine.length, 1) * 0.2;
  
  return segmentCountScore + angleScore + coverageScore;
}

/**
 * Post-process chains: snap endpoints, merge nearby chains, etc.
 * @param {Array} chains - Array of chain objects
 * @param {Object} options - Options
 * @returns {Array} Processed chains
 */
function postProcessChains(chains, options) {
  const { snapEndpoints, gapTolerance } = options;
  
  let processed = [...chains];
  
  // Snap endpoints if enabled
  if (snapEndpoints) {
    processed = processed.map(chain => snapChainEndpoints(chain, gapTolerance));
  }
  
  // Merge overlapping or adjacent chains
  processed = mergeAdjacentChains(processed, gapTolerance);
  
  // Assign unique IDs
  processed = processed.map((chain, idx) => ({
    ...chain,
    id: `wall_${idx}`
  }));
  
  return processed;
}

/**
 * Snap chain endpoints to nearby endpoints in the same chain
 * @param {Object} chain - Chain object
 * @param {number} tolerance - Snap tolerance
 * @returns {Object} Chain with snapped endpoints
 */
function snapChainEndpoints(chain, tolerance) {
  const merged = chain.merged;
  const segments = chain.segments;
  
  // Find all endpoints near the merged line endpoints
  const start = { x: merged.x1, y: merged.y1 };
  const end = { x: merged.x2, y: merged.y2 };
  
  const allEndpoints = segments.flatMap(seg => getEndpoints(seg));
  
  // Find endpoints near start
  const nearStart = allEndpoints.filter(p => distance(p, start) <= tolerance);
  if (nearStart.length > 0) {
    const avg = nearStart.reduce(
      (acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }),
      { x: 0, y: 0 }
    );
    merged.x1 = avg.x / nearStart.length;
    merged.y1 = avg.y / nearStart.length;
  }
  
  // Find endpoints near end
  const nearEnd = allEndpoints.filter(p => distance(p, end) <= tolerance);
  if (nearEnd.length > 0) {
    const avg = nearEnd.reduce(
      (acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }),
      { x: 0, y: 0 }
    );
    merged.x2 = avg.x / nearEnd.length;
    merged.y2 = avg.y / nearEnd.length;
  }
  
  // Update length
  merged.length = distance(
    { x: merged.x1, y: merged.y1 },
    { x: merged.x2, y: merged.y2 }
  );
  
  return {
    ...chain,
    merged
  };
}

/**
 * Merge chains that are adjacent or overlapping
 * @param {Array} chains - Array of chains
 * @param {number} tolerance - Merge tolerance
 * @returns {Array} Merged chains
 */
function mergeAdjacentChains(chains, tolerance) {
  const merged = [];
  const used = new Set();
  
  for (let i = 0; i < chains.length; i++) {
    if (used.has(i)) continue;
    
    const chain1 = chains[i];
    let current = { ...chain1 };
    used.add(i);
    
    // Try to merge with other chains
    let foundMerge = true;
    while (foundMerge) {
      foundMerge = false;
      
      for (let j = 0; j < chains.length; j++) {
        if (used.has(j)) continue;
        
        const chain2 = chains[j];
        
        // Check if they can be merged
        if (canMergeChains(current, chain2, tolerance)) {
          current = mergeTwoChains(current, chain2);
          used.add(j);
          foundMerge = true;
          break;
        }
      }
    }
    
    merged.push(current);
  }
  
  return merged;
}

/**
 * Check if two chains can be merged
 * @param {Object} chain1 - First chain
 * @param {Object} chain2 - Second chain
 * @param {number} tolerance - Tolerance for merging
 * @returns {boolean} True if mergeable
 */
function canMergeChains(chain1, chain2, tolerance) {
  // Check if they're roughly collinear
  const angle = angleBetween(chain1.merged, chain2.merged);
  if (angle > 10) return false;
  
  // Check if endpoints are close
  const closest = closestEndpoints(chain1.merged, chain2.merged);
  return closest.distance <= tolerance;
}

/**
 * Merge two chains into one
 * @param {Object} chain1 - First chain
 * @param {Object} chain2 - Second chain
 * @returns {Object} Merged chain
 */
function mergeTwoChains(chain1, chain2) {
  const allSegments = [...chain1.segments, ...chain2.segments];
  const merged = computeMergedLine(allSegments);
  
  return {
    id: chain1.id,
    segments: allSegments,
    merged,
    orientation: getOrientation(merged),
    length: merged.length,
    confidence: computeConfidence(allSegments, merged)
  };
}

/**
 * Convert chains to a simple array of line objects
 * @param {Array} chains - Array of chain objects
 * @returns {Array} Array of simple line objects
 */
export function chainsToLines(chains) {
  return chains.map(chain => ({
    id: chain.id,
    x1: chain.merged.x1,
    y1: chain.merged.y1,
    x2: chain.merged.x2,
    y2: chain.merged.y2,
    length: chain.length,
    orientation: chain.orientation,
    confidence: chain.confidence,
    segmentCount: chain.segments.length
  }));
}

/**
 * Get chain points as a flat array for rendering
 * @param {Object} chain - Chain object
 * @returns {Array} Flat array [x1, y1, x2, y2]
 */
export function getChainPoints(chain) {
  const m = chain.merged;
  return [m.x1, m.y1, m.x2, m.y2];
}

/**
 * Get all segment points in a chain as flat array
 * @param {Object} chain - Chain object
 * @returns {Array} Flat array of all segment points
 */
export function getChainSegmentPoints(chain) {
  const points = [];
  chain.segments.forEach(seg => {
    points.push(seg.x1, seg.y1, seg.x2, seg.y2);
  });
  return points;
}
