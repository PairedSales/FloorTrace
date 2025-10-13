/**
 * topologyPerimeterTracer.js
 * Perimeter tracing using topology-guided wall analysis
 * Completely replaces old perimeter detection systems
 */

import { dataUrlToImage } from './imageLoader';
import { detectSegmentsFromImage } from './segmentDetection.js';
import { buildTopologyGraph, findConnectedComponents } from './topologyGraph.js';
import { mergeLines } from './lineMerging.js';
import { classifyWalls } from './wallClassifier.js';
import { distance, getOrientation } from './geometryUtils.js';

/**
 * Find the outer perimeter using topology graph analysis
 * @param {Object} graph - Topology graph
 * @param {Array} walls - Classified walls
 * @returns {Object} Perimeter data with vertices and walls
 */
function findOuterPerimeter(graph, walls) {
  // Strategy: Find the longest connected path that forms a closed loop
  // with the maximum bounding area (outer boundary)
  
  // Step 1: Find all connected components
  const components = findConnectedComponents(graph);
  
  if (components.length === 0) {
    return null;
  }
  
  // Step 2: Find the component with the largest spatial extent
  let largestComponent = null;
  let maxArea = 0;
  
  for (const component of components) {
    const nodes = component.map(nodeId => graph.nodes[nodeId]);
    const area = computeConvexHullArea(nodes);
    
    if (area > maxArea) {
      maxArea = area;
      largestComponent = component;
    }
  }
  
  if (!largestComponent) {
    return null;
  }
  
  // Step 3: Extract walls from the outer component
  const componentNodeSet = new Set(largestComponent);
  const perimeterWalls = walls.filter(wall => {
    // Check if wall endpoints are in this component
    return wall.segments.some(seg => {
      const endpoints = [
        { x: seg.x1, y: seg.y1 },
        { x: seg.x2, y: seg.y2 }
      ];
      
      return endpoints.some(ep => {
        return graph.nodes.some(node => 
          componentNodeSet.has(node.id) && 
          distance(ep, node) < 10
        );
      });
    });
  });
  
  // Step 4: Order walls to form a continuous perimeter
  const orderedWalls = orderPerimeterWalls(perimeterWalls, graph);
  
  // Step 5: Extract vertices from ordered walls
  const vertices = extractVerticesFromWalls(orderedWalls);
  
  // Step 6: Simplify and align vertices
  const simplifiedVertices = simplifyVertices(vertices, 10);
  const alignedVertices = alignToAxis(simplifiedVertices, 10);
  
  return {
    vertices: alignedVertices,
    walls: orderedWalls,
    area: maxArea,
    nodeCount: largestComponent.length
  };
}

/**
 * Order walls to form a continuous perimeter path
 */
function orderPerimeterWalls(walls) {
  if (walls.length === 0) return [];
  
  const ordered = [];
  const used = new Set();
  
  // Start with the leftmost wall
  let current = walls.reduce((leftmost, wall) => {
    const leftmostX = Math.min(wall.chain.x1, wall.chain.x2);
    const currentLeftmost = Math.min(leftmost.chain.x1, leftmost.chain.x2);
    return leftmostX < currentLeftmost ? wall : leftmost;
  });
  
  ordered.push(current);
  used.add(current.id);
  
  // Continue connecting walls
  while (ordered.length < walls.length) {
    const lastWall = ordered[ordered.length - 1];
    const endpoint = { x: lastWall.chain.x2, y: lastWall.chain.y2 };
    
    // Find nearest unused wall
    let nearest = null;
    let minDist = Infinity;
    
    for (const wall of walls) {
      if (used.has(wall.id)) continue;
      
      const dist1 = distance(endpoint, { x: wall.chain.x1, y: wall.chain.y1 });
      const dist2 = distance(endpoint, { x: wall.chain.x2, y: wall.chain.y2 });
      const dist = Math.min(dist1, dist2);
      
      if (dist < minDist) {
        minDist = dist;
        nearest = wall;
      }
    }
    
    if (!nearest || minDist > 50) break; // Gap too large
    
    ordered.push(nearest);
    used.add(nearest.id);
  }
  
  return ordered;
}

/**
 * Extract vertices from ordered walls
 */
function extractVerticesFromWalls(walls) {
  const vertices = [];
  
  for (let i = 0; i < walls.length; i++) {
    const wall = walls[i];
    const nextWall = walls[(i + 1) % walls.length];
    
    // Add start point
    vertices.push({ x: wall.chain.x1, y: wall.chain.y1 });
    
    // Check for corner (direction change)
    const wallOrientation = getOrientation(wall.chain);
    const nextOrientation = getOrientation(nextWall.chain);
    
    if (wallOrientation !== nextOrientation) {
      // Corner detected - add endpoint
      vertices.push({ x: wall.chain.x2, y: wall.chain.y2 });
    }
  }
  
  return vertices;
}

/**
 * Simplify vertices using Douglas-Peucker algorithm
 */
function simplifyVertices(vertices, tolerance = 10) {
  if (vertices.length <= 2) return vertices;
  
  let maxDist = 0;
  let maxIndex = 0;
  const start = vertices[0];
  const end = vertices[vertices.length - 1];
  
  for (let i = 1; i < vertices.length - 1; i++) {
    const dist = pointToLineDistance(vertices[i], start, end);
    if (dist > maxDist) {
      maxDist = dist;
      maxIndex = i;
    }
  }
  
  if (maxDist > tolerance) {
    const left = simplifyVertices(vertices.slice(0, maxIndex + 1), tolerance);
    const right = simplifyVertices(vertices.slice(maxIndex), tolerance);
    return left.slice(0, -1).concat(right);
  } else {
    return [start, end];
  }
}

/**
 * Calculate distance from point to line
 */
function pointToLineDistance(point, lineStart, lineEnd) {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  
  if (dx === 0 && dy === 0) {
    return Math.sqrt((point.x - lineStart.x) ** 2 + (point.y - lineStart.y) ** 2);
  }
  
  const t = Math.max(0, Math.min(1, 
    ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / (dx * dx + dy * dy)
  ));
  
  const projection = {
    x: lineStart.x + t * dx,
    y: lineStart.y + t * dy
  };
  
  return Math.sqrt((point.x - projection.x) ** 2 + (point.y - projection.y) ** 2);
}

/**
 * Align vertices to axis (snap to grid)
 */
function alignToAxis(vertices, gridSize = 10) {
  return vertices.map(v => ({
    x: Math.round(v.x / gridSize) * gridSize,
    y: Math.round(v.y / gridSize) * gridSize
  }));
}

/**
 * Compute convex hull area using gift wrapping algorithm
 */
function computeConvexHullArea(points) {
  if (points.length < 3) return 0;
  
  // Find convex hull using Jarvis march
  const hull = [];
  
  // Start with leftmost point
  let start = points.reduce((leftmost, p) => 
    p.x < leftmost.x ? p : leftmost
  );
  
  let current = start;
  
  do {
    hull.push(current);
    let next = points[0];
    
    for (const p of points) {
      if (p === current) continue;
      
      const cross = (next.x - current.x) * (p.y - current.y) - 
                   (next.y - current.y) * (p.x - current.x);
      
      if (next === current || cross < 0) {
        next = p;
      }
    }
    
    current = next;
  } while (current !== start && hull.length < points.length);
  
  // Compute area using shoelace formula
  let area = 0;
  for (let i = 0; i < hull.length; i++) {
    const j = (i + 1) % hull.length;
    area += hull[i].x * hull[j].y;
    area -= hull[j].x * hull[i].y;
  }
  
  return Math.abs(area / 2);
}

/**
 * Create bounding box perimeter from bounding box
 */
function createBoundingBoxPerimeter(walls) {
  let minX = Infinity, minY = Infinity;
  let maxX = -Infinity, maxY = -Infinity;
  
  for (const wall of walls) {
    minX = Math.min(minX, wall.chain.x1, wall.chain.x2);
    minY = Math.min(minY, wall.chain.y1, wall.chain.y2);
    maxX = Math.max(maxX, wall.chain.x1, wall.chain.x2);
    maxY = Math.max(maxY, wall.chain.y1, wall.chain.y2);
  }
  
  // Add margin
  const margin = 20;
  
  return {
    vertices: [
      { x: minX - margin, y: minY - margin },
      { x: maxX + margin, y: minY - margin },
      { x: maxX + margin, y: maxY + margin },
      { x: minX - margin, y: maxY + margin }
    ],
    area: (maxX - minX + 2 * margin) * (maxY - minY + 2 * margin)
  };
}

/**
 * Calculate average wall thickness from perimeter walls
 * @param {Array} walls - Perimeter walls
 * @returns {number} Average thickness in pixels
 */
function calculateAverageWallThickness(walls) {
  if (!walls || walls.length === 0) return 6; // Default thickness
  
  const thicknesses = walls
    .map(w => w.thickness)
    .filter(t => t && t > 0);
  
  if (thicknesses.length === 0) return 6;
  
  const avg = thicknesses.reduce((sum, t) => sum + t, 0) / thicknesses.length;
  return Math.max(3, Math.min(avg, 12)); // Clamp between 3-12px
}

/**
 * Offset perimeter vertices for interior/exterior edge
 * @param {Array} vertices - Centerline vertices
 * @param {Array} walls - Perimeter walls
 * @param {boolean} useInteriorWalls - If true, offset inward; if false, offset outward
 * @param {number} wallThickness - Wall thickness in pixels
 * @returns {Array} Offset vertices
 */
function offsetPerimeterVertices(vertices, walls, useInteriorWalls, wallThickness) {
  if (!vertices || vertices.length < 3) return vertices;
  
  // Calculate polygon center to determine inward direction
  const center = {
    x: vertices.reduce((sum, v) => sum + v.x, 0) / vertices.length,
    y: vertices.reduce((sum, v) => sum + v.y, 0) / vertices.length
  };
  
  // Offset distance (half thickness)
  const offsetDist = wallThickness / 2;
  
  // Offset each vertex
  const offsetVertices = vertices.map((vertex, i) => {
    const prev = vertices[(i - 1 + vertices.length) % vertices.length];
    const next = vertices[(i + 1) % vertices.length];
    
    // Calculate normal vector (perpendicular to average of adjacent edges)
    const edge1 = { x: vertex.x - prev.x, y: vertex.y - prev.y };
    const edge2 = { x: next.x - vertex.x, y: next.y - vertex.y };
    
    // Normalize edges
    const len1 = Math.sqrt(edge1.x * edge1.x + edge1.y * edge1.y);
    const len2 = Math.sqrt(edge2.x * edge2.x + edge2.y * edge2.y);
    
    if (len1 === 0 || len2 === 0) return vertex;
    
    edge1.x /= len1;
    edge1.y /= len1;
    edge2.x /= len2;
    edge2.y /= len2;
    
    // Average direction
    let normalX = -(edge1.y + edge2.y) / 2;
    let normalY = (edge1.x + edge2.x) / 2;
    
    const normalLen = Math.sqrt(normalX * normalX + normalY * normalY);
    if (normalLen === 0) return vertex;
    
    normalX /= normalLen;
    normalY /= normalLen;
    
    // Determine if normal points inward or outward
    const toCenter = {
      x: center.x - vertex.x,
      y: center.y - vertex.y
    };
    
    const dot = normalX * toCenter.x + normalY * toCenter.y;
    const pointsInward = dot > 0;
    
    // Flip normal if needed based on desired direction
    if ((useInteriorWalls && !pointsInward) || (!useInteriorWalls && pointsInward)) {
      normalX = -normalX;
      normalY = -normalY;
    }
    
    // Apply offset
    return {
      x: vertex.x + normalX * offsetDist,
      y: vertex.y + normalY * offsetDist
    };
  });
  
  return offsetVertices;
}

/**
 * Switch perimeter edge between interior and exterior without redetection
 * @param {Object} perimeterOverlay - Existing perimeter overlay
 * @param {boolean} useInteriorWalls - New edge type (true = interior, false = exterior)
 * @returns {Object} Updated perimeter overlay
 */
export function switchPerimeterEdge(perimeterOverlay, useInteriorWalls) {
  if (!perimeterOverlay || !perimeterOverlay.centerlineVertices || !perimeterOverlay.wallThickness) {
    console.log('Cannot switch edge: missing centerline data');
    return null;
  }
  
  const { centerlineVertices, walls, wallThickness } = perimeterOverlay;
  
  // Calculate new offset vertices
  const newVertices = offsetPerimeterVertices(
    centerlineVertices,
    walls || [],
    useInteriorWalls,
    wallThickness
  );
  
  console.log(`Switched perimeter to ${useInteriorWalls ? 'interior' : 'exterior'} edge`);
  
  return {
    ...perimeterOverlay,
    vertices: newVertices,
    original: newVertices,
    edgeType: useInteriorWalls ? 'interior' : 'exterior'
  };
}

/**
 * Trace perimeter using topology-guided wall analysis
 * Main entry point - replaces old tracePerimeter function
 * @param {string} imageDataUrl - Image data URL
 * @param {boolean} useInteriorWalls - If true, trace interior edge; if false, trace exterior edge
 * @param {Object} existingTopologyData - Optional existing topology data to reuse
 * @returns {Object} Perimeter with vertices, walls, and topology data
 */
export const tracePerimeter = async (imageDataUrl, useInteriorWalls = true, existingTopologyData = null) => {
  try {
    console.log(`Starting topology-guided perimeter tracing (${useInteriorWalls ? 'interior' : 'exterior'} edge)...`);
    
    const img = await dataUrlToImage(imageDataUrl);
    
    let segments, graph, chains, walls;
    
    // Reuse existing topology data if available
    if (existingTopologyData && existingTopologyData.segments && existingTopologyData.graph && existingTopologyData.walls) {
      console.log('Reusing existing topology data...');
      segments = existingTopologyData.segments;
      graph = existingTopologyData.graph;
      chains = existingTopologyData.chains || [];
      walls = existingTopologyData.walls;
    } else {
      // Step 1: Detect segments
      console.log('Detecting line segments...');
      segments = await detectSegmentsFromImage(img, {
        cannyLow: 50,
        cannyHigh: 150,
        houghThreshold: 50,
        minLineLength: 40, // Slightly longer for perimeter walls
        maxLineGap: 15
      });
    
      console.log(`Found ${segments.length} segments`);
      
      if (segments.length === 0) {
        console.log('No segments detected, using default perimeter');
        return createManualPerimeter(img.width, img.height);
      }
      
      // Step 2: Build topology graph
      console.log('Building topology graph...');
      graph = buildTopologyGraph(segments, {
        endpointTolerance: 10, // More lenient for perimeter
        parallelTolerance: 5
      });
      
      console.log(`Graph: ${graph.nodes.length} nodes, ${graph.edges.length} edges`);
      
      // Step 3: Merge into walls
      console.log('Merging segments into walls...');
      chains = mergeLines(segments, graph, {
        angleTolerance: 5,
        gapTolerance: 15, // More lenient for perimeter
        mergeCollinear: true
      });
      
      console.log(`Created ${chains.length} wall chains`);
      
      // Step 4: Classify walls
      console.log('Classifying walls...');
      walls = classifyWalls(chains, graph, {
        minLength: 40, // Longer minimum for perimeter walls
        minConfidence: 0.3,
        computeThickness: true
      });
      
      console.log(`Classified ${walls.length} walls`);
    }
    
    if (walls.length === 0) {
      console.log('No walls classified, using default perimeter');
      return createManualPerimeter(img.width, img.height);
    }
    
    // Step 5: Find outer perimeter
    console.log('Finding outer perimeter...');
    const perimeter = findOuterPerimeter(graph, walls);
    
    if (!perimeter || perimeter.vertices.length < 3) {
      console.log('Perimeter detection failed, using bounding box');
      const bbox = createBoundingBoxPerimeter(walls);
      return {
        vertices: bbox.vertices,
        original: bbox.vertices,
        centerlineVertices: bbox.vertices,
        walls,
        wallThickness: 6,
        edgeType: useInteriorWalls ? 'interior' : 'exterior',
        topologyData: { segments, graph, walls, chains }
      };
    }
    
    // Calculate centerline vertices and offset for interior/exterior edge
    const centerlineVertices = [...perimeter.vertices];
    const avgWallThickness = calculateAverageWallThickness(perimeter.walls);
    const offsetVertices = offsetPerimeterVertices(
      perimeter.vertices,
      perimeter.walls,
      useInteriorWalls,
      avgWallThickness
    );
    
    console.log(`Successfully traced perimeter with ${offsetVertices.length} vertices (${useInteriorWalls ? 'interior' : 'exterior'} edge)`);
    
    return {
      vertices: offsetVertices,
      original: offsetVertices,
      centerlineVertices,
      walls: perimeter.walls,
      area: perimeter.area,
      wallThickness: avgWallThickness,
      edgeType: useInteriorWalls ? 'interior' : 'exterior',
      topologyData: { segments, graph, walls, chains }
    };
    
  } catch (error) {
    console.error('Error in topology-guided perimeter tracing:', error);
    return null;
  }
};

/**
 * Create manual perimeter (fallback)
 * Replaces old createManualPerimeter function
 */
export const createManualPerimeter = (width, height) => {
  const margin = 50;
  return {
    vertices: [
      { x: margin, y: margin },
      { x: width - margin, y: margin },
      { x: width - margin, y: height - margin },
      { x: margin, y: height - margin }
    ]
  };
};

/**
 * Refine perimeter using additional constraints
 * @param {Object} perimeter - Initial perimeter
 * @param {Object} options - Refinement options
 * @returns {Object} Refined perimeter
 */
export function refinePerimeter(perimeter, options = {}) {
  const {
    enforceRectangular = true,
    minWallLength = 50
  } = options;
  
  if (!perimeter || !perimeter.vertices || perimeter.vertices.length < 3) {
    return perimeter;
  }
  
  let vertices = [...perimeter.vertices];
  
  // Enforce rectangular shape if requested
  if (enforceRectangular && vertices.length === 4) {
    // Find bounding box
    const xs = vertices.map(v => v.x);
    const ys = vertices.map(v => v.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    
    vertices = [
      { x: minX, y: minY },
      { x: maxX, y: minY },
      { x: maxX, y: maxY },
      { x: minX, y: maxY }
    ];
  }
  
  // Remove vertices that create walls shorter than minimum
  const filtered = [];
  for (let i = 0; i < vertices.length; i++) {
    const current = vertices[i];
    const next = vertices[(i + 1) % vertices.length];
    const dist = distance(current, next);
    
    if (dist >= minWallLength || filtered.length === 0) {
      filtered.push(current);
    }
  }
  
  return {
    ...perimeter,
    vertices: filtered
  };
}

/**
 * Export perimeter as SVG path
 * @param {Object} perimeter - Perimeter data
 * @returns {string} SVG path string
 */
export function perimeterToSVGPath(perimeter) {
  if (!perimeter || !perimeter.vertices || perimeter.vertices.length === 0) {
    return '';
  }
  
  const vertices = perimeter.vertices;
  let path = `M ${vertices[0].x} ${vertices[0].y}`;
  
  for (let i = 1; i < vertices.length; i++) {
    path += ` L ${vertices[i].x} ${vertices[i].y}`;
  }
  
  path += ' Z'; // Close path
  
  return path;
}

/**
 * Calculate perimeter length
 * @param {Object} perimeter - Perimeter data
 * @returns {number} Total perimeter length in pixels
 */
export function calculatePerimeterLength(perimeter) {
  if (!perimeter || !perimeter.vertices || perimeter.vertices.length < 2) {
    return 0;
  }
  
  const vertices = perimeter.vertices;
  let totalLength = 0;
  
  for (let i = 0; i < vertices.length; i++) {
    const current = vertices[i];
    const next = vertices[(i + 1) % vertices.length];
    totalLength += distance(current, next);
  }
  
  return totalLength;
}

/**
 * Check if a point is inside the perimeter
 * @param {Object} point - Point with x, y
 * @param {Object} perimeter - Perimeter data
 * @returns {boolean} True if point is inside
 */
export function isPointInPerimeter(point, perimeter) {
  if (!perimeter || !perimeter.vertices || perimeter.vertices.length < 3) {
    return false;
  }
  
  // Ray casting algorithm
  const vertices = perimeter.vertices;
  let inside = false;
  
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const xi = vertices[i].x, yi = vertices[i].y;
    const xj = vertices[j].x, yj = vertices[j].y;
    
    const intersect = ((yi > point.y) !== (yj > point.y)) &&
      (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);
    
    if (intersect) inside = !inside;
  }
  
  return inside;
}
