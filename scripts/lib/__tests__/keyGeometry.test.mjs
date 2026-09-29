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

// A small seeded generator, so a failure names the same shapes every run.
const seeded = (seed) => {
  let x = seed >>> 0;
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x / 2 ** 32;
  };
};

// Axis-aligned rectangles have an analytic intersection: the reference the
// exact areas are held to at coordinates that fall on no grid.
const rectArea = ([x0, y0, x1, y1]) => Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
const rectInter = (p, q) => rectArea([Math.max(p[0], q[0]), Math.max(p[1], q[1]), Math.min(p[2], q[2]), Math.min(p[3], q[3])]);
const ringOf = (r) => rect(...r);

// Sutherland-Hodgman: a convex polygon clipped by a convex one (both wound the
// same way), an independent route to the same intersection area.
const clipConvex = (subject, clip) => {
  let out = subject;
  for (let i = 0; i < clip.length && out.length; i += 1) {
    const a = clip[i];
    const b = clip[(i + 1) % clip.length];
    const side = (p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    const input = out;
    out = [];
    for (let j = 0; j < input.length; j += 1) {
      const p = input[j];
      const q = input[(j + 1) % input.length];
      const sp = side(p);
      const sq = side(q);
      if (sp >= 0) out.push(p);
      if ((sp >= 0) !== (sq >= 0)) {
        const t = sp / (sp - sq);
        out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
      }
    }
  }
  return out;
};
const turned = (cx, cy, w, h, angle) => [[-w, -h], [w, -h], [w, h], [-w, h]].map(([x, y]) => [
  cx + x * Math.cos(angle) - y * Math.sin(angle),
  cy + x * Math.sin(angle) + y * Math.cos(angle),
]);

describe('areas of unions, worked out by hand', () => {
  it('two rectangles offset by 2 px: 19,800 shared of 20,200', () => {
    const r = areasOf([rect(0, 0, 200, 100)], [rect(2, 0, 202, 100)]);
    expect(r.a).toBe(20000);
    expect(r.inter).toBe(19800);
    expect(r.union).toBe(20200);
    expect(r.iou).toBeCloseTo(19800 / 20200, 12);
  });

  it('an L against the bar it contains: 20,000 of 30,000', () => {
    const r = areasOf([ell], [rect(0, 0, 200, 100)]);
    expect(r.inter).toBeCloseTo(20000, 6);
    expect(r.union).toBeCloseTo(30000, 6);
    expect(r.iou).toBeCloseTo(2 / 3, 12);
  });

  it('a square against the square with a 20 x 20 corner missing: 9,600 of 10,000', () => {
    const notched = [[0, 0], [80, 0], [80, 20], [100, 20], [100, 100], [0, 100]];
    const r = areasOf([rect(0, 0, 100, 100)], [notched]);
    expect(r.inter).toBeCloseTo(9600, 6);
    expect(r.iou).toBeCloseTo(0.96, 12);
  });

  it('a sloped edge: two right triangles shifted by 1 px share 4,900.5 of 5,099.5', () => {
    const a = [[0.13, 0.07], [100.13, 0.07], [0.13, 100.07]];
    const b = [[1.13, 0.07], [101.13, 0.07], [1.13, 100.07]];
    const r = areasOf([a], [b]);
    // The hypotenuses are parallel, 1 px apart along x: what they share is the
    // triangle of leg 99, 4,900.5 px2, with no raster to round it.
    expect(r.inter).toBeCloseTo(4900.5, 6);
    expect(r.iou).toBeCloseTo(4900.5 / 5099.5, 12);
  });

  it('a sloped edge that cuts a square: a corner 6 px a side is off, 46 of 68', () => {
    // The triangle x + y <= 10 (50 px2) against the square [0,8]^2 (64 px2): the
    // square's far corner, where x + y > 10, is a triangle of leg 6 (18 px2).
    const tri = [[0, 0], [10, 0], [0, 10]];
    const r = areasOf([tri], [rect(0, 0, 8, 8)]);
    expect(r.inter).toBeCloseTo(46, 9);
    expect(r.union).toBeCloseTo(68, 9);
    // Moved off any grid by the same amount, nothing changes.
    const at = ([x, y]) => [x + 0.37, y + 0.61];
    const moved = areasOf([tri.map(at)], [rect(0, 0, 8, 8).map(at)]);
    expect(moved.iou).toBeCloseTo(46 / 68, 12);
  });

  it('shapes that do not meet share nothing; two empty sets are the same', () => {
    expect(areasOf([rect(0, 0, 10, 10)], [rect(50, 50, 60, 60)]).iou).toBe(0);
    expect(areasOf([], []).iou).toBe(1);
    expect(areasOf([rect(0, 0, 10, 10)], []).iou).toBe(0);
  });

  it('shapes that share only an edge share no area', () => {
    const r = areasOf([rect(0, 0, 100, 100)], [rect(100, 0, 200, 100)]);
    expect(r.inter).toBe(0);
    expect(r.union).toBe(20000);
  });

  it('counts the union of several outlines once', () => {
    // Two overlapping 100 x 100 squares offset by 50: 100 x 150 in all.
    expect(unionArea([rect(0, 0, 100, 100), rect(0, 50, 100, 150)])).toBe(15000);
  });

  it('a fractional edge is exact', () => {
    const r = areasOf([rect(0, 0, 400, 300)], [rect(0.3, 0.7, 400.3, 300.7)]);
    const inter = (400 - 0.3) * (300 - 0.7);
    expect(r.inter).toBeCloseTo(inter, 6);
    expect(r.iou).toBeCloseTo(inter / (2 * 120000 - inter), 12);
  });
});

describe('areas off any grid: exact against an analytic answer', () => {
  it('two different-sized houses at fractional corners: IoU 94.647%, not the 93.988% a 0.5 px raster gave', () => {
    // [10.3, 12.7]-[110.9, 80.2] against [11.4, 13.9]-[109.6, 81.1]: they share
    // 98.2 x 66.3 = 6,510.66 px2 of 6,790.5 + 6,599.04 - 6,510.66 = 6,878.88.
    const r = areasOf([rect(10.3, 12.7, 110.9, 80.2)], [rect(11.4, 13.9, 109.6, 81.1)]);
    expect(r.a).toBeCloseTo(6790.5, 6);
    expect(r.b).toBeCloseTo(6599.04, 6);
    expect(r.inter).toBeCloseTo(6510.66, 6);
    expect(r.iou).toBeCloseTo(6510.66 / 6878.88, 12);
    expect(r.iou).toBeGreaterThan(0.9464);
    expect(r.iou).toBeLessThan(0.9466);
  });

  it.each([
    ['a large house', [600, 900], [300, 500]],
    ['a mid house', [300, 500], [200, 300]],
    ['a small house', [100, 200], [80, 150]],
  ])('%s: 300 random rectangle pairs at fractional corners near IoU 99%% match the analytic IoU', (_, [w0, w1], [h0, h1]) => {
    const rand = seeded(w0 * 7 + h0);
    for (let n = 0; n < 300; n += 1) {
      const w = w0 + rand() * (w1 - w0);
      const h = h0 + rand() * (h1 - h0);
      const a = [rand() * 50, rand() * 50, 0, 0];
      a[2] = a[0] + w;
      a[3] = a[1] + h;
      // B is A with each side moved by up to 0.5% of the house: IoU near 99%.
      const b = [a[0] + (rand() - 0.5) * 0.01 * w, a[1] + (rand() - 0.5) * 0.01 * h, a[2] + (rand() - 0.5) * 0.01 * w, a[3] + (rand() - 0.5) * 0.01 * h];
      const inter = rectInter(a, b);
      const r = areasOf([ringOf(a)], [ringOf(b)]);
      expect(r.inter).toBeCloseTo(inter, 6);
      expect(r.iou).toBeCloseTo(inter / (rectArea(a) + rectArea(b) - inter), 9);
    }
  });

  it('an L against a fractional rectangle: the L is two rectangles, so the answer is inclusion-exclusion', () => {
    const rand = seeded(11);
    const bar = [3.3, 4.1, 203.7, 104.9];
    const leg = [3.3, 104.9, 103.2, 205.6];
    const L = [[3.3, 4.1], [203.7, 4.1], [203.7, 104.9], [103.2, 104.9], [103.2, 205.6], [3.3, 205.6]];
    const both = [Math.max(bar[0], leg[0]), Math.max(bar[1], leg[1]), Math.min(bar[2], leg[2]), Math.min(bar[3], leg[3])];
    for (let n = 0; n < 100; n += 1) {
      const x0 = rand() * 120;
      const y0 = rand() * 120;
      const other = [x0, y0, x0 + 40 + rand() * 150, y0 + 40 + rand() * 150];
      const inter = rectInter(bar, other) + rectInter(leg, other) - rectInter(both, other);
      expect(areasOf([L], [ringOf(other)]).inter).toBeCloseTo(inter, 6);
    }
  });

  it('turned rectangles against the same clipped by Sutherland-Hodgman: 200 pairs', () => {
    const rand = seeded(5);
    for (let n = 0; n < 200; n += 1) {
      const a = turned(100 + rand() * 3, 100 + rand() * 3, 30 + rand() * 40, 20 + rand() * 30, rand() * Math.PI);
      const b = turned(100 + rand() * 20, 100 + rand() * 20, 30 + rand() * 40, 20 + rand() * 30, rand() * Math.PI);
      const clipped = clipConvex(a, b);
      const inter = clipped.length >= 3 ? areaOf(clipped) : 0;
      const r = areasOf([a], [b]);
      expect(r.inter).toBeCloseTo(inter, 6);
      expect(r.union).toBeCloseTo(areaOf(a) + areaOf(b) - inter, 6);
    }
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
