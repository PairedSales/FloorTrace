// The plane geometry behind compare and check (scripts/lib/keyGeometry.mjs),
// against shapes whose areas are worked out by hand.
import { describe, expect, it } from 'vitest';
import {
  areaOf, areasOf, bboxOf, distanceToSegments, pointInRing, ringLength, ringProblem, sampleRing,
  segmentContact, segmentsOf, sharedBoundaryLength, unionArea,
} from '../keyGeometry.mjs';

const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
// An L: a 200 x 100 bar with a 100 x 100 block on its left end going down.
const ell = [[0, 0], [200, 0], [200, 100], [100, 100], [100, 200], [0, 200]];

describe('areas and boxes', () => {
  it('measures a rectangle and an L by the shoelace', () => {
    expect(areaOf(rect(0, 0, 200, 100))).toBe(20000);
    expect(areaOf(ell)).toBe(30000);
    expect(areaOf([...rect(0, 0, 200, 100)].reverse())).toBe(20000);
  });

  it('finds the box and the perimeter', () => {
    expect(bboxOf([ell])).toEqual([0, 0, 200, 200]);
    expect(ringLength(rect(0, 0, 200, 100))).toBe(600);
  });
});

describe('what is wrong with a ring', () => {
  it('accepts a rectangle and an L', () => {
    expect(ringProblem(rect(0, 0, 50, 50))).toBeNull();
    expect(ringProblem(ell)).toBeNull();
  });

  it('names a bow-tie', () => {
    const bowTie = [[0, 0], [100, 100], [100, 0], [0, 100]];
    expect(ringProblem(bowTie)).toMatchObject({ kind: 'cross', edges: [0, 2] });
  });

  it('names fewer than three distinct vertices and a repeated vertex', () => {
    expect(ringProblem([[0, 0], [10, 10]]).kind).toBe('few');
    expect(ringProblem([[0, 0], [10, 0], [10, 0], [10, 10]]).kind).toBe('duplicate');
    expect(ringProblem([[0, 0], [10, 0], [0, 0]]).kind).toBe('few');
  });

  it('names an edge that doubles back on the one before it', () => {
    expect(ringProblem([[0, 0], [100, 0], [50, 0], [50, 50]]).kind).toBe('spike');
  });

  it('names two edges that touch without crossing', () => {
    // A ring pinched so vertex 4 rests on edge 0.
    const pinched = [[0, 0], [100, 0], [100, 100], [50, 0], [0, 100]];
    expect(ringProblem(pinched)?.kind).toBe('touch');
  });

  it('names an outline with no area', () => {
    expect(ringProblem([[0, 0], [100, 0], [50, 0.0000001]])?.kind).toMatch(/flat|spike|few/);
  });
});

describe('segments and points', () => {
  it('tells crossing from touching from apart', () => {
    expect(segmentContact([0, 0], [10, 10], [0, 10], [10, 0])).toBe('cross');
    expect(segmentContact([0, 0], [10, 0], [10, 0], [10, 10])).toBe('touch');
    expect(segmentContact([0, 0], [10, 0], [5, 0], [15, 0])).toBe('touch');
    expect(segmentContact([0, 0], [10, 0], [0, 5], [10, 5])).toBeNull();
  });

  it('places a point in a concave ring, and counts the boundary as inside', () => {
    expect(pointInRing([50, 50], ell)).toBe(true);
    expect(pointInRing([150, 150], ell)).toBe(false);
    expect(pointInRing([50, 150], ell)).toBe(true);
    expect(pointInRing([0, 100], ell)).toBe(true);
    expect(pointInRing([201, 50], ell)).toBe(false);
  });

  it('samples a boundary about every pixel and measures to the nearest segment', () => {
    const points = sampleRing(rect(0, 0, 10, 10), 1);
    expect(points).toHaveLength(40);
    const segs = segmentsOf([rect(0, 0, 10, 10)]);
    expect(distanceToSegments([5, 5], segs)).toBe(5);
    expect(distanceToSegments([13, 5], segs)).toBe(3);
    expect(distanceToSegments([13, 14], segs)).toBe(5);
  });
});

describe('areas of unions, worked out by hand', () => {
  it('two rectangles offset by 2 px: 19,800 shared of 20,200', () => {
    const r = areasOf([rect(0, 0, 200, 100)], [rect(2, 0, 202, 100)]);
    expect(r.a).toBe(20000);
    expect(r.inter).toBe(19800);
    expect(r.union).toBe(20200);
    expect(Math.abs(r.iou - 19800 / 20200)).toBeLessThan(0.0005);
  });

  it('an L against the bar it contains: 20,000 of 30,000', () => {
    const r = areasOf([ell], [rect(0, 0, 200, 100)]);
    expect(Math.abs(r.iou - 2 / 3)).toBeLessThan(0.002);
  });

  it('a square against the square with a 20 x 20 corner missing: 9,600 of 10,000', () => {
    const notched = [[0, 0], [80, 0], [80, 20], [100, 20], [100, 100], [0, 100]];
    const r = areasOf([rect(0, 0, 100, 100)], [notched]);
    expect(r.inter).toBeCloseTo(9600, 0);
    expect(Math.abs(r.iou - 0.96)).toBeLessThan(0.002);
  });

  it('a sloped edge: two right triangles shifted by 1 px share 4,900.5 of 5,099.5', () => {
    const a = [[0.13, 0.07], [100.13, 0.07], [0.13, 100.07]];
    const b = [[1.13, 0.07], [101.13, 0.07], [1.13, 100.07]];
    const r = areasOf([a], [b]);
    // A 45-degree edge on a lattice of cells is the worst case for a raster:
    // every row errs the same way, by up to half a cell (25 px2 of 5,000 here).
    // Both shapes err together, so the IoU, which is what the protocol
    // reads, stays within 0.02% of exact.
    expect(Math.abs(r.inter - 4900.5)).toBeLessThan(30);
    expect(Math.abs(r.iou - 4900.5 / 5099.5)).toBeLessThan(0.0005);
  });

  it('shapes that do not meet share nothing; two empty sets are the same', () => {
    expect(areasOf([rect(0, 0, 10, 10)], [rect(50, 50, 60, 60)]).iou).toBe(0);
    expect(areasOf([], []).iou).toBe(1);
    expect(areasOf([rect(0, 0, 10, 10)], []).iou).toBe(0);
  });

  it('counts the union of several outlines once', () => {
    // Two overlapping 100 x 100 squares offset by 50: 100 x 150 in all.
    expect(unionArea([rect(0, 0, 100, 100), rect(0, 50, 100, 150)])).toBe(15000);
  });

  it('a fractional edge is exact to far better than 0.2%', () => {
    const r = areasOf([rect(0, 0, 400, 300)], [rect(0.3, 0.7, 400.3, 300.7)]);
    const inter = (400 - 0.3) * (300 - 0.7);
    const union = 2 * 120000 - inter;
    expect(Math.abs(r.iou - inter / union)).toBeLessThan(0.001);
  });
});

describe('shared boundary', () => {
  it('measures the length two outlines have in common', () => {
    // The house and a garage butted on its right wall: 100 px shared.
    expect(sharedBoundaryLength([rect(0, 0, 100, 100)], [rect(100, 0, 200, 100)])).toBeGreaterThanOrEqual(100);
    expect(sharedBoundaryLength([rect(0, 0, 100, 100)], [rect(100, 0, 200, 100)])).toBeLessThan(110);
    expect(sharedBoundaryLength([rect(0, 0, 10, 10)], [rect(50, 50, 60, 60)])).toBe(0);
  });
});
