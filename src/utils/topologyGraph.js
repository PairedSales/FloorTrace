/**
 * topologyGraph.js
 * Build adjacency graph representing connectivity between line segments
 */

import {
  distance,
  angleBetween,
  isCollinear,
  isParallel,
  getEndpoints,
  closestEndpoints,
  boundsOverlap,
  pointToLineDistance
} from './geometryUtils.js';

/**
 * Build a topology graph from line segments
 * @param {Array} segments - Array of line segments
 * @param {Object} options - Configuration options
 * @param {number} options.endpointTolerance - Max distance to consider endpoints connected (default: 8)
 * @param {number} options.parallelTolerance - Max angle difference for parallel lines (default: 5)
 * @param {number} options.collinearTolerance - Tolerances for collinearity check
 * @returns {Object} Graph with nodes, edges, and adjacency info
 */
export function buildTopologyGraph(segments, options = {}) {
  const {
    endpointTolerance = 8,
    parallelTolerance = 5,
    collinearTolerance = { angleTolerance: 5, distanceTolerance: 10 }
  } = options;
  
  // Create nodes from segment endpoints
  const nodes = [];
  const nodeMap = new Map(); // Map of "x,y" -> nodeId
  
  let nodeIdCounter = 0;
  
  // Helper to get or create node
  const getOrCreateNode = (x, y) => {
    // Check if a node exists nearby
    for (const [key, nodeId] of nodeMap.entries()) {
      const node = nodes[nodeId];
      if (distance({ x, y }, { x: node.x, y: node.y }) <= endpointTolerance) {
        return nodeId;
      }
    }
    
    // Create new node
    const nodeId = nodeIdCounter++;
    const node = { id: nodeId, x, y, segments: [] };
    nodes.push(node);
    nodeMap.set(`${x},${y}`, nodeId);
    return nodeId;
  };
  
  // Create edges from segments
  const edges = [];
  const segmentToEdge = new Map();
  
  segments.forEach((segment, idx) => {
    const startNodeId = getOrCreateNode(segment.x1, segment.y1);
    const endNodeId = getOrCreateNode(segment.x2, segment.y2);
    
    const edge = {
      id: `edge_${idx}`,
      segmentId: segment.id || `seg_${idx}`,
      startNode: startNodeId,
      endNode: endNodeId,
      segment,
      length: segment.length,
      angle: segment.angle
    };
    
    edges.push(edge);
    segmentToEdge.set(segment, edge);
    
    // Link nodes to segments
    nodes[startNodeId].segments.push(idx);
    nodes[endNodeId].segments.push(idx);
  });
  
  // Build adjacency relationships
  const adjacency = new Map(); // nodeId -> [connected nodeIds]
  
  edges.forEach(edge => {
    if (!adjacency.has(edge.startNode)) {
      adjacency.set(edge.startNode, []);
    }
    if (!adjacency.has(edge.endNode)) {
      adjacency.set(edge.endNode, []);
    }
    
    adjacency.get(edge.startNode).push(edge.endNode);
    adjacency.get(edge.endNode).push(edge.startNode);
  });
  
  // Find parallel and collinear relationships
  const parallelPairs = [];
  const collinearPairs = [];
  
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      const seg1 = segments[i];
      const seg2 = segments[j];
      
      // Skip if bounding boxes don't overlap
      if (!boundsOverlap(seg1, seg2, 20)) continue;
      
      const angle = angleBetween(seg1, seg2);
      
      if (angle <= parallelTolerance) {
        parallelPairs.push({ seg1: i, seg2: j, angle });
        
        // Check if also collinear
        if (isCollinear(seg1, seg2, collinearTolerance)) {
          collinearPairs.push({ seg1: i, seg2: j, angle });
        }
      }
    }
  }
  
  // Find T-junctions and corner junctions
  const junctions = findJunctions(nodes, edges, segments);
  
  // Build spatial index for fast lookups
  const spatialIndex = buildSpatialIndex(segments, nodes);
  
  return {
    nodes,
    edges,
    adjacency,
    parallelPairs,
    collinearPairs,
    junctions,
    spatialIndex,
    metadata: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      parallelCount: parallelPairs.length,
      collinearCount: collinearPairs.length,
      junctionCount: junctions.length
    }
  };
}

/**
 * Find junction points (nodes where multiple segments meet)
 * @param {Array} nodes - Graph nodes
 * @param {Array} edges - Graph edges
 * @param {Array} segments - Original segments
 * @returns {Array} Array of junction objects
 */
function findJunctions(nodes, edges, segments) {
  const junctions = [];
  
  nodes.forEach(node => {
    const degree = node.segments.length;
    
    if (degree >= 3) {
      // Multi-way junction
      junctions.push({
        nodeId: node.id,
        x: node.x,
        y: node.y,
        degree,
        type: 'multi',
        segments: node.segments
      });
    } else if (degree === 2) {
      // Check if it's a T-junction or corner
      const seg1 = segments[node.segments[0]];
      const seg2 = segments[node.segments[1]];
      
      const angle = angleBetween(seg1, seg2);
      
      if (angle > 75 && angle < 105) {
        // Perpendicular: corner or T-junction
        junctions.push({
          nodeId: node.id,
          x: node.x,
          y: node.y,
          degree,
          type: 'corner',
          angle,
          segments: node.segments
        });
      } else if (angle < 10 || angle > 170) {
        // Collinear: potential merge point
        junctions.push({
          nodeId: node.id,
          x: node.x,
          y: node.y,
          degree,
          type: 'collinear',
          angle,
          segments: node.segments
        });
      }
    }
  });
  
  return junctions;
}

/**
 * Build a spatial index for efficient nearest-neighbor queries
 * Uses a simple grid-based approach
 * @param {Array} segments - Line segments
 * @param {Array} nodes - Graph nodes
 * @param {number} cellSize - Grid cell size (default: 50)
 * @returns {Object} Spatial index
 */
function buildSpatialIndex(segments, nodes, cellSize = 50) {
  const grid = new Map();
  
  const getCellKey = (x, y) => {
    const cx = Math.floor(x / cellSize);
    const cy = Math.floor(y / cellSize);
    return `${cx},${cy}`;
  };
  
  const addToCell = (key, type, id) => {
    if (!grid.has(key)) {
      grid.set(key, { segments: [], nodes: [] });
    }
    grid.get(key)[type].push(id);
  };
  
  // Index segments
  segments.forEach((seg, idx) => {
    const cells = new Set();
    
    // Add all cells the segment passes through
    const minX = Math.min(seg.x1, seg.x2);
    const maxX = Math.max(seg.x1, seg.x2);
    const minY = Math.min(seg.y1, seg.y2);
    const maxY = Math.max(seg.y1, seg.y2);
    
    for (let x = minX; x <= maxX; x += cellSize) {
      for (let y = minY; y <= maxY; y += cellSize) {
        cells.add(getCellKey(x, y));
      }
    }
    
    cells.forEach(key => addToCell(key, 'segments', idx));
  });
  
  // Index nodes
  nodes.forEach((node, idx) => {
    const key = getCellKey(node.x, node.y);
    addToCell(key, 'nodes', idx);
  });
  
  return {
    grid,
    cellSize,
    getCellKey,
    
    /**
     * Query segments near a point
     * @param {number} x - X coordinate
     * @param {number} y - Y coordinate
     * @param {number} radius - Search radius
     * @returns {Array} Segment indices
     */
    querySegments(x, y, radius = cellSize) {
      const results = new Set();
      const cx = Math.floor(x / cellSize);
      const cy = Math.floor(y / cellSize);
      const range = Math.ceil(radius / cellSize);
      
      for (let dx = -range; dx <= range; dx++) {
        for (let dy = -range; dy <= range; dy++) {
          const key = `${cx + dx},${cy + dy}`;
          const cell = grid.get(key);
          if (cell) {
            cell.segments.forEach(id => results.add(id));
          }
        }
      }
      
      return Array.from(results);
    },
    
    /**
     * Query nodes near a point
     * @param {number} x - X coordinate
     * @param {number} y - Y coordinate
     * @param {number} radius - Search radius
     * @returns {Array} Node indices
     */
    queryNodes(x, y, radius = cellSize) {
      const results = new Set();
      const cx = Math.floor(x / cellSize);
      const cy = Math.floor(y / cellSize);
      const range = Math.ceil(radius / cellSize);
      
      for (let dx = -range; dx <= range; dx++) {
        for (let dy = -range; dy <= range; dy++) {
          const key = `${cx + dx},${cy + dy}`;
          const cell = grid.get(key);
          if (cell) {
            cell.nodes.forEach(id => results.add(id));
          }
        }
      }
      
      return Array.from(results);
    }
  };
}

/**
 * Get all neighbors of a node
 * @param {Object} graph - Topology graph
 * @param {number} nodeId - Node ID
 * @returns {Array} Array of neighbor node IDs
 */
export function getNeighbors(graph, nodeId) {
  return graph.adjacency.get(nodeId) || [];
}

/**
 * Get the degree (number of connections) of a node
 * @param {Object} graph - Topology graph
 * @param {number} nodeId - Node ID
 * @returns {number} Node degree
 */
export function getNodeDegree(graph, nodeId) {
  const neighbors = graph.adjacency.get(nodeId);
  return neighbors ? neighbors.length : 0;
}

/**
 * Find all nodes within a radius of a point
 * @param {Object} graph - Topology graph
 * @param {number} x - X coordinate
 * @param {number} y - Y coordinate
 * @param {number} radius - Search radius
 * @returns {Array} Array of nodes
 */
export function findNodesNear(graph, x, y, radius) {
  return graph.nodes.filter(node => {
    return distance({ x, y }, { x: node.x, y: node.y }) <= radius;
  });
}

/**
 * Find connected components in the graph
 * @param {Object} graph - Topology graph
 * @returns {Array} Array of components (each is an array of node IDs)
 */
export function findConnectedComponents(graph) {
  const visited = new Set();
  const components = [];
  
  const dfs = (nodeId, component) => {
    visited.add(nodeId);
    component.push(nodeId);
    
    const neighbors = getNeighbors(graph, nodeId);
    neighbors.forEach(neighborId => {
      if (!visited.has(neighborId)) {
        dfs(neighborId, component);
      }
    });
  };
  
  graph.nodes.forEach(node => {
    if (!visited.has(node.id)) {
      const component = [];
      dfs(node.id, component);
      components.push(component);
    }
  });
  
  return components;
}

/**
 * Find the shortest path between two nodes using BFS
 * @param {Object} graph - Topology graph
 * @param {number} startNodeId - Start node ID
 * @param {number} endNodeId - End node ID
 * @returns {Array|null} Path as array of node IDs, or null if no path
 */
export function findPath(graph, startNodeId, endNodeId) {
  if (startNodeId === endNodeId) return [startNodeId];
  
  const queue = [[startNodeId]];
  const visited = new Set([startNodeId]);
  
  while (queue.length > 0) {
    const path = queue.shift();
    const current = path[path.length - 1];
    
    const neighbors = getNeighbors(graph, current);
    
    for (const neighbor of neighbors) {
      if (neighbor === endNodeId) {
        return [...path, neighbor];
      }
      
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push([...path, neighbor]);
      }
    }
  }
  
  return null; // No path found
}

/**
 * Get all edges connected to a node
 * @param {Object} graph - Topology graph
 * @param {number} nodeId - Node ID
 * @returns {Array} Array of edges
 */
export function getNodeEdges(graph, nodeId) {
  return graph.edges.filter(edge => {
    return edge.startNode === nodeId || edge.endNode === nodeId;
  });
}

/**
 * Check if two segments are bridgeable (small gap + collinear)
 * @param {Object} seg1 - First segment
 * @param {Object} seg2 - Second segment
 * @param {number} maxGap - Maximum gap distance (default: 8)
 * @param {Object} collinearOptions - Collinearity options
 * @returns {boolean} True if bridgeable
 */
export function areBridgeable(seg1, seg2, maxGap = 8, collinearOptions = {}) {
  // Check collinearity first
  if (!isCollinear(seg1, seg2, collinearOptions)) {
    return false;
  }
  
  // Check gap between closest endpoints
  const closest = closestEndpoints(seg1, seg2);
  return closest.distance <= maxGap;
}

/**
 * Export graph to a serializable format
 * @param {Object} graph - Topology graph
 * @returns {Object} Serializable graph data
 */
export function exportGraph(graph) {
  return {
    nodes: graph.nodes.map(n => ({ id: n.id, x: n.x, y: n.y, degree: n.segments.length })),
    edges: graph.edges.map(e => ({
      id: e.id,
      start: e.startNode,
      end: e.endNode,
      length: e.length,
      angle: e.angle
    })),
    parallelPairs: graph.parallelPairs,
    collinearPairs: graph.collinearPairs,
    junctions: graph.junctions,
    metadata: graph.metadata
  };
}
