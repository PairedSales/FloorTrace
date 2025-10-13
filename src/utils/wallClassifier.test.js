/**
 * wallClassifier.test.js
 * Unit tests for wall classification
 */

import { describe, it, expect } from 'vitest';
import {
  classifyWalls,
  filterWallsByOrientation,
  filterWallsByType,
  getWallStatistics,
  rankWallsByImportance,
  exportWalls
} from './wallClassifier.js';
import { buildTopologyGraph } from './topologyGraph.js';

describe('wallClassifier', () => {
  describe('classifyWalls', () => {
    it('filters walls by minimum length', () => {
      const chains = [
        {
          id: 'chain_0',
          merged: { x1: 0, y1: 0, x2: 10, y2: 0, length: 10 },
          segments: [{}],
          orientation: 'horizontal',
          length: 10,
          confidence: 0.8
        },
        {
          id: 'chain_1',
          merged: { x1: 0, y1: 10, x2: 100, y2: 10, length: 100 },
          segments: [{}],
          orientation: 'horizontal',
          length: 100,
          confidence: 0.8
        }
      ];
      
      const segments = [
        { x1: 0, y1: 0, x2: 10, y2: 0, id: 'seg_0', length: 10, angle: 0 },
        { x1: 0, y1: 10, x2: 100, y2: 10, id: 'seg_1', length: 100, angle: 0 }
      ];
      
      const graph = buildTopologyGraph(segments);
      const walls = classifyWalls(chains, graph, { minLength: 25 });
      
      expect(walls.length).toBe(1);
      expect(walls[0].length).toBeGreaterThanOrEqual(25);
    });
    
    it('filters walls by minimum confidence', () => {
      const chains = [
        {
          id: 'chain_0',
          merged: { x1: 0, y1: 0, x2: 100, y2: 0, length: 100 },
          segments: [{}],
          orientation: 'horizontal',
          length: 100,
          confidence: 0.2
        },
        {
          id: 'chain_1',
          merged: { x1: 0, y1: 10, x2: 100, y2: 10, length: 100 },
          segments: [{}],
          orientation: 'horizontal',
          length: 100,
          confidence: 0.9
        }
      ];
      
      const segments = [
        { x1: 0, y1: 0, x2: 100, y2: 0, id: 'seg_0', length: 100, angle: 0 },
        { x1: 0, y1: 10, x2: 100, y2: 10, id: 'seg_1', length: 100, angle: 0 }
      ];
      
      const graph = buildTopologyGraph(segments);
      const walls = classifyWalls(chains, graph, { minConfidence: 0.5 });
      
      expect(walls.length).toBe(1);
      expect(walls[0].confidence).toBeGreaterThanOrEqual(0.5);
    });
    
    it('assigns wall types', () => {
      const chains = [
        {
          id: 'chain_0',
          merged: { x1: 0, y1: 0, x2: 100, y2: 0, length: 100 },
          segments: [{}],
          orientation: 'horizontal',
          length: 100,
          confidence: 0.8
        }
      ];
      
      const segments = [
        { x1: 0, y1: 0, x2: 100, y2: 0, id: 'seg_0', length: 100, angle: 0 }
      ];
      
      const graph = buildTopologyGraph(segments);
      const walls = classifyWalls(chains, graph);
      
      expect(walls.length).toBeGreaterThan(0);
      expect(walls[0].type).toBeDefined();
    });
    
    it('computes quality scores', () => {
      const chains = [
        {
          id: 'chain_0',
          merged: { x1: 0, y1: 0, x2: 100, y2: 0, length: 100 },
          segments: [{}],
          orientation: 'horizontal',
          length: 100,
          confidence: 0.8
        }
      ];
      
      const segments = [
        { x1: 0, y1: 0, x2: 100, y2: 0, id: 'seg_0', length: 100, angle: 0 }
      ];
      
      const graph = buildTopologyGraph(segments);
      const walls = classifyWalls(chains, graph, { computeThickness: true });
      
      expect(walls[0].quality).toBeDefined();
      expect(walls[0].quality).toBeGreaterThan(0);
      expect(walls[0].quality).toBeLessThanOrEqual(1);
    });
    
    it('computes thickness when enabled', () => {
      const chains = [
        {
          id: 'chain_0',
          merged: { x1: 0, y1: 0, x2: 100, y2: 0, length: 100 },
          segments: [{}],
          orientation: 'horizontal',
          length: 100,
          confidence: 0.8
        }
      ];
      
      const segments = [
        { x1: 0, y1: 0, x2: 100, y2: 0, id: 'seg_0', length: 100, angle: 0 }
      ];
      
      const graph = buildTopologyGraph(segments);
      const walls = classifyWalls(chains, graph, { computeThickness: true });
      
      expect(walls[0].thickness).toBeDefined();
      expect(walls[0].thickness).toBeGreaterThan(0);
    });
  });
  
  describe('filterWallsByOrientation', () => {
    it('filters horizontal walls', () => {
      const walls = [
        { id: 'w1', orientation: 'horizontal', length: 100 },
        { id: 'w2', orientation: 'vertical', length: 100 },
        { id: 'w3', orientation: 'horizontal', length: 50 }
      ];
      
      const filtered = filterWallsByOrientation(walls, 'horizontal');
      
      expect(filtered.length).toBe(2);
      expect(filtered.every(w => w.orientation === 'horizontal')).toBe(true);
    });
    
    it('filters multiple orientations', () => {
      const walls = [
        { id: 'w1', orientation: 'horizontal', length: 100 },
        { id: 'w2', orientation: 'vertical', length: 100 },
        { id: 'w3', orientation: 'diagonal', length: 50 }
      ];
      
      const filtered = filterWallsByOrientation(walls, ['horizontal', 'vertical']);
      
      expect(filtered.length).toBe(2);
    });
  });
  
  describe('filterWallsByType', () => {
    it('filters walls by type', () => {
      const walls = [
        { id: 'w1', type: 'corridor', length: 100 },
        { id: 'w2', type: 'junction', length: 100 },
        { id: 'w3', type: 'corridor', length: 50 }
      ];
      
      const filtered = filterWallsByType(walls, 'corridor');
      
      expect(filtered.length).toBe(2);
      expect(filtered.every(w => w.type === 'corridor')).toBe(true);
    });
  });
  
  describe('getWallStatistics', () => {
    it('calculates statistics correctly', () => {
      const walls = [
        {
          id: 'w1',
          orientation: 'horizontal',
          type: 'corridor',
          length: 100,
          confidence: 0.8
        },
        {
          id: 'w2',
          orientation: 'vertical',
          type: 'junction',
          length: 150,
          confidence: 0.9
        }
      ];
      
      const stats = getWallStatistics(walls);
      
      expect(stats.count).toBe(2);
      expect(stats.totalLength).toBe(250);
      expect(stats.avgLength).toBe(125);
      expect(stats.avgConfidence).toBeCloseTo(0.85);
      expect(stats.orientations).toBeDefined();
      expect(stats.types).toBeDefined();
    });
    
    it('handles empty wall array', () => {
      const stats = getWallStatistics([]);
      
      expect(stats.count).toBe(0);
      expect(stats.totalLength).toBe(0);
      expect(stats.avgLength).toBe(0);
    });
  });
  
  describe('rankWallsByImportance', () => {
    it('ranks walls by importance', () => {
      const walls = [
        {
          id: 'w1',
          length: 50,
          confidence: 0.5,
          quality: 0.5,
          connectivityDegree: 1
        },
        {
          id: 'w2',
          length: 200,
          confidence: 0.9,
          quality: 0.9,
          connectivityDegree: 4
        }
      ];
      
      const ranked = rankWallsByImportance(walls);
      
      expect(ranked[0].id).toBe('w2'); // Higher importance first
      expect(ranked[1].id).toBe('w1');
    });
  });
  
  describe('exportWalls', () => {
    it('exports walls to simple format', () => {
      const walls = [
        {
          id: 'w1',
          chain: { x1: 0, y1: 0, x2: 100, y2: 0 },
          length: 100,
          orientation: 'horizontal',
          type: 'corridor',
          confidence: 0.8,
          quality: 0.7,
          thickness: 5
        }
      ];
      
      const exported = exportWalls(walls);
      
      expect(exported.length).toBe(1);
      expect(exported[0]).toHaveProperty('x1');
      expect(exported[0]).toHaveProperty('x2');
      expect(exported[0]).toHaveProperty('y1');
      expect(exported[0]).toHaveProperty('y2');
      expect(exported[0]).toHaveProperty('length');
      expect(exported[0]).toHaveProperty('orientation');
    });
  });
});
