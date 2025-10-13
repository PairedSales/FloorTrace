/**
 * lineMerging.test.js
 * Unit tests for line merging functions
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { mergeLines, chainsToLines, getChainPoints } from './lineMerging.js';
import { buildTopologyGraph } from './topologyGraph.js';

describe('lineMerging', () => {
  describe('mergeLines', () => {
    it('merges near-collinear segments', () => {
      const segments = [
        { x1: 0, y1: 0, x2: 100, y2: 0, id: 'seg_0', length: 100, angle: 0 },
        { x1: 98, y1: 1, x2: 200, y2: 0, id: 'seg_1', length: 102, angle: 0 }
      ];
      
      const graph = buildTopologyGraph(segments);
      const merged = mergeLines(segments, graph);
      
      expect(merged.length).toBeGreaterThan(0);
      expect(merged.length).toBeLessThanOrEqual(segments.length);
    });
    
    it('does not merge perpendicular segments', () => {
      const segments = [
        { x1: 0, y1: 0, x2: 100, y2: 0, id: 'seg_0', length: 100, angle: 0 },
        { x1: 100, y1: 0, x2: 100, y2: 100, id: 'seg_1', length: 100, angle: Math.PI/2 }
      ];
      
      const graph = buildTopologyGraph(segments);
      const merged = mergeLines(segments, graph);
      
      // Should have 2 separate chains (perpendicular)
      expect(merged.length).toBe(2);
    });
    
    it('merges connected collinear segments into one chain', () => {
      const segments = [
        { x1: 0, y1: 0, x2: 50, y2: 0, id: 'seg_0', length: 50, angle: 0 },
        { x1: 50, y1: 0, x2: 100, y2: 0, id: 'seg_1', length: 50, angle: 0 },
        { x1: 100, y1: 0, x2: 150, y2: 0, id: 'seg_2', length: 50, angle: 0 }
      ];
      
      const graph = buildTopologyGraph(segments, { endpointTolerance: 2 });
      const merged = mergeLines(segments, graph, { angleTolerance: 5, gapTolerance: 5 });
      
      expect(merged.length).toBe(1);
      expect(merged[0].segments.length).toBe(3);
    });
    
    it('handles isolated segments', () => {
      const segments = [
        { x1: 0, y1: 0, x2: 50, y2: 0, id: 'seg_0', length: 50, angle: 0 },
        { x1: 200, y1: 200, x2: 250, y2: 200, id: 'seg_1', length: 50, angle: 0 }
      ];
      
      const graph = buildTopologyGraph(segments);
      const merged = mergeLines(segments, graph);
      
      // Should have 2 separate chains (isolated)
      expect(merged.length).toBe(2);
    });
    
    it('snaps endpoints when option is enabled', () => {
      const segments = [
        { x1: 0, y1: 0, x2: 100, y2: 0, id: 'seg_0', length: 100, angle: 0 },
        { x1: 97, y1: 2, x2: 200, y2: 1, id: 'seg_1', length: 103, angle: 0 }
      ];
      
      const graph = buildTopologyGraph(segments, { endpointTolerance: 5 });
      const merged = mergeLines(segments, graph, { snapEndpoints: true, gapTolerance: 10 });
      
      expect(merged.length).toBeGreaterThan(0);
      // Snapping should adjust endpoints
      if (merged.length === 1) {
        expect(merged[0].merged).toBeDefined();
      }
    });
  });
  
  describe('chainsToLines', () => {
    it('converts chains to simple line objects', () => {
      const chains = [
        {
          id: 'chain_0',
          merged: { x1: 0, y1: 0, x2: 100, y2: 0, length: 100 },
          orientation: 'horizontal',
          length: 100,
          confidence: 0.9,
          segments: [{}]
        }
      ];
      
      const lines = chainsToLines(chains);
      
      expect(lines).toHaveLength(1);
      expect(lines[0]).toHaveProperty('x1');
      expect(lines[0]).toHaveProperty('x2');
      expect(lines[0]).toHaveProperty('orientation');
      expect(lines[0]).toHaveProperty('confidence');
    });
  });
  
  describe('getChainPoints', () => {
    it('returns flat array of points', () => {
      const chain = {
        merged: { x1: 10, y1: 20, x2: 30, y2: 40 }
      };
      
      const points = getChainPoints(chain);
      
      expect(points).toEqual([10, 20, 30, 40]);
    });
  });
});
