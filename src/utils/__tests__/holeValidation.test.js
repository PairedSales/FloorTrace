import { describe, expect, it } from 'vitest';
import { validateHoleRing } from '../geometryValidation';

const square = (x1, y1, x2, y2) => [
  { x: x1, y: y1 }, { x: x2, y: y1 }, { x: x2, y: y2 }, { x: x1, y: y2 },
];

const OUTER = square(0, 0, 100, 100);

// A 100x100 square with a notch cut out of the bottom edge: the region
// x in (40, 60), y in (40, 100) is outside the building.
const NOTCHED = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 60, y: 100 },
  { x: 60, y: 40 },
  { x: 40, y: 40 },
  { x: 40, y: 100 },
  { x: 0, y: 100 },
];

describe('validateHoleRing', () => {
  it('accepts a simple ring well inside the outline', () => {
    expect(validateHoleRing(square(20, 20, 40, 40), OUTER, [])).toEqual({ ok: true, reason: null });
  });

  it('rejects a ring that crosses itself', () => {
    const bowtie = [
      { x: 10, y: 10 }, { x: 50, y: 50 }, { x: 50, y: 10 }, { x: 10, y: 50 },
    ];
    const res = validateHoleRing(bowtie, OUTER, []);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/crosses itself/);
  });

  it('rejects a ring with a vertex outside the outline', () => {
    const res = validateHoleRing(square(80, 80, 130, 130), OUTER, []);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/inside the outline/);
  });

  it('rejects a ring wholly outside the outline', () => {
    const res = validateHoleRing(square(200, 200, 220, 220), OUTER, []);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/inside the outline/);
  });

  // The check vertex containment alone misses. Every corner of this ring sits
  // in one arm or the other of the U; the long edges still run straight across
  // the notch, through two walls.
  it('rejects a ring spanning a concave notch that every vertex clears', () => {
    const spanning = square(20, 60, 80, 70);
    for (const v of spanning) {
      expect(validateHoleRing([v, { x: v.x + 1, y: v.y }, { x: v.x, y: v.y + 1 }], NOTCHED, []).ok)
        .toBe(true);
    }

    const res = validateHoleRing(spanning, NOTCHED, []);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/crosses the outline/);
  });

  it('accepts a ring inside one arm of the same notched outline', () => {
    expect(validateHoleRing(square(5, 50, 30, 80), NOTCHED, []).ok).toBe(true);
  });

  it('rejects a ring nested inside an existing void', () => {
    const res = validateHoleRing(square(30, 30, 70, 70), OUTER, [square(20, 20, 80, 80)]);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/another void/);
  });

  it('rejects a ring that swallows an existing void', () => {
    const res = validateHoleRing(square(20, 20, 80, 80), OUTER, [square(30, 30, 70, 70)]);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/another void/);
  });

  it('rejects a ring that partly overlaps an existing void', () => {
    const res = validateHoleRing(square(30, 30, 70, 70), OUTER, [square(50, 50, 90, 90)]);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/another void/);
  });

  it('accepts a second void that clears the first', () => {
    expect(validateHoleRing(square(60, 60, 80, 80), OUTER, [square(10, 10, 30, 30)]).ok).toBe(true);
  });

  it('ignores degenerate entries in the existing set', () => {
    const res = validateHoleRing(square(60, 60, 80, 80), OUTER, [null, [], [{ x: 1, y: 1 }]]);
    expect(res.ok).toBe(true);
  });

  it('rejects a ring with fewer than three corners', () => {
    expect(validateHoleRing([{ x: 1, y: 1 }, { x: 5, y: 5 }], OUTER, []).ok).toBe(false);
    expect(validateHoleRing(null, OUTER, []).ok).toBe(false);
  });

  it('rejects when there is no outline to punch out of', () => {
    const res = validateHoleRing(square(20, 20, 40, 40), [], []);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/no closed outline/i);
  });
});
