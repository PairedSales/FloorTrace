/**
 * topologyWallDetector.js  
 * Complete topology-based wall detection pipeline for Node.js
 * Combines line detection + topology graph + topology-guided merging
 */

import { preprocessImage } from './imagePreprocessor.js';
import { segmentWalls } from './wallSegmentation.js';
import { detectLineSegments, mergeCollinearSegments } from './lineRefinement.js';
import { buildTopologyGraph } from './topologyGraph.js';
import { mergeLines, chainsToLines } from './lineMerging.js';
import { imageToCanvas } from './imageLoader.js';
import { distance, midpoint } from './geometryUtils.js';

/**
 * Detect walls using topology-guided approach
 * @param {HTMLImageElement|HTMLCanvasElement} image - Input image
 * @param {Object} options - Detection options
 * @returns {Promise<Object>} Detection results with walls and topology graph
 */
export async function detectWallsTopology(image, options = {}) {
  const {
    // Preprocessing options
    thresholdMethod = 'global',
    globalThresholdValue = 240,
    adaptiveWindowSize = 25,
    adaptiveC = 5,
    removeNoise = true,
    minComponentSize = 20,
    useClosing = false,
    closingKernelSize = 3,
    
    // Line detection options
    minLength = 30,
    minScore = 0.2,
    maxGap = 10,
    orientationConstraint = false,
    angleTolerance = 0.785398,
    
    // Topology options
    endpointTolerance = 8,
    parallelTolerance = 5,
    gapTolerance = 8,
    mergeCollinear = true,
    snapEndpoints = true,
    
    // Parallel wall detection options
    maxParallelSeparation = 35,
    minParallelLength = 20,
    chainFragments = true,
    maxFragmentGap = 150,
    
    // Post-processing options
    minWallLength = 50,
    edgeThreshold = 50,
    
    debugMode = false
  } = options;
  
  console.log('=== Topology-Based Wall Detection Started ===');
  const startTime = performance.now();
  
  // Get image dimensions
  const canvas = await imageToCanvas(image);
  const ctx = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;
  const imageData = ctx.getImageData(0, 0, width, height);
  
  console.log(`Image size: ${width}x${height}px`);
  
  // STEP 1: Preprocessing
  console.log('\n--- Step 1: Preprocessing ---');
  const preprocessed = preprocessImage(imageData, {
    thresholdMethod,
    globalThresholdValue,
    adaptiveWindowSize,
    adaptiveC,
    removeNoise,
    minComponentSize,
    useClosing,
    closingKernelSize
  });
  
  // STEP 2: Wall Segmentation (generate likelihood map)
  console.log('\n--- Step 2: Wall Segmentation ---');
  const likelihoodMap = await segmentWalls(preprocessed, width, height);
  
  // STEP 3: Line Detection
  console.log('\n--- Step 3: Line Detection ---');
  const segments = detectLineSegments(likelihoodMap, width, height, {
    minLength,
    minScore,
    maxGap,
    orientationConstraint,
    angleTolerance,
    debugMode
  });
  
  console.log(`Detected ${segments.length} initial line segments`);
  
  // STEP 4: Merge Collinear Segments (preliminary cleanup)
  console.log('\n--- Step 4: Merging Collinear Segments ---');
  const mergedSegments = mergeCollinearSegments(segments, {
    maxDistance: 20,
    maxGap: 50,
    angleTolerance: 0.2
  });
  
  console.log(`Merged into ${mergedSegments.length} segments`);
  
  // STEP 5: Build Topology Graph
  console.log('\n--- Step 5: Building Topology Graph ---');
  const graph = buildTopologyGraph(mergedSegments, {
    endpointTolerance,
    parallelTolerance,
    collinearTolerance: { angleTolerance: parallelTolerance, distanceTolerance: 10 }
  });
  
  console.log(`Graph: ${graph.metadata.nodeCount} nodes, ${graph.metadata.edgeCount} edges`);
  console.log(`Found ${graph.metadata.junctionCount} junctions`);
  console.log(`Parallel pairs: ${graph.metadata.parallelCount}, Collinear: ${graph.metadata.collinearCount}`);
  
  // STEP 6: Detect and Fill Parallel Line Pairs (Irregular Walls)
  console.log('\n--- Step 6: Detecting Parallel Line Pairs ---');
  const parallelWalls = detectAndFillParallelPairs(mergedSegments, graph, {
    maxSeparation: maxParallelSeparation,
    minLength: minParallelLength,
    chainFragments,
    maxFragmentGap,
    parallelTolerance
  });
  
  console.log(`Found ${parallelWalls.length} parallel wall pairs (double-line walls)`);
  
  // STEP 7: Topology-Guided Line Merging
  console.log('\n--- Step 7: Topology-Guided Line Merging ---');
  const chains = mergeLines(mergedSegments, graph, {
    angleTolerance: parallelTolerance,
    gapTolerance,
    mergeCollinear,
    snapEndpoints
  });
  
  console.log(`Merged into ${chains.length} wall chains`);
  
  // STEP 8: Convert chains to walls
  console.log('\n--- Step 8: Converting to Walls ---');
  const chainWalls = chainsToLines(chains).map((wall, idx) => ({
    id: `wall_${idx}`,
    boundingBox: {
      x1: Math.min(wall.x1, wall.x2),
      y1: Math.min(wall.y1, wall.y2),
      x2: Math.max(wall.x1, wall.x2),
      y2: Math.max(wall.y1, wall.y2)
    },
    x1: wall.x1,
    y1: wall.y1,
    x2: wall.x2,
    y2: wall.y2,
    length: wall.length,
    thickness: 10, // Estimate from line
    isHorizontal: wall.orientation === 'horizontal',
    centerX: (wall.x1 + wall.x2) / 2,
    centerY: (wall.y1 + wall.y2) / 2,
    confidence: wall.confidence,
    segmentCount: wall.segmentCount
  }));
  
  // STEP 9: Merge colinear parallel walls
  console.log('\n--- Step 9: Merging Colinear Parallel Walls ---');
  const mergedParallelWalls = mergeColinearParallelWalls(parallelWalls, {
    angleTolerance: parallelTolerance,
    gapTolerance: 50,
    alignmentTolerance: 10
  });
  console.log(`Merged ${parallelWalls.length} → ${mergedParallelWalls.length} parallel walls`);
  
  // STEP 10: Convert parallel walls to same format
  const thickWalls = mergedParallelWalls.map((wall, idx) => ({
    id: `thick_${idx}`,
    boundingBox: {
      x1: Math.min(wall.x1, wall.x2),
      y1: Math.min(wall.y1, wall.y2),
      x2: Math.max(wall.x1, wall.x2),
      y2: Math.max(wall.y1, wall.y2)
    },
    x1: wall.x1,
    y1: wall.y1,
    x2: wall.x2,
    y2: wall.y2,
    length: wall.length,
    thickness: wall.thickness,
    isHorizontal: Math.abs(wall.angle) < 0.785, // < 45 degrees
    centerX: (wall.x1 + wall.x2) / 2,
    centerY: (wall.y1 + wall.y2) / 2,
    confidence: 0.9, // High confidence for parallel fills
    segmentCount: 2,
    isParallelFill: true
  }));
  
  // Combine all walls
  const allWalls = [...chainWalls, ...thickWalls];
  console.log(`Total: ${chainWalls.length} chain walls + ${thickWalls.length} thick walls = ${allWalls.length}`);
  
  // STEP 10: Filter by length and remove noise
  console.log('\n--- Step 9: Post-Processing & Noise Filtering ---');
  let filteredWalls = allWalls.filter(w => w.length >= minWallLength);
  console.log(`Length filter: ${allWalls.length} → ${filteredWalls.length} walls (min: ${minWallLength}px)`);
  
  // Apply noise filtering
  filteredWalls = filterInteriorNoise(filteredWalls, {
    minLength: minWallLength,
    minThickness: 3,
    minConfidence: options.minConfidence || 0.3,
    filterIsolated: options.filterIsolated !== false,
    filterShortSegments: options.filterShortSegments !== false,
    minSegmentCount: options.minSegmentCount || 1,
    graph
  });
  console.log(`Noise filter: → ${filteredWalls.length} walls`);
  
  // STEP 9: Classify as horizontal/vertical
  const horizontal = filteredWalls.filter(w => w.isHorizontal);
  const vertical = filteredWalls.filter(w => !w.isHorizontal);
  
  // STEP 10: Classify as exterior/interior using wall connectivity and position
  console.log('\n--- Step 10: Classifying Exterior/Interior ---');
  const { exterior, interior } = classifyExteriorInterior(filteredWalls, width, height);
  
  console.log(`Classification: ${exterior.length} exterior, ${interior.length} interior`);
  
  // STEP 11: Build perimeter
  const perimeter = buildPerimeter(exterior, width, height);
  
  const endTime = performance.now();
  const processingTime = endTime - startTime;
  
  console.log(`\n=== Detection Complete (${processingTime.toFixed(2)}ms) ===`);
  console.log(`Total walls: ${filteredWalls.length}`);
  console.log(`Horizontal: ${horizontal.length}, Vertical: ${vertical.length}`);
  console.log(`Exterior: ${exterior.length}, Interior: ${interior.length}`);
  
  return {
    allWalls: filteredWalls,
    horizontal,
    vertical,
    exterior,
    interior,
    perimeter,
    graph,
    chains,
    metadata: {
      processingTime,
      segmentCount: mergedSegments.length,
      nodeCount: graph.metadata.nodeCount,
      edgeCount: graph.metadata.edgeCount,
      junctionCount: graph.metadata.junctionCount,
      chainCount: chains.length
    }
  };
}

/**
 * Detect and fill parallel line pairs (irregular double-line walls)
 * Enhanced to handle fragmented parallel lines with gaps (windows/doors)
 * @param {Array} segments - Line segments
 * @param {Object} graph - Topology graph
 * @param {Object} options - Options
 * @returns {Array} Filled parallel wall segments
 */
function detectAndFillParallelPairs(segments, graph, options) {
  const { 
    maxSeparation = 30, 
    minLength = 30,
    chainFragments = true,
    maxFragmentGap = 100
  } = options;
  
  const parallelWalls = [];
  const usedSegments = new Set();
  
  // STRATEGY 1: Direct parallel pairs from graph
  for (const pair of graph.parallelPairs) {
    const seg1 = segments[pair.seg1];
    const seg2 = segments[pair.seg2];
    
    if (usedSegments.has(pair.seg1) || usedSegments.has(pair.seg2)) continue;
    if (seg1.length < minLength || seg2.length < minLength) continue;
    
    const separation = calculateParallelSeparation(seg1, seg2);
    if (separation < 5 || separation > maxSeparation) continue;
    
    const filledWall = fillBetweenLines(seg1, seg2, separation);
    if (filledWall) {
      parallelWalls.push(filledWall);
      usedSegments.add(pair.seg1);
      usedSegments.add(pair.seg2);
    }
  }
  
  // STRATEGY 2: Chain fragmented parallel lines (for walls with windows/doors)
  if (chainFragments) {
    const fragmentChains = findParallelFragmentChains(segments, graph, {
      maxSeparation,
      minLength: minLength / 2, // Allow shorter fragments
      maxFragmentGap,
      usedSegments
    });
    
    parallelWalls.push(...fragmentChains);
  }
  
  return parallelWalls;
}

/**
 * Find chains of parallel line fragments that form continuous walls
 * (e.g., wall with multiple windows creates many short parallel segments)
 * @param {Array} segments - All segments
 * @param {Object} graph - Topology graph
 * @param {Object} options - Options
 * @returns {Array} Chained parallel walls
 */
function findParallelFragmentChains(segments, graph, options) {
  const { maxSeparation, minLength, maxFragmentGap, usedSegments } = options;
  const chains = [];
  
  // Group segments by orientation (horizontal/vertical)
  const horizontal = [];
  const vertical = [];
  
  segments.forEach((seg, idx) => {
    if (usedSegments.has(idx)) return;
    
    const angle = Math.abs(seg.angle || 0) * (180 / Math.PI);
    const isHorizontal = angle < 30 || angle > 150;
    
    if (isHorizontal) {
      horizontal.push({ seg, idx });
    } else if (angle > 60 && angle < 120) {
      vertical.push({ seg, idx });
    }
  });
  
  // Find parallel chains in each orientation
  chains.push(...findChainsInGroup(horizontal, maxSeparation, minLength, maxFragmentGap, 'horizontal'));
  chains.push(...findChainsInGroup(vertical, maxSeparation, minLength, maxFragmentGap, 'vertical'));
  
  return chains;
}

/**
 * Find parallel chains within a group of similarly-oriented segments
 * @param {Array} group - Segments with same orientation
 * @param {number} maxSeparation - Max separation for parallel
 * @param {number} minLength - Min length for fragment
 * @param {number} maxFragmentGap - Max gap between fragments
 * @param {string} orientation - 'horizontal' or 'vertical'
 * @returns {Array} Parallel wall chains
 */
function findChainsInGroup(group, maxSeparation, minLength, maxFragmentGap, orientation) {
  const chains = [];
  
  // Sort by position (y for horizontal, x for vertical)
  const sortedGroup = [...group].sort((a, b) => {
    if (orientation === 'horizontal') {
      return a.seg.y1 - b.seg.y1;
    } else {
      return a.seg.x1 - b.seg.x1;
    }
  });
  
  // Find pairs of parallel rows/columns
  for (let i = 0; i < sortedGroup.length; i++) {
    for (let j = i + 1; j < sortedGroup.length; j++) {
      const seg1 = sortedGroup[i].seg;
      const seg2 = sortedGroup[j].seg;
      
      const separation = calculateParallelSeparation(seg1, seg2);
      
      // If too far apart, stop checking this row
      if (separation > maxSeparation * 2) break;
      
      // Check if they're parallel and reasonably separated
      if (separation < 5 || separation > maxSeparation) continue;
      
      // Check if they overlap in the parallel direction
      const overlap = calculateParallelOverlap(seg1, seg2, orientation);
      if (overlap < minLength) continue;
      
      // Found a parallel pair - create filled wall
      const filledWall = fillBetweenLines(seg1, seg2, separation);
      if (filledWall && filledWall.length >= minLength) {
        chains.push(filledWall);
      }
    }
  }
  
  return chains;
}

/**
 * Calculate overlap between two parallel segments in their parallel direction
 * @param {Object} seg1 - First segment
 * @param {Object} seg2 - Second segment  
 * @param {string} orientation - 'horizontal' or 'vertical'
 * @returns {number} Overlap length
 */
function calculateParallelOverlap(seg1, seg2, orientation) {
  if (orientation === 'horizontal') {
    const start1 = Math.min(seg1.x1, seg1.x2);
    const end1 = Math.max(seg1.x1, seg1.x2);
    const start2 = Math.min(seg2.x1, seg2.x2);
    const end2 = Math.max(seg2.x1, seg2.x2);
    
    const overlapStart = Math.max(start1, start2);
    const overlapEnd = Math.min(end1, end2);
    
    return Math.max(0, overlapEnd - overlapStart);
  } else {
    const start1 = Math.min(seg1.y1, seg1.y2);
    const end1 = Math.max(seg1.y1, seg1.y2);
    const start2 = Math.min(seg2.y1, seg2.y2);
    const end2 = Math.max(seg2.y1, seg2.y2);
    
    const overlapStart = Math.max(start1, start2);
    const overlapEnd = Math.min(end1, end2);
    
    return Math.max(0, overlapEnd - overlapStart);
  }
}

/**
 * Calculate perpendicular separation between two parallel segments
 * @param {Object} seg1 - First segment
 * @param {Object} seg2 - Second segment
 * @returns {number} Separation distance
 */
function calculateParallelSeparation(seg1, seg2) {
  // Get midpoints
  const mid1 = midpoint(seg1);
  const mid2 = midpoint(seg2);
  
  // Simple distance for now (could be improved with perpendicular distance)
  return distance(mid1, mid2);
}

/**
 * Fill region between two parallel lines to create thick wall
 * @param {Object} seg1 - First segment
 * @param {Object} seg2 - Second segment
 * @param {number} separation - Distance between lines
 * @returns {Object} Filled wall object
 */
function fillBetweenLines(seg1, seg2, separation) {
  // Use the longer segment as the base
  const baseSeg = seg1.length >= seg2.length ? seg1 : seg2;
  
  // Use average of both segments for endpoints
  const x1 = (seg1.x1 + seg2.x1) / 2;
  const y1 = (seg1.y1 + seg2.y1) / 2;
  const x2 = (seg1.x2 + seg2.x2) / 2;
  const y2 = (seg1.y2 + seg2.y2) / 2;
  
  const length = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
  
  return {
    x1,
    y1,
    x2,
    y2,
    length,
    angle: baseSeg.angle,
    thickness: separation,
    isParallelFill: true,
    sourceSegments: [seg1, seg2]
  };
}

/**
 * Merge colinear parallel walls into continuous walls
 * @param {Array} walls - Parallel wall segments
 * @param {Object} options - Merge options
 * @returns {Array} Merged parallel walls
 */
function mergeColinearParallelWalls(walls, options = {}) {
  const { angleTolerance = 5, gapTolerance = 50, alignmentTolerance = 10 } = options;
  
  if (walls.length === 0) return [];
  
  const merged = [];
  const used = new Set();
  
  for (let i = 0; i < walls.length; i++) {
    if (used.has(i)) continue;
    
    const wall1 = walls[i];
    let currentWall = { ...wall1 };
    used.add(i);
    
    // Try to extend this wall by finding colinear walls
    let foundExtension = true;
    while (foundExtension) {
      foundExtension = false;
      
      for (let j = 0; j < walls.length; j++) {
        if (used.has(j)) continue;
        
        const wall2 = walls[j];
        
        // Check if they're colinear
        if (!areWallsColinear(currentWall, wall2, angleTolerance, alignmentTolerance)) continue;
        
        // Check if they're close enough to merge
        const gap = calculateWallGap(currentWall, wall2);
        if (gap > gapTolerance) continue;
        
        // Merge the walls
        currentWall = mergeWalls(currentWall, wall2);
        used.add(j);
        foundExtension = true;
        break;
      }
    }
    
    merged.push(currentWall);
  }
  
  return merged;
}

/**
 * Check if two walls are colinear
 * @param {Object} wall1 - First wall
 * @param {Object} wall2 - Second wall
 * @param {number} angleTolerance - Angle tolerance in degrees
 * @param {number} alignmentTolerance - Alignment tolerance in pixels
 * @returns {boolean} True if colinear
 */
function areWallsColinear(wall1, wall2, angleTolerance, alignmentTolerance) {
  // Check angle similarity
  const angle1 = Math.atan2(wall1.y2 - wall1.y1, wall1.x2 - wall1.x1) * (180 / Math.PI);
  const angle2 = Math.atan2(wall2.y2 - wall2.y1, wall2.x2 - wall2.x1) * (180 / Math.PI);
  const angleDiff = Math.abs(angle1 - angle2);
  
  if (angleDiff > angleTolerance && angleDiff < (180 - angleTolerance)) return false;
  
  // Check if they're on the same line (perpendicular distance)
  const perpDist = pointToLineDistance(
    { x: wall2.x1, y: wall2.y1 },
    { x: wall1.x1, y: wall1.y1 },
    { x: wall1.x2, y: wall1.y2 }
  );
  
  return perpDist <= alignmentTolerance;
}

/**
 * Calculate gap between two walls
 * @param {Object} wall1 - First wall
 * @param {Object} wall2 - Second wall
 * @returns {number} Gap distance
 */
function calculateWallGap(wall1, wall2) {
  const endpoints = [
    { x: wall1.x1, y: wall1.y1 },
    { x: wall1.x2, y: wall1.y2 },
    { x: wall2.x1, y: wall2.y1 },
    { x: wall2.x2, y: wall2.y2 }
  ];
  
  let minGap = Infinity;
  for (let i = 0; i < 2; i++) {
    for (let j = 2; j < 4; j++) {
      const dist = distance(endpoints[i], endpoints[j]);
      if (dist < minGap) minGap = dist;
    }
  }
  
  return minGap;
}

/**
 * Merge two walls into one
 * @param {Object} wall1 - First wall
 * @param {Object} wall2 - Second wall
 * @returns {Object} Merged wall
 */
function mergeWalls(wall1, wall2) {
  // Find the two farthest endpoints
  const points = [
    { x: wall1.x1, y: wall1.y1 },
    { x: wall1.x2, y: wall1.y2 },
    { x: wall2.x1, y: wall2.y1 },
    { x: wall2.x2, y: wall2.y2 }
  ];
  
  let maxDist = 0;
  let p1 = points[0];
  let p2 = points[1];
  
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const dist = distance(points[i], points[j]);
      if (dist > maxDist) {
        maxDist = dist;
        p1 = points[i];
        p2 = points[j];
      }
    }
  }
  
  return {
    x1: p1.x,
    y1: p1.y,
    x2: p2.x,
    y2: p2.y,
    length: maxDist,
    angle: Math.atan2(p2.y - p1.y, p2.x - p1.x),
    thickness: Math.max(wall1.thickness || 10, wall2.thickness || 10),
    isParallelFill: true
  };
}

/**
 * Calculate point to line distance
 * @param {Object} point - Point {x, y}
 * @param {Object} lineStart - Line start {x, y}
 * @param {Object} lineEnd - Line end {x, y}
 * @returns {number} Perpendicular distance
 */
function pointToLineDistance(point, lineStart, lineEnd) {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  const length = Math.sqrt(dx * dx + dy * dy);
  
  if (length === 0) return distance(point, lineStart);
  
  const t = ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / (length * length);
  const closestX = lineStart.x + t * dx;
  const closestY = lineStart.y + t * dy;
  
  return Math.sqrt((point.x - closestX) ** 2 + (point.y - closestY) ** 2);
}

/**
 * Classify walls as exterior or interior based on position and connectivity
 * @param {Array} walls - All detected walls
 * @param {number} width - Image width
 * @param {number} height - Image height
 * @returns {Object} {exterior: [], interior: []}
 */
function classifyExteriorInterior(walls, width, height) {
  if (walls.length === 0) {
    return { exterior: [], interior: [] };
  }
  
  // Find the outermost walls (form the perimeter)
  const minX = Math.min(...walls.map(w => Math.min(w.x1, w.x2)));
  const maxX = Math.max(...walls.map(w => Math.max(w.x1, w.x2)));
  const minY = Math.min(...walls.map(w => Math.min(w.y1, w.y2)));
  const maxY = Math.max(...walls.map(w => Math.max(w.y1, w.y2)));
  
  const tolerance = 20; // Pixels tolerance for "on the perimeter"
  
  const exterior = walls.filter(w => {
    const wx1 = Math.min(w.x1, w.x2);
    const wx2 = Math.max(w.x1, w.x2);
    const wy1 = Math.min(w.y1, w.y2);
    const wy2 = Math.max(w.y1, w.y2);
    
    // Wall is on left edge
    if (Math.abs(wx1 - minX) < tolerance && w.length > 200) return true;
    
    // Wall is on right edge
    if (Math.abs(wx2 - maxX) < tolerance && w.length > 200) return true;
    
    // Wall is on top edge
    if (Math.abs(wy1 - minY) < tolerance && w.length > 200) return true;
    
    // Wall is on bottom edge
    if (Math.abs(wy2 - maxY) < tolerance && w.length > 200) return true;
    
    return false;
  });
  
  const interior = walls.filter(w => !exterior.includes(w));
  
  return { exterior, interior };
}

/**
 * Filter walls to remove interior noise (fixtures, doors, windows, text)
 * @param {Array} walls - All detected walls
 * @param {Object} options - Filtering options
 * @returns {Array} Filtered walls
 */
function filterInteriorNoise(walls, options = {}) {
  const { 
    minLength = 50, 
    minThickness = 3,
    minConfidence = 0.3,
    filterIsolated = true,
    filterShortSegments = true,
    minSegmentCount = 1
  } = options;
  
  return walls.filter(wall => {
    // FILTER 1: Minimum length (structural walls should be reasonably long)
    if (wall.length < minLength) return false;
    
    // FILTER 2: Minimum thickness (pencil lines vs thick walls)
    if (wall.thickness && wall.thickness < minThickness) return false;
    
    // FILTER 3: Confidence score (well-defined walls have higher confidence)
    if (wall.confidence && wall.confidence < minConfidence) return false;
    
    // FILTER 4: Segment count (single short segments are often noise)
    if (filterShortSegments && wall.segmentCount) {
      if (wall.segmentCount < minSegmentCount && wall.length < minLength * 2) {
        return false;
      }
    }
    
    // FILTER 5: Parallel fills are structural walls - always keep
    if (wall.isParallelFill) return true;
    
    // FILTER 6: Very short walls with low segment count are likely fixtures
    if (wall.length < 150 && wall.segmentCount === 1) return false;
    
    return true;
  });
}

/**
 * Build perimeter from exterior walls
 * @param {Array} walls - Exterior walls
 * @param {number} width - Image width
 * @param {number} height - Image height
 * @returns {Object} Perimeter with vertices
 */
function buildPerimeter(walls, width, height) {
  if (walls.length === 0) {
    return {
      vertices: [
        { x: 0, y: 0 },
        { x: width, y: 0 },
        { x: width, y: height },
        { x: 0, y: height }
      ]
    };
  }
  
  // Find bounding rectangle of all exterior walls
  const minX = Math.min(...walls.map(w => w.boundingBox.x1));
  const minY = Math.min(...walls.map(w => w.boundingBox.y1));
  const maxX = Math.max(...walls.map(w => w.boundingBox.x2));
  const maxY = Math.max(...walls.map(w => w.boundingBox.y2));
  
  return {
    vertices: [
      { x: minX, y: minY },
      { x: maxX, y: minY },
      { x: maxX, y: maxY },
      { x: minX, y: maxY }
    ]
  };
}
