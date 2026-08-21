import { describe, expect, it } from 'vitest';
import { calculateArea, calculatePerimeter, displayedBreakdownTotal } from '../areaCalculator';
import { areaDisplayValue, formatAreaValue } from '../unitConverter';

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

// ---------------------------------------------------------------------------
// displayedBreakdownTotal
// ---------------------------------------------------------------------------

describe('displayedBreakdownTotal', () => {
  // Every surface that prints a breakdown — exhibit, dock, mobile bar — sums
  // through here, so the invariant is stated once: the printed total is the
  // sum of the printed rows.
  const printedRows = (byType, unit) => Object.keys(byType)
    .map((id) => formatAreaValue(areaDisplayValue(byType[id], unit), unit).value);

  const asNumber = (text) => Number(String(text).replace(/,/g, ''));

  it('equals the sum of the figures the rows print', () => {
    const byType = { gla: 1241.4, garage: 442.4, porch: 89.4 };
    const rows = printedRows(byType, 'decimal');
    expect(rows).toEqual(['1,241', '442', '89']);
    const total = displayedBreakdownTotal(byType, 'decimal');
    expect(total).toBe(rows.reduce((n, r) => n + asNumber(r), 0));
    // What rounding the raw sum on its own would have printed under those rows.
    expect(Math.round(1241.4 + 442.4 + 89.4)).toBe(1773);
    expect(total).toBe(1772);
  });

  it('adds up in metric too, including a sub-square-metre part', () => {
    const byType = { gla: 13290, porch: 8 };
    const rows = printedRows(byType, 'metric');
    const total = formatAreaValue(displayedBreakdownTotal(byType, 'metric'), 'metric');
    expect(rows).toEqual(['1,235', '0.74']);
    expect(asNumber(total.value)).toBeCloseTo(rows.reduce((n, r) => n + asNumber(r), 0), 2);
    // Grouped, not `toFixed`: this is the one number on the page that most
    // needs the separator, in a column where every other cell has it.
    expect(total.value).toBe('1,235.74');
  });

  it('ignores a type the plan has no outline for', () => {
    expect(displayedBreakdownTotal({ gla: 100 }, 'decimal')).toBe(100);
    expect(displayedBreakdownTotal({}, 'decimal')).toBe(0);
    expect(displayedBreakdownTotal(null, 'decimal')).toBe(0);
  });

  it('counts only the types the taxonomy knows', () => {
    // A stray key cannot inflate the total: `normalizeTraceType` folds unknown
    // types into GLA upstream, so anything else here is not a real subtotal.
    expect(displayedBreakdownTotal({ gla: 100, nonsense: 5000 }, 'decimal')).toBe(100);
  });
});
