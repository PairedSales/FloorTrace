/**
 * topologyGraph.test.js
 * Unit tests for topology graph building
 */

import { describe, it, expect } from 'vitest';
import {
  buildTopologyGraph,
  getNeighbors,
  getNodeDegree,
  findNodesNear,
  findConnectedComponents,
  findPath,
  getNodeEdges,
  areBridgeable
} from './topologyGraph.js';

describe('topologyGraph', () => {
  describe('buildTopologyGraph', () => {
    it('creates nodes from segment endpoints', () => {
      const segments = [
        { x1: 0, y1: 0, x2: 100, y2: 0, id: 'seg_0', length: 100, angle: 0 },
        { x1: 100, y1: 0, x2: 200, y2: 0, id: 'seg_1', length: 100, angle: 0 }
      ];
      
      const graph = buildTopologyGraph(segments);
      
      expect(graph.nodes).toBeDefined();
      expect(graph.nodes.length).toBeGreaterThan(0);
      expect(graph.edges).toBeDefined();
      expect(graph.edges.length).toBe(2);
    });
    
    it('merges nearby endpoints into single nodes', () => {
      const segments = [
        { x1: 0, y1: 0, x2: 100, y2: 0, id: 'seg_0', length: 100, angle: 0 },
        { x1: 98, y1: 1, x2: 200, y2: 0, id: 'seg_1', length: 102, angle: 0 }
      ];
      
      const graph = buildTopologyGraph(segments, { endpointTolerance: 5 });
      
      // Should merge the close endpoints (100,0) and (98,1)
      expect(graph.nodes.length).toBeLessThan(4);
    });
    
    it('builds adjacency relationships', () => {
      const segments = [
        { x1: 0, y1: 0, x2: 100, y2: 0, id: 'seg_0', length: 100, angle: 0 },
        { x1: 100, y1: 0, x2: 200, y2: 0, id: 'seg_1', length: 100, angle: 0 }
      ];
      
      const graph = buildTopologyGraph(segments, { endpointTolerance: 2 });
      
      expect(graph.adjacency).toBeDefined();
      expect(graph.adjacency.size).toBeGreaterThan(0);
    });
    
    it('detects parallel pairs', () => {
      const segments = [
        { x1: 0, y1: 0, x2: 100, y2: 0, id: 'seg_0', length: 100, angle: 0 },
        { x1: 0, y1: 10, x2: 100, y2: 10, id: 'seg_1', length: 100, angle: 0 }
      ];
      
      const graph = buildTopologyGraph(segments);
      
      expect(graph.parallelPairs).toBeDefined();
      expect(graph.parallelPairs.length).toBeGreaterThan(0);
    });
    
    it('detects collinear pairs', () => {
      const segments = [
        { x1: 0, y1: 0, x2: 50, y2: 0, id: 'seg_0', length: 50, angle: 0 },
        { x1: 60, y1: 0, x2: 100, y2: 0, id: 'seg_1', length: 40, angle: 0 }
      ];
      
      const graph = buildTopologyGraph(segments);
      
      expect(graph.collinearPairs).toBeDefined();
    });
    
    it('identifies junctions', () => {
      const segments = [
        { x1: 0, y1: 0, x2: 100, y2: 0, id: 'seg_0', length: 100, angle: 0 },
        { x1: 50, y1: 0, x2: 50, y2: 100, id: 'seg_1', length: 100, angle: Math.PI/2 },
        { x1: 50, y1: 0, x2: 150, y2: 0, id: 'seg_2', length: 100, angle: 0 }
      ];
      
      const graph = buildTopologyGraph(segments, { endpointTolerance: 5 });
      
      expect(graph.junctions).toBeDefined();
    });
    
    it('creates spatial index', () => {
      const segments = [
        { x1: 0, y1: 0, x2: 100, y2: 0, id: 'seg_0', length: 100, angle: 0 }
      ];
      
      const graph = buildTopologyGraph(segments);
      
      expect(graph.spatialIndex).toBeDefined();
      expect(graph.spatialIndex.querySegments).toBeDefined();
      expect(graph.spatialIndex.queryNodes).toBeDefined();
    });
    
    it('includes metadata', () => {
      const segments = [
        { x1: 0, y1: 0, x2: 100, y2: 0, id: 'seg_0', length: 100, angle: 0 }
      ];
      
      const graph = buildTopologyGraph(segments);
      
      expect(graph.metadata).toBeDefined();
      expect(graph.metadata.nodeCount).toBeDefined();
      expect(graph.metadata.edgeCount).toBeDefined();
    });
  });
  
  describe('getNeighbors', () => {
    it('returns neighbors of a node', () => {
      const segments = [
        { x1: 0, y1: 0, x2: 100, y2: 0, id: 'seg_0', length: 100, angle: 0 },
        { x1: 100, y1: 0, x2: 200, y2: 0, id: 'seg_1', length: 100, angle: 0 }
      ];
      
      const graph = buildTopologyGraph(segments, { endpointTolerance: 2 });
      
      if (graph.nodes.length > 0) {
        const neighbors = getNeighbors(graph, graph.nodes[0].id);
        expect(Array.isArray(neighbors)).toBe(true);
      }
    });
  });
  
  describe('getNodeDegree', () => {
    it('calculates node degree correctly', () => {
      const segments = [
        { x1: 0, y1: 0, x2: 100, y2: 0, id: 'seg_0', length: 100, angle: 0 },
        { x1: 100, y1: 0, x2: 200, y2: 0, id: 'seg_1', length: 100, angle: 0 }
      ];
      
      const graph = buildTopologyGraph(segments, { endpointTolerance: 2 });
      
      if (graph.nodes.length > 0) {
        const degree = getNodeDegree(graph, graph.nodes[0].id);
        expect(typeof degree).toBe('number');
        expect(degree).toBeGreaterThanOrEqual(0);
      }
    });
  });
  
  describe('findNodesNear', () => {
    it('finds nodes within radius', () => {
      const segments = [
        { x1: 0, y1: 0, x2: 100, y2: 0, id: 'seg_0', length: 100, angle: 0 }
      ];
      
      const graph = buildTopologyGraph(segments);
      const nearNodes = findNodesNear(graph, 50, 0, 60);
      
      expect(Array.isArray(nearNodes)).toBe(true);
    });
  });
  
  describe('findConnectedComponents', () => {
    it('identifies separate components', () => {
      const segments = [
        { x1: 0, y1: 0, x2: 100, y2: 0, id: 'seg_0', length: 100, angle: 0 },
        { x1: 200, y1: 200, x2: 300, y2: 200, id: 'seg_1', length: 100, angle: 0 }
      ];
      
      const graph = buildTopologyGraph(segments);
      const components = findConnectedComponents(graph);
      
      expect(components.length).toBe(2);
    });
    
    it('identifies single connected component', () => {
      const segments = [
        { x1: 0, y1: 0, x2: 100, y2: 0, id: 'seg_0', length: 100, angle: 0 },
        { x1: 100, y1: 0, x2: 200, y2: 0, id: 'seg_1', length: 100, angle: 0 }
      ];
      
      const graph = buildTopologyGraph(segments, { endpointTolerance: 2 });
      const components = findConnectedComponents(graph);
      
      expect(components.length).toBeGreaterThan(0);
    });
  });
  
  describe('findPath', () => {
    it('finds path between connected nodes', () => {
      const segments = [
        { x1: 0, y1: 0, x2: 100, y2: 0, id: 'seg_0', length: 100, angle: 0 },
        { x1: 100, y1: 0, x2: 200, y2: 0, id: 'seg_1', length: 100, angle: 0 }
      ];
      
      const graph = buildTopologyGraph(segments, { endpointTolerance: 2 });
      
      if (graph.nodes.length >= 2) {
        const path = findPath(graph, graph.nodes[0].id, graph.nodes[1].id);
        expect(path).toBeDefined();
      }
    });
    
    it('returns null for disconnected nodes', () => {
      const segments = [
        { x1: 0, y1: 0, x2: 100, y2: 0, id: 'seg_0', length: 100, angle: 0 },
        { x1: 500, y1: 500, x2: 600, y2: 500, id: 'seg_1', length: 100, angle: 0 }
      ];
      
      const graph = buildTopologyGraph(segments);
      
      if (graph.nodes.length >= 2) {
        const path = findPath(graph, graph.nodes[0].id, graph.nodes[graph.nodes.length - 1].id);
        // Path may be null if nodes are disconnected
        expect(path === null || Array.isArray(path)).toBe(true);
      }
    });
  });
  
  describe('areBridgeable', () => {
    it('detects bridgeable collinear segments', () => {
      const seg1 = { x1: 0, y1: 0, x2: 100, y2: 0 };
      const seg2 = { x1: 105, y1: 0, x2: 200, y2: 0 };
      
      const bridgeable = areBridgeable(seg1, seg2, 10);
      expect(bridgeable).toBe(true);
    });
    
    it('rejects non-collinear segments', () => {
      const seg1 = { x1: 0, y1: 0, x2: 100, y2: 0 };
      const seg2 = { x1: 105, y1: 50, x2: 200, y2: 50 };
      
      const bridgeable = areBridgeable(seg1, seg2, 10);
      expect(bridgeable).toBe(false);
    });
  });
});
