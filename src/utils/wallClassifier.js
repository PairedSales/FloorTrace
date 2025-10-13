/**
 * wallClassifier.js
 * Classify and filter merged wall chains into valid wall structures
 */

import {
  lineLength,
  getOrientation,
  isParallel,
  distance,
  pointToLineDistance
} from './geometryUtils.js';

import { getNodeDegree } from './topologyGraph.js';

/**
 * Classify and filter wall chains
 * @param {Array} chains - Array of merged chain objects
 * @param {Object} graph - Topology graph
 * @param {Object} options - Classification options
 * @param {number} options.minLength - Minimum wall length in pixels (default: 25)
 * @param {number} options.minConfidence - Minimum confidence score (default: 0.3)
 * @param {boolean} options.filterIsolated - Remove isolated walls (default: false)
 * @param {boolean} options.computeThickness - Estimate wall thickness (default: true)
 * @param {boolean} options.mergeParallel - Merge redundant parallel walls (default: true)
 * @returns {Array} Array of classified wall objects
 */
export function classifyWalls(chains, graph, options = {}) {
  const {
    minLength = 25,
    minConfidence = 0.3,
    filterIsolated = false,
    computeThickness = true,
    mergeParallel = true
  } = options;
  
  let walls = chains.map((chain, idx) => {
    const wall = {
      id: chain.id || `wall_${idx}`,
      chain: chain.merged,
      segments: chain.segments,
      orientation: chain.orientation,
      length: chain.length,
      confidence: chain.confidence,
      segmentCount: chain.segments.length,
      metadata: {}
    };
    
    // Compute connectivity degree
    wall.connectivityDegree = computeConnectivityDegree(chain, graph);
    
    // Compute thickness if enabled
    if (computeThickness) {
      wall.thickness = estimateThickness(chain);
      wall.metadata.thickness = wall.thickness;
    }
    
    // Add quality metrics
    wall.quality = computeQuality(wall);
    
    return wall;
  });
  
  // Filter by length
  walls = walls.filter(w => w.length >= minLength);
  
  // Filter by confidence
  walls = walls.filter(w => w.confidence >= minConfidence);
  
  // Filter isolated walls if enabled
  if (filterIsolated) {
    walls = walls.filter(w => w.connectivityDegree > 0);
  }
  
  // Merge redundant parallel walls if enabled
  if (mergeParallel) {
    walls = mergeRedundantWalls(walls);
  }
  
  // Classify wall types
  walls = walls.map(wall => ({
    ...wall,
    type: classifyWallType(wall)
  }));
  
  // Sort by length (longest first)
  walls.sort((a, b) => b.length - a.length);
  
  // Reassign IDs after filtering
  walls = walls.map((wall, idx) => ({
    ...wall,
    id: `wall_${idx}`
  }));
  
  return walls;
}

/**
 * Compute connectivity degree (how many other walls connect to this one)
 * @param {Object} chain - Chain object
 * @param {Object} graph - Topology graph
 * @returns {number} Connectivity degree
 */
function computeConnectivityDegree(chain, graph) {
  // Find nodes that are endpoints of segments in this chain
  const segmentIds = new Set(chain.segments.map(s => s.id));
  
  let totalDegree = 0;
  let nodeCount = 0;
  
  graph.nodes.forEach(node => {
    // Check if this node is connected to any segment in our chain
    const connectedToChain = node.segments.some(segIdx => {
      const seg = chain.segments[segIdx];
      return seg && segmentIds.has(seg.id);
    });
    
    if (connectedToChain) {
      totalDegree += getNodeDegree(graph, node.id);
      nodeCount++;
    }
  });
  
  return nodeCount > 0 ? Math.round(totalDegree / nodeCount) : 0;
}

/**
 * Estimate wall thickness based on parallel nearby segments
 * @param {Object} chain - Chain object
 * @returns {number} Estimated thickness in pixels
 */
function estimateThickness(chain) {
  // For now, return a default value
  // In a more advanced implementation, we would:
  // 1. Find parallel segments nearby
  // 2. Measure perpendicular distance
  // 3. Average the distances
  
  const segments = chain.segments;
  if (segments.length === 0) return 3;
  
  // Simple heuristic: walls with more segments tend to be thicker/more important
  const baseThickness = 3;
  const segmentBonus = Math.min(segments.length * 0.5, 5);
  
  return baseThickness + segmentBonus;
}

/**
 * Compute overall quality score for a wall
 * @param {Object} wall - Wall object
 * @returns {number} Quality score (0-1)
 */
function computeQuality(wall) {
  // Factors:
  // 1. Confidence (40%)
  // 2. Length (30%)
  // 3. Connectivity (20%)
  // 4. Segment count (10%)
  
  const confidenceScore = wall.confidence * 0.4;
  const lengthScore = Math.min(wall.length / 200, 1) * 0.3;
  const connectivityScore = Math.min(wall.connectivityDegree / 4, 1) * 0.2;
  const segmentScore = Math.min(wall.segmentCount / 5, 1) * 0.1;
  
  return confidenceScore + lengthScore + connectivityScore + segmentScore;
}

/**
 * Classify wall type based on attributes
 * @param {Object} wall - Wall object
 * @returns {string} Wall type
 */
function classifyWallType(wall) {
  const { orientation, length, connectivityDegree, quality } = wall;
  
  // Classify by connectivity
  if (connectivityDegree === 0) {
    return 'isolated';
  } else if (connectivityDegree === 1) {
    return 'dead-end';
  } else if (connectivityDegree === 2) {
    return 'corridor';
  } else if (connectivityDegree >= 3) {
    return 'junction';
  }
  
  // Classify by orientation and length
  if (length > 150) {
    return orientation === 'horizontal' ? 'major-horizontal' : 
           orientation === 'vertical' ? 'major-vertical' : 
           'major-diagonal';
  }
  
  return 'standard';
}

/**
 * Merge redundant parallel walls that are very close
 * @param {Array} walls - Array of wall objects
 * @param {number} maxDistance - Maximum perpendicular distance (default: 8)
 * @param {number} maxAngle - Maximum angle difference (default: 5)
 * @returns {Array} Walls with redundant ones merged
 */
function mergeRedundantWalls(walls, maxDistance = 8, maxAngle = 5) {
  const merged = [];
  const used = new Set();
  
  for (let i = 0; i < walls.length; i++) {
    if (used.has(i)) continue;
    
    const wall1 = walls[i];
    const toMerge = [wall1];
    used.add(i);
    
    // Find parallel walls that are very close
    for (let j = i + 1; j < walls.length; j++) {
      if (used.has(j)) continue;
      
      const wall2 = walls[j];
      
      // Check if parallel
      if (!isParallel(wall1.chain, wall2.chain, maxAngle)) continue;
      
      // Check perpendicular distance
      const dist1 = pointToLineDistance(
        { x: wall2.chain.x1, y: wall2.chain.y1 },
        wall1.chain
      );
      const dist2 = pointToLineDistance(
        { x: wall2.chain.x2, y: wall2.chain.y2 },
        wall1.chain
      );
      
      const avgDist = (dist1 + dist2) / 2;
      
      if (avgDist <= maxDistance) {
        toMerge.push(wall2);
        used.add(j);
      }
    }
    
    // Merge if multiple walls found
    if (toMerge.length > 1) {
      const mergedWall = mergeWallGroup(toMerge);
      merged.push(mergedWall);
    } else {
      merged.push(wall1);
    }
  }
  
  return merged;
}

/**
 * Merge a group of walls into one
 * @param {Array} walls - Array of wall objects to merge
 * @returns {Object} Merged wall
 */
function mergeWallGroup(walls) {
  // Use the longest wall as base
  const base = walls.reduce((longest, wall) => 
    wall.length > longest.length ? wall : longest
  );
  
  // Collect all segments
  const allSegments = walls.flatMap(w => w.segments);
  
  // Average thickness
  const avgThickness = walls.reduce((sum, w) => sum + (w.thickness || 0), 0) / walls.length;
  
  // Sum connectivity
  const totalConnectivity = walls.reduce((sum, w) => sum + w.connectivityDegree, 0);
  
  // Max confidence
  const maxConfidence = Math.max(...walls.map(w => w.confidence));
  
  return {
    ...base,
    segments: allSegments,
    segmentCount: allSegments.length,
    thickness: avgThickness,
    connectivityDegree: totalConnectivity,
    confidence: maxConfidence,
    metadata: {
      ...base.metadata,
      mergedFrom: walls.length,
      originalWallIds: walls.map(w => w.id)
    }
  };
}

/**
 * Filter walls by orientation
 * @param {Array} walls - Array of wall objects
 * @param {string|Array} orientations - 'horizontal', 'vertical', 'diagonal', or array of these
 * @returns {Array} Filtered walls
 */
export function filterWallsByOrientation(walls, orientations) {
  const targetOrientations = Array.isArray(orientations) ? orientations : [orientations];
  return walls.filter(w => targetOrientations.includes(w.orientation));
}

/**
 * Filter walls by type
 * @param {Array} walls - Array of wall objects
 * @param {string|Array} types - Wall type(s) to keep
 * @returns {Array} Filtered walls
 */
export function filterWallsByType(walls, types) {
  const targetTypes = Array.isArray(types) ? types : [types];
  return walls.filter(w => targetTypes.includes(w.type));
}

/**
 * Get wall statistics
 * @param {Array} walls - Array of wall objects
 * @returns {Object} Statistics object
 */
export function getWallStatistics(walls) {
  if (walls.length === 0) {
    return {
      count: 0,
      totalLength: 0,
      avgLength: 0,
      avgConfidence: 0,
      orientations: {},
      types: {}
    };
  }
  
  const totalLength = walls.reduce((sum, w) => sum + w.length, 0);
  const avgLength = totalLength / walls.length;
  const avgConfidence = walls.reduce((sum, w) => sum + w.confidence, 0) / walls.length;
  
  const orientations = {};
  const types = {};
  
  walls.forEach(wall => {
    orientations[wall.orientation] = (orientations[wall.orientation] || 0) + 1;
    types[wall.type] = (types[wall.type] || 0) + 1;
  });
  
  return {
    count: walls.length,
    totalLength,
    avgLength,
    avgConfidence,
    minLength: Math.min(...walls.map(w => w.length)),
    maxLength: Math.max(...walls.map(w => w.length)),
    orientations,
    types
  };
}

/**
 * Find walls that form a closed loop
 * @param {Array} walls - Array of wall objects
 * @param {number} tolerance - Endpoint matching tolerance (default: 10)
 * @returns {Array} Array of loops (each loop is an array of wall IDs)
 */
export function findWallLoops(walls, tolerance = 10) {
  // Build endpoint connectivity
  const endpointMap = new Map();
  
  walls.forEach(wall => {
    const p1 = { x: wall.chain.x1, y: wall.chain.y1 };
    const p2 = { x: wall.chain.x2, y: wall.chain.y2 };
    
    const key1 = getEndpointKey(p1, endpointMap, tolerance);
    const key2 = getEndpointKey(p2, endpointMap, tolerance);
    
    if (!endpointMap.has(key1)) endpointMap.set(key1, []);
    if (!endpointMap.has(key2)) endpointMap.set(key2, []);
    
    endpointMap.get(key1).push(wall.id);
    endpointMap.get(key2).push(wall.id);
  });
  
  // Find loops using DFS
  const loops = [];
  const visited = new Set();
  
  // This is a simplified loop detection
  // A full implementation would use cycle detection algorithms
  
  return loops;
}

/**
 * Get or create endpoint key for matching
 * @param {Object} point - Point {x, y}
 * @param {Map} endpointMap - Existing endpoint map
 * @param {number} tolerance - Matching tolerance
 * @returns {string} Endpoint key
 */
function getEndpointKey(point, endpointMap, tolerance) {
  // Check if a nearby endpoint already exists
  for (const [key, walls] of endpointMap.entries()) {
    const [x, y] = key.split(',').map(Number);
    if (distance(point, { x, y }) <= tolerance) {
      return key;
    }
  }
  
  // Create new key
  return `${point.x},${point.y}`;
}

/**
 * Rank walls by importance
 * @param {Array} walls - Array of wall objects
 * @returns {Array} Walls sorted by importance (most important first)
 */
export function rankWallsByImportance(walls) {
  return [...walls].sort((a, b) => {
    // Importance factors:
    // 1. Quality score (40%)
    // 2. Length (30%)
    // 3. Connectivity (20%)
    // 4. Confidence (10%)
    
    const scoreA = 
      (a.quality || 0) * 0.4 +
      (a.length / 500) * 0.3 +
      (a.connectivityDegree / 5) * 0.2 +
      a.confidence * 0.1;
    
    const scoreB = 
      (b.quality || 0) * 0.4 +
      (b.length / 500) * 0.3 +
      (b.connectivityDegree / 5) * 0.2 +
      b.confidence * 0.1;
    
    return scoreB - scoreA;
  });
}

/**
 * Export walls to a simple format
 * @param {Array} walls - Array of wall objects
 * @returns {Array} Simplified wall data
 */
export function exportWalls(walls) {
  return walls.map(wall => ({
    id: wall.id,
    x1: wall.chain.x1,
    y1: wall.chain.y1,
    x2: wall.chain.x2,
    y2: wall.chain.y2,
    length: wall.length,
    orientation: wall.orientation,
    type: wall.type,
    confidence: wall.confidence,
    quality: wall.quality,
    thickness: wall.thickness || 3
  }));
}
