import { describe, it, expect } from 'vitest';
import {
  getOrientation,
  segmentsIntersect,
  hasSelfIntersection,
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
});
