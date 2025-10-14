/**
 * geometryUtils.test.js
 * Unit tests for geometry utility functions
 */

import { describe, it, expect } from 'vitest';
import {
  distance,
  lineLength,
  lineAngle,
  lineAngleDegrees,
  angleBetween,
  pointToLineDistance,
  isCollinear,
  isParallel,
  getEndpoints,
  closestEndpoints,
  sharesEndpoint,
  getOrientation,
  midpoint,
  extendLine,
  isPointOnLine,
  lineBounds,
  boundsOverlap,
  normalizeLine,
  projectPointOnLine,
  snapToEndpoint,
  averagePoints
} from './geometryUtils.js';

describe('geometryUtils', () => {
  describe('distance', () => {
    it('calculates distance between two points', () => {
      const p1 = { x: 0, y: 0 };
      const p2 = { x: 3, y: 4 };
      expect(distance(p1, p2)).toBe(5);
    });
    
    it('returns 0 for same point', () => {
      const p = { x: 5, y: 10 };
      expect(distance(p, p)).toBe(0);
    });
  });
  
  describe('lineLength', () => {
    it('calculates line length correctly', () => {
      const line = { x1: 0, y1: 0, x2: 3, y2: 4 };
      expect(lineLength(line)).toBe(5);
    });
    
    it('returns 0 for zero-length line', () => {
      const line = { x1: 5, y1: 10, x2: 5, y2: 10 };
      expect(lineLength(line)).toBe(0);
    });
  });
  
  describe('lineAngle', () => {
    it('calculates horizontal line angle', () => {
      const line = { x1: 0, y1: 0, x2: 10, y2: 0 };
      expect(lineAngle(line)).toBe(0);
    });
    
    it('calculates vertical line angle', () => {
      const line = { x1: 0, y1: 0, x2: 0, y2: 10 };
      expect(lineAngle(line)).toBeCloseTo(Math.PI / 2);
    });
    
    it('calculates diagonal line angle', () => {
      const line = { x1: 0, y1: 0, x2: 10, y2: 10 };
      expect(lineAngle(line)).toBeCloseTo(Math.PI / 4);
    });
  });
  
  describe('angleBetween', () => {
    it('returns 0 for parallel horizontal lines', () => {
      const line1 = { x1: 0, y1: 0, x2: 10, y2: 0 };
      const line2 = { x1: 0, y1: 5, x2: 10, y2: 5 };
      expect(angleBetween(line1, line2)).toBeCloseTo(0, 1);
    });
    
    it('returns 90 for perpendicular lines', () => {
      const line1 = { x1: 0, y1: 0, x2: 10, y2: 0 };
      const line2 = { x1: 0, y1: 0, x2: 0, y2: 10 };
      expect(angleBetween(line1, line2)).toBeCloseTo(90, 1);
    });
    
    it('handles opposite direction parallel lines', () => {
      const line1 = { x1: 0, y1: 0, x2: 10, y2: 0 };
      const line2 = { x1: 10, y1: 5, x2: 0, y2: 5 };
      expect(angleBetween(line1, line2)).toBeCloseTo(0, 1);
    });
  });
  
  describe('pointToLineDistance', () => {
    it('calculates perpendicular distance correctly', () => {
      const line = { x1: 0, y1: 0, x2: 10, y2: 0 };
      const point = { x: 5, y: 5 };
      expect(pointToLineDistance(point, line)).toBe(5);
    });
    
    it('returns 0 for point on line', () => {
      const line = { x1: 0, y1: 0, x2: 10, y2: 0 };
      const point = { x: 5, y: 0 };
      expect(pointToLineDistance(point, line)).toBe(0);
    });
  });
  
  describe('isCollinear', () => {
    it('detects collinear horizontal lines', () => {
      const line1 = { x1: 0, y1: 0, x2: 10, y2: 0 };
      const line2 = { x1: 15, y1: 0, x2: 25, y2: 0 };
      expect(isCollinear(line1, line2)).toBe(true);
    });
    
    it('rejects non-collinear lines', () => {
      const line1 = { x1: 0, y1: 0, x2: 10, y2: 0 };
      const line2 = { x1: 0, y1: 5, x2: 10, y2: 10 };
      expect(isCollinear(line1, line2)).toBe(false);
    });
    
    it('detects near-collinear lines within tolerance', () => {
      const line1 = { x1: 0, y1: 0, x2: 100, y2: 2 };
      const line2 = { x1: 105, y1: 1, x2: 200, y2: 4 };
      expect(isCollinear(line1, line2, { angleTolerance: 5, distanceTolerance: 10 })).toBe(true);
    });
  });
  
  describe('isParallel', () => {
    it('detects parallel lines', () => {
      const line1 = { x1: 0, y1: 0, x2: 10, y2: 0 };
      const line2 = { x1: 0, y1: 5, x2: 10, y2: 5 };
      expect(isParallel(line1, line2)).toBe(true);
    });
    
    it('rejects non-parallel lines', () => {
      const line1 = { x1: 0, y1: 0, x2: 10, y2: 0 };
      const line2 = { x1: 0, y1: 0, x2: 0, y2: 10 };
      expect(isParallel(line1, line2)).toBe(false);
    });
  });
  
  describe('getEndpoints', () => {
    it('extracts endpoints correctly', () => {
      const line = { x1: 5, y1: 10, x2: 15, y2: 20 };
      const endpoints = getEndpoints(line);
      expect(endpoints).toEqual([
        { x: 5, y: 10 },
        { x: 15, y: 20 }
      ]);
    });
  });
  
  describe('closestEndpoints', () => {
    it('finds closest endpoints', () => {
      const line1 = { x1: 0, y1: 0, x2: 10, y2: 0 };
      const line2 = { x1: 12, y1: 0, x2: 20, y2: 0 };
      const result = closestEndpoints(line1, line2);
      expect(result.distance).toBe(2);
      expect(result.point1).toEqual({ x: 10, y: 0 });
      expect(result.point2).toEqual({ x: 12, y: 0 });
    });
  });
  
  describe('sharesEndpoint', () => {
    it('detects shared endpoints', () => {
      const line1 = { x1: 0, y1: 0, x2: 10, y2: 0 };
      const line2 = { x1: 10, y1: 0, x2: 20, y2: 0 };
      expect(sharesEndpoint(line1, line2, 1)).toBe(true);
    });
    
    it('rejects non-shared endpoints', () => {
      const line1 = { x1: 0, y1: 0, x2: 10, y2: 0 };
      const line2 = { x1: 15, y1: 0, x2: 25, y2: 0 };
      expect(sharesEndpoint(line1, line2, 1)).toBe(false);
    });
  });
  
  describe('getOrientation', () => {
    it('identifies horizontal lines', () => {
      const line = { x1: 0, y1: 0, x2: 100, y2: 5 };
      expect(getOrientation(line)).toBe('horizontal');
    });
    
    it('identifies vertical lines', () => {
      const line = { x1: 0, y1: 0, x2: 5, y2: 100 };
      expect(getOrientation(line)).toBe('vertical');
    });
    
    it('identifies diagonal lines', () => {
      const line = { x1: 0, y1: 0, x2: 100, y2: 50 };
      expect(getOrientation(line)).toBe('diagonal');
    });
  });
  
  describe('midpoint', () => {
    it('calculates midpoint correctly', () => {
      const line = { x1: 0, y1: 0, x2: 10, y2: 20 };
      const mid = midpoint(line);
      expect(mid).toEqual({ x: 5, y: 10 });
    });
  });
  
  describe('extendLine', () => {
    it('extends line by specified distance', () => {
      const line = { x1: 0, y1: 0, x2: 10, y2: 0 };
      const extended = extendLine(line, 5);
      expect(extended.x1).toBeCloseTo(-5);
      expect(extended.x2).toBeCloseTo(15);
      expect(extended.y1).toBeCloseTo(0);
      expect(extended.y2).toBeCloseTo(0);
    });
  });
  
  describe('isPointOnLine', () => {
    it('detects point on line', () => {
      const line = { x1: 0, y1: 0, x2: 10, y2: 0 };
      const point = { x: 5, y: 0 };
      expect(isPointOnLine(point, line, 1)).toBe(true);
    });
    
    it('rejects point far from line', () => {
      const line = { x1: 0, y1: 0, x2: 10, y2: 0 };
      const point = { x: 5, y: 20 };
      expect(isPointOnLine(point, line, 1)).toBe(false);
    });
  });
  
  describe('lineBounds', () => {
    it('calculates bounding box correctly', () => {
      const line = { x1: 5, y1: 10, x2: 15, y2: 2 };
      const bounds = lineBounds(line);
      expect(bounds).toEqual({
        minX: 5,
        minY: 2,
        maxX: 15,
        maxY: 10
      });
    });
  });
  
  describe('boundsOverlap', () => {
    it('detects overlapping bounds', () => {
      const line1 = { x1: 0, y1: 0, x2: 10, y2: 10 };
      const line2 = { x1: 5, y1: 5, x2: 15, y2: 15 };
      expect(boundsOverlap(line1, line2)).toBe(true);
    });
    
    it('rejects non-overlapping bounds', () => {
      const line1 = { x1: 0, y1: 0, x2: 10, y2: 10 };
      const line2 = { x1: 50, y1: 50, x2: 60, y2: 60 };
      expect(boundsOverlap(line1, line2)).toBe(false);
    });
  });
  
  describe('normalizeLine', () => {
    it('normalizes line direction', () => {
      const line = { x1: 10, y1: 5, x2: 0, y2: 0 };
      const normalized = normalizeLine(line);
      expect(normalized.x1).toBeLessThanOrEqual(normalized.x2);
    });
  });
  
  describe('averagePoints', () => {
    it('averages two points correctly', () => {
      const p1 = { x: 0, y: 0 };
      const p2 = { x: 10, y: 20 };
      const avg = averagePoints(p1, p2);
      expect(avg).toEqual({ x: 5, y: 10 });
    });
  });
});
