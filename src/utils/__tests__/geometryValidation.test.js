import { describe, it, expect } from 'vitest';
import {
  getOrientation,
  onSegment,
  segmentsIntersect,
  hasSelfIntersection,
  validateVertexMove,
  getPolygonWinding,
  normalizePolygonWinding,
} from '../geometryValidation';

describe('geometryValidation', () => {
  describe('getOrientation', () => {
    it('detects collinear points', () => {
      const p = { x: 0, y: 0 };
      const q = { x: 5, y: 5 };
      const r = { x: 10, y: 10 };
      expect(getOrientation(p, q, r)).toBe(0);
    });

    it('detects clockwise points', () => {
      const p = { x: 0, y: 0 };
      const q = { x: 10, y: 0 };
      const r = { x: 0, y: 10 }; // visually clockwise in Y-down
      expect(getOrientation(p, q, r)).toBe(1);
    });

    it('detects counterclockwise points', () => {
      const p = { x: 0, y: 0 };
      const q = { x: 0, y: 10 };
      const r = { x: 10, y: 0 }; // visually counterclockwise in Y-down
      expect(getOrientation(p, q, r)).toBe(2);
    });
  });

  describe('segmentsIntersect', () => {
    it('detects crossing segments', () => {
      const p1 = { x: 0, y: 0 };
      const q1 = { x: 10, y: 10 };
      const p2 = { x: 10, y: 0 };
      const q2 = { x: 0, y: 10 };
      expect(segmentsIntersect(p1, q1, p2, q2)).toBe(true);
    });

    it('detects parallel non-intersecting segments', () => {
      const p1 = { x: 0, y: 0 };
      const q1 = { x: 10, y: 0 };
      const p2 = { x: 0, y: 5 };
      const q2 = { x: 10, y: 5 };
      expect(segmentsIntersect(p1, q1, p2, q2)).toBe(false);
    });

    it('detects collinear overlapping segments', () => {
      const p1 = { x: 0, y: 0 };
      const q1 = { x: 10, y: 0 };
      const p2 = { x: 5, y: 0 };
      const q2 = { x: 15, y: 0 };
      expect(segmentsIntersect(p1, q1, p2, q2)).toBe(true);
    });
  });

  describe('hasSelfIntersection (Full Simplification Checker)', () => {
    it('validates a standard simple rectangular box', () => {
      const box = [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ];
      expect(hasSelfIntersection(box, true)).toBe(false);
    });

    it('validates a concave L-shape', () => {
      const lShape = [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 5 },
        { x: 5, y: 5 },
        { x: 5, y: 10 },
        { x: 0, y: 10 },
      ];
      expect(hasSelfIntersection(lShape, true)).toBe(false);
    });

    it('rejects crossing "bowtie" polygon', () => {
      const bowtie = [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
        { x: 10, y: 0 },
        { x: 0, y: 10 },
      ];
      expect(hasSelfIntersection(bowtie, true)).toBe(true);
    });

    it('rejects collinear overlapping adjacent edges', () => {
      const poly = [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 5, y: 0 }, // edge backtracks on the first edge
        { x: 5, y: 10 },
      ];
      expect(hasSelfIntersection(poly, true)).toBe(true);
    });

    it('rejects zero-length edges', () => {
      const poly = [
        { x: 0, y: 0 },
        { x: 0, y: 0.000001 }, // extremely close, below epsilon (1e-5)
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ];
      expect(hasSelfIntersection(poly, true)).toBe(true);
    });

    it('rejects duplicate non-adjacent vertices', () => {
      const poly = [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 0 }, // duplicate of first vertex (not adjacent in closed polygon edge comparison, but duplicate vertex)
      ];
      expect(hasSelfIntersection(poly, true)).toBe(true);
    });
  });

  describe('validateVertexMove (Incremental O(n) Drag Checker)', () => {
    const box = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];

    it('allows valid vertex movement', () => {
      // Move V1 (10, 0) to (15, -5) -> still a simple convex polygon
      const newPoint = { x: 15, y: -5 };
      expect(validateVertexMove(box, 1, newPoint, true)).toBe(true);
    });

    it('blocks crossing vertex movement', () => {
      // Move V1 (10, 0) to (-5, 5) -> crosses edge V2-V3
      const newPoint = { x: -5, y: 5 };
      expect(validateVertexMove(box, 1, newPoint, true)).toBe(false);
    });

    it('blocks zero-length edge during movement', () => {
      // Move V1 (10, 0) to V0 (0, 0) -> zero length
      const newPoint = { x: 0, y: 0 };
      expect(validateVertexMove(box, 1, newPoint, true)).toBe(false);
    });

    it('blocks collinear adjacent overlap during movement', () => {
      // Move V1 (10, 0) to V2 (10, 10) but on collinear path
      const boxCollinear = [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 10 },
        { x: 0, y: 10 },
      ];
      // Dragging V1 (10, 0) to (25, 0) overlaps with segment V2(20, 0)-V3(20, 10) or V2-V1?
      // Dragging V2 (20, 0) to (5, 0) backtracks on V0-V1-V2.
      const newPoint = { x: 5, y: 0 };
      expect(validateVertexMove(boxCollinear, 2, newPoint, true)).toBe(false);
    });
  });

  describe('getPolygonWinding & normalizePolygonWinding', () => {
    it('detects CW winding', () => {
      const cw = [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ]; // visually CW in Y-down
      expect(getPolygonWinding(cw)).toBe('CW');
    });

    it('detects CCW winding', () => {
      const ccw = [
        { x: 0, y: 0 },
        { x: 0, y: 10 },
        { x: 10, y: 10 },
        { x: 10, y: 0 },
      ]; // visually CCW in Y-down
      expect(getPolygonWinding(ccw)).toBe('CCW');
    });

    it('detects degenerate winding', () => {
      const degenerate = [
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 10, y: 0 },
      ];
      expect(getPolygonWinding(degenerate)).toBe('degenerate');
    });

    it('normalizes CW to CCW winding', () => {
      const cw = [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ];
      const normalized = normalizePolygonWinding(cw, 'CCW');
      expect(getPolygonWinding(normalized)).toBe('CCW');
      expect(normalized[0]).toEqual({ x: 0, y: 10 }); // reversed order
    });
  });
});
