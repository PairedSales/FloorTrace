import { describe, expect, it } from 'vitest';
import { calculateArea, calculatePerimeter } from '../areaCalculator';

describe('areaCalculator', () => {
  // Rectangle vertices in pixels (100 x 50)
  // (0,0) -> (100,0) -> (100,50) -> (0,50)
  const rectangleVertices = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 50 },
    { x: 0, y: 50 }
  ];

  describe('calculateArea', () => {
    it('returns 0 for invalid vertices', () => {
      expect(calculateArea(null, { x: 1, y: 1 })).toBe(0);
      expect(calculateArea([], { x: 1, y: 1 })).toBe(0);
      expect(calculateArea([{ x: 0, y: 0 }, { x: 10, y: 0 }], { x: 1, y: 1 })).toBe(0);
    });

    it('calculates area using legacy uniform scalar scale', () => {
      // pixel area = 100 * 50 = 5000
      // scale = 2.0 -> area = 5000 * 2.0 * 2.0 = 20000
      expect(calculateArea(rectangleVertices, 2.0)).toBe(20000);
    });

    it('calculates area using non-uniform X/Y scale object', () => {
      // pixel area = 5000
      // scaleX = 2.0, scaleY = 3.0 -> area = 5000 * 2.0 * 3.0 = 30000
      expect(calculateArea(rectangleVertices, { x: 2.0, y: 3.0 })).toBe(30000);
    });
  });

  describe('calculatePerimeter', () => {
    it('returns 0 for invalid vertices', () => {
      expect(calculatePerimeter(null, { x: 1, y: 1 })).toBe(0);
      expect(calculatePerimeter([], { x: 1, y: 1 })).toBe(0);
      expect(calculatePerimeter([{ x: 0, y: 0 }], { x: 1, y: 1 })).toBe(0);
    });

    it('calculates perimeter using legacy uniform scalar scale', () => {
      // pixel perimeter = 100 + 50 + 100 + 50 = 300
      // scale = 2.0 -> perimeter = 300 * 2.0 = 600
      expect(calculatePerimeter(rectangleVertices, 2.0)).toBe(600);
    });

    it('calculates perimeter using non-uniform X/Y scale object', () => {
      // Horizontal edges (length 100 px each) are scaled by scaleX (2.0) -> 200 ft each
      // Vertical edges (length 50 px each) are scaled by scaleY (3.0) -> 150 ft each
      // Total perimeter = 200 + 150 + 200 + 150 = 700 ft
      expect(calculatePerimeter(rectangleVertices, { x: 2.0, y: 3.0 })).toBe(700);
    });
  });
});
