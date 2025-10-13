/**
 * topology.integration.test.js
 * Integration tests for the complete topology pipeline
 * Tests every step of the process for debugging
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  loadExampleFloorplan,
  createMockSegments,
  validateTopologyResult,
  assertValidSegments,
  assertValidGraph,
  assertValidWalls
} from './testUtils.js';
import { buildTopologyGraph } from './topologyGraph.js';
import { mergeLines } from './lineMerging.js';
import { classifyWalls, getWallStatistics } from './wallClassifier.js';

describe('Topology Pipeline Integration Tests', () => {
  beforeAll(async () => {
    try {
      await loadExampleFloorplan();
      console.log('Loaded example floorplan for testing');
    } catch (error) {
      console.warn('Using mock data for tests:', error.message);
    }
  });
  
  describe('Step 1: Segment Detection', () => {
    it('detects segments from mock data', () => {
      const mockSegments = createMockSegments('simple');
      
      expect(mockSegments.length).toBeGreaterThan(0);
      assertValidSegments(mockSegments);
    });
    
    it('handles collinear segment patterns', () => {
      const segments = createMockSegments('collinear');
      
      expect(segments.length).toBe(3);
      assertValidSegments(segments);
      
      // All should have same angle (horizontal)
      const angles = segments.map(s => s.angle);
      expect(angles.every(a => a === 0)).toBe(true);
    });
    
    it('handles parallel segment patterns', () => {
      const segments = createMockSegments('parallel');
      
      expect(segments.length).toBe(3);
      assertValidSegments(segments);
      
      // All should be parallel (same angle)
      const angles = segments.map(s => s.angle);
      expect(angles.every(a => a === 0)).toBe(true);
    });
    
    it('handles grid patterns', () => {
      const segments = createMockSegments('grid');
      
      expect(segments.length).toBeGreaterThan(0);
      assertValidSegments(segments);
      
      // Should have both horizontal and vertical segments
      const hasHorizontal = segments.some(s => Math.abs(s.angle) < 0.1);
      const hasVertical = segments.some(s => Math.abs(s.angle - Math.PI/2) < 0.1);
      
      expect(hasHorizontal).toBe(true);
      expect(hasVertical).toBe(true);
    });
    
    it('handles complex patterns', () => {
      const segments = createMockSegments('complex');
      
      expect(segments.length).toBeGreaterThan(0);
      assertValidSegments(segments);
    });
  });
  
  describe('Step 2: Topology Graph Building', () => {
    it('builds graph from simple segments', () => {
      const segments = createMockSegments('simple');
      const graph = buildTopologyGraph(segments);
      
      assertValidGraph(graph);
      
      expect(graph.nodes.length).toBeGreaterThan(0);
      expect(graph.edges.length).toBe(segments.length);
      expect(graph.metadata).toBeDefined();
    });
    
    it('builds graph with correct node merging', () => {
      const segments = createMockSegments('simple');
      const graph = buildTopologyGraph(segments, { endpointTolerance: 5 });
      
      assertValidGraph(graph);
      
      // Square has 4 corners, so should have exactly 4 nodes
      expect(graph.nodes.length).toBe(4);
    });
    
    it('detects junctions in grid pattern', () => {
      const segments = createMockSegments('grid');
      const graph = buildTopologyGraph(segments, { endpointTolerance: 5 });
      
      assertValidGraph(graph);
      
      expect(graph.junctions).toBeDefined();
      expect(graph.junctions.length).toBeGreaterThan(0);
    });
    
    it('detects parallel pairs', () => {
      const segments = createMockSegments('parallel');
      const graph = buildTopologyGraph(segments);
      
      assertValidGraph(graph);
      
      expect(graph.parallelPairs).toBeDefined();
      expect(graph.parallelPairs.length).toBeGreaterThan(0);
    });
    
    it('detects collinear pairs', () => {
      const segments = createMockSegments('collinear');
      const graph = buildTopologyGraph(segments);
      
      assertValidGraph(graph);
      
      expect(graph.collinearPairs).toBeDefined();
      expect(graph.collinearPairs.length).toBeGreaterThan(0);
    });
    
    it('creates functional spatial index', () => {
      const segments = createMockSegments('grid');
      const graph = buildTopologyGraph(segments);
      
      assertValidGraph(graph);
      
      expect(graph.spatialIndex).toBeDefined();
      expect(typeof graph.spatialIndex.querySegments).toBe('function');
      expect(typeof graph.spatialIndex.queryNodes).toBe('function');
      
      // Test spatial query
      const nearSegments = graph.spatialIndex.querySegments(50, 50, 100);
      expect(Array.isArray(nearSegments)).toBe(true);
    });
    
    it('builds correct adjacency relationships', () => {
      const segments = createMockSegments('simple');
      const graph = buildTopologyGraph(segments, { endpointTolerance: 5 });
      
      assertValidGraph(graph);
      
      // Each node in a square should have degree 2
      graph.nodes.forEach(node => {
        const neighbors = graph.adjacency.get(node.id) || [];
        expect(neighbors.length).toBe(2);
      });
    });
  });
  
  describe('Step 3: Line Merging', () => {
    it('merges collinear segments into chains', () => {
      const segments = createMockSegments('collinear');
      const graph = buildTopologyGraph(segments, { endpointTolerance: 2 });
      const chains = mergeLines(segments, graph);
      
      expect(chains.length).toBeGreaterThan(0);
      expect(chains.length).toBeLessThanOrEqual(segments.length);
      
      // Should merge into one chain
      expect(chains.length).toBe(1);
      expect(chains[0].segments.length).toBe(3);
    });
    
    it('preserves perpendicular segments separately', () => {
      const segments = createMockSegments('simple');
      const graph = buildTopologyGraph(segments, { endpointTolerance: 5 });
      const chains = mergeLines(segments, graph, { angleTolerance: 5 });
      
      expect(chains.length).toBeGreaterThan(0);
      
      // Each chain should have merged line
      chains.forEach(chain => {
        expect(chain.merged).toBeDefined();
        expect(chain.merged.length).toBeGreaterThan(0);
      });
    });
    
    it('computes chain confidence scores', () => {
      const segments = createMockSegments('collinear');
      const graph = buildTopologyGraph(segments, { endpointTolerance: 2 });
      const chains = mergeLines(segments, graph);
      
      chains.forEach(chain => {
        expect(chain.confidence).toBeDefined();
        expect(chain.confidence).toBeGreaterThan(0);
        expect(chain.confidence).toBeLessThanOrEqual(1);
      });
    });
    
    it('assigns correct orientations', () => {
      const segments = createMockSegments('grid');
      const graph = buildTopologyGraph(segments, { endpointTolerance: 5 });
      const chains = mergeLines(segments, graph);
      
      const hasHorizontal = chains.some(c => c.orientation === 'horizontal');
      const hasVertical = chains.some(c => c.orientation === 'vertical');
      
      expect(hasHorizontal).toBe(true);
      expect(hasVertical).toBe(true);
    });
    
    it('handles complex patterns with mixed orientations', () => {
      const segments = createMockSegments('complex');
      const graph = buildTopologyGraph(segments, { endpointTolerance: 5 });
      const chains = mergeLines(segments, graph);
      
      expect(chains.length).toBeGreaterThan(0);
      
      // Should have different orientations
      const orientations = new Set(chains.map(c => c.orientation));
      expect(orientations.size).toBeGreaterThan(1);
    });
  });
  
  describe('Step 4: Wall Classification', () => {
    it('classifies walls with proper attributes', () => {
      const segments = createMockSegments('simple');
      const graph = buildTopologyGraph(segments, { endpointTolerance: 5 });
      const chains = mergeLines(segments, graph);
      const walls = classifyWalls(chains, graph);
      
      assertValidWalls(walls);
      
      walls.forEach(wall => {
        expect(wall.type).toBeDefined();
        expect(wall.quality).toBeDefined();
        expect(wall.connectivityDegree).toBeDefined();
      });
    });
    
    it('filters walls by minimum length', () => {
      const segments = createMockSegments('grid');
      const graph = buildTopologyGraph(segments, { endpointTolerance: 5 });
      const chains = mergeLines(segments, graph);
      const walls = classifyWalls(chains, graph, { minLength: 100 });
      
      assertValidWalls(walls);
      
      walls.forEach(wall => {
        expect(wall.length).toBeGreaterThanOrEqual(100);
      });
    });
    
    it('filters walls by minimum confidence', () => {
      const segments = createMockSegments('collinear');
      const graph = buildTopologyGraph(segments, { endpointTolerance: 2 });
      const chains = mergeLines(segments, graph);
      const walls = classifyWalls(chains, graph, { minConfidence: 0.5 });
      
      assertValidWalls(walls);
      
      walls.forEach(wall => {
        expect(wall.confidence).toBeGreaterThanOrEqual(0.5);
      });
    });
    
    it('computes thickness when enabled', () => {
      const segments = createMockSegments('simple');
      const graph = buildTopologyGraph(segments, { endpointTolerance: 5 });
      const chains = mergeLines(segments, graph);
      const walls = classifyWalls(chains, graph, { computeThickness: true });
      
      assertValidWalls(walls);
      
      walls.forEach(wall => {
        expect(wall.thickness).toBeDefined();
        expect(wall.thickness).toBeGreaterThan(0);
      });
    });
    
    it('assigns correct wall types', () => {
      const segments = createMockSegments('grid');
      const graph = buildTopologyGraph(segments, { endpointTolerance: 5 });
      const chains = mergeLines(segments, graph);
      const walls = classifyWalls(chains, graph);
      
      assertValidWalls(walls);
      
      const types = new Set(walls.map(w => w.type));
      expect(types.size).toBeGreaterThan(0);
    });
  });
  
  describe('Step 5: Statistics Generation', () => {
    it('generates comprehensive statistics', () => {
      const segments = createMockSegments('grid');
      const graph = buildTopologyGraph(segments, { endpointTolerance: 5 });
      const chains = mergeLines(segments, graph);
      const walls = classifyWalls(chains, graph);
      const stats = getWallStatistics(walls);
      
      expect(stats.count).toBe(walls.length);
      expect(stats.totalLength).toBeGreaterThan(0);
      expect(stats.avgLength).toBeGreaterThan(0);
      expect(stats.avgConfidence).toBeGreaterThan(0);
      expect(stats.orientations).toBeDefined();
      expect(stats.types).toBeDefined();
    });
    
    it('calculates correct aggregates', () => {
      const segments = createMockSegments('simple');
      const graph = buildTopologyGraph(segments, { endpointTolerance: 5 });
      const chains = mergeLines(segments, graph);
      const walls = classifyWalls(chains, graph);
      const stats = getWallStatistics(walls);
      
      const manualTotal = walls.reduce((sum, w) => sum + w.length, 0);
      expect(stats.totalLength).toBeCloseTo(manualTotal, 1);
      
      const manualAvg = manualTotal / walls.length;
      expect(stats.avgLength).toBeCloseTo(manualAvg, 1);
    });
  });
  
  describe('Full Pipeline Integration', () => {
    it('runs complete pipeline on simple pattern', () => {
      const segments = createMockSegments('simple');
      const graph = buildTopologyGraph(segments, { endpointTolerance: 5 });
      const chains = mergeLines(segments, graph);
      const walls = classifyWalls(chains, graph);
      const stats = getWallStatistics(walls);
      
      const result = { segments, graph, chains, walls, statistics: stats };
      const validation = validateTopologyResult(result);
      
      expect(validation.valid).toBe(true);
      if (!validation.valid) {
        console.error('Validation errors:', validation.errors);
      }
    });
    
    it('runs complete pipeline on collinear pattern', () => {
      const segments = createMockSegments('collinear');
      const graph = buildTopologyGraph(segments, { endpointTolerance: 2 });
      const chains = mergeLines(segments, graph);
      const walls = classifyWalls(chains, graph);
      const stats = getWallStatistics(walls);
      
      const result = { segments, graph, chains, walls, statistics: stats };
      const validation = validateTopologyResult(result);
      
      expect(validation.valid).toBe(true);
      
      // Should merge into single wall
      expect(walls.length).toBe(1);
      expect(walls[0].segmentCount).toBe(3);
    });
    
    it('runs complete pipeline on parallel pattern', () => {
      const segments = createMockSegments('parallel');
      const graph = buildTopologyGraph(segments);
      const chains = mergeLines(segments, graph);
      const walls = classifyWalls(chains, graph);
      const stats = getWallStatistics(walls);
      
      const result = { segments, graph, chains, walls, statistics: stats };
      const validation = validateTopologyResult(result);
      
      expect(validation.valid).toBe(true);
      
      // Should detect parallel walls
      expect(graph.parallelPairs.length).toBeGreaterThan(0);
    });
    
    it('runs complete pipeline on grid pattern', () => {
      const segments = createMockSegments('grid');
      const graph = buildTopologyGraph(segments, { endpointTolerance: 5 });
      const chains = mergeLines(segments, graph);
      const walls = classifyWalls(chains, graph);
      const stats = getWallStatistics(walls);
      
      const result = { segments, graph, chains, walls, statistics: stats };
      const validation = validateTopologyResult(result);
      
      expect(validation.valid).toBe(true);
      
      // Should have junctions at intersections
      expect(graph.junctions.length).toBeGreaterThan(0);
      
      // Should have both orientations
      expect(stats.orientations.horizontal).toBeGreaterThan(0);
      expect(stats.orientations.vertical).toBeGreaterThan(0);
    });
    
    it('runs complete pipeline on complex pattern', () => {
      const segments = createMockSegments('complex');
      const graph = buildTopologyGraph(segments, { endpointTolerance: 5 });
      const chains = mergeLines(segments, graph);
      const walls = classifyWalls(chains, graph);
      const stats = getWallStatistics(walls);
      
      const result = { segments, graph, chains, walls, statistics: stats };
      const validation = validateTopologyResult(result);
      
      expect(validation.valid).toBe(true);
      
      // Should handle diagonal segments
      const hasDiagonal = walls.some(w => w.orientation === 'diagonal');
      expect(hasDiagonal).toBe(true);
    });
    
    it('produces consistent results across runs', () => {
      const segments1 = createMockSegments('simple');
      const graph1 = buildTopologyGraph(segments1, { endpointTolerance: 5 });
      const chains1 = mergeLines(segments1, graph1);
      const walls1 = classifyWalls(chains1, graph1);
      
      const segments2 = createMockSegments('simple');
      const graph2 = buildTopologyGraph(segments2, { endpointTolerance: 5 });
      const chains2 = mergeLines(segments2, graph2);
      const walls2 = classifyWalls(chains2, graph2);
      
      expect(walls1.length).toBe(walls2.length);
      expect(graph1.nodes.length).toBe(graph2.nodes.length);
    });
    
    it('handles edge case: empty segments', () => {
      const segments = [];
      const graph = buildTopologyGraph(segments);
      const chains = mergeLines(segments, graph);
      const walls = classifyWalls(chains, graph);
      const stats = getWallStatistics(walls);
      
      expect(graph.nodes.length).toBe(0);
      expect(chains.length).toBe(0);
      expect(walls.length).toBe(0);
      expect(stats.count).toBe(0);
    });
    
    it('handles edge case: single segment', () => {
      const segments = [
        { x1: 0, y1: 0, x2: 100, y2: 0, id: 'seg_0', length: 100, angle: 0 }
      ];
      const graph = buildTopologyGraph(segments);
      const chains = mergeLines(segments, graph);
      const walls = classifyWalls(chains, graph);
      
      expect(graph.nodes.length).toBe(2);
      expect(graph.edges.length).toBe(1);
      expect(chains.length).toBe(1);
      expect(walls.length).toBe(1);
    });
  });
  
  describe('Performance Tests', () => {
    it('handles large segment counts efficiently', () => {
      // Create a large grid
      const segments = [];
      let id = 0;
      
      for (let y = 0; y <= 500; y += 50) {
        segments.push({
          x1: 0, y1: y, x2: 500, y2: y,
          id: `seg_${id++}`,
          length: 500,
          angle: 0
        });
      }
      
      for (let x = 0; x <= 500; x += 50) {
        segments.push({
          x1: x, y1: 0, x2: x, y2: 500,
          id: `seg_${id++}`,
          length: 500,
          angle: Math.PI/2
        });
      }
      
      const startTime = Date.now();
      
      const graph = buildTopologyGraph(segments, { endpointTolerance: 5 });
      const chains = mergeLines(segments, graph);
      const walls = classifyWalls(chains, graph);
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      // Should complete in reasonable time (< 1 second for this size)
      expect(duration).toBeLessThan(1000);
      expect(walls.length).toBeGreaterThan(0);
    });
  });
});
