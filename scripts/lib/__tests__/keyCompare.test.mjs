// Two keys compared under the protocol's agreement rule
// (scripts/lib/keyCompare.mjs), against outlines whose IoUs and distances are
// worked out by hand.
import { describe, expect, it } from 'vitest';
import { compareKeys, percentile } from '../keyCompare.mjs';

const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const gla = (v) => ({ type: 'gla', v });
const garage = (v) => ({ type: 'garage', v });
const porch = (v) => ({ type: 'porch', v });

describe('compare: the same key drawn twice', () => {
  it('agrees with itself at IoU 1 and distance 0', () => {
    const key = [gla(rect(0, 0, 400, 300)), garage(rect(400, 0, 600, 300))];
    const r = compareKeys(key, key);
    expect(r.agree).toBe(true);
    expect(r.iou.building.iou).toBe(1);
    expect(r.iou.byType.garage.iou).toBe(1);
    expect(r.boundary.max).toBeLessThan(1e-9);
    expect(r.regions).toEqual([]);
    expect(r.counts.a).toEqual({ gla: 1, garage: 1 });
  });
});

describe('compare: offsets worked out by hand', () => {
  it('a 1 px offset of a 200 x 100 house is IoU 19,900 / 20,100 = 99.005%: they agree', () => {
    const r = compareKeys([gla(rect(0, 0, 200, 100))], [gla(rect(1, 0, 201, 100))]);
    expect(Math.abs(r.iou.building.iou - 19900 / 20100)).toBeLessThan(0.0005);
    expect(r.boundary.max).toBeLessThanOrEqual(1.0001);
    expect(r.agree).toBe(true);
  });

  it('a 2 px offset is IoU 19,800 / 20,200 = 98.02%: the building criterion fails, the distance one does not', () => {
    const r = compareKeys([gla(rect(0, 0, 200, 100))], [gla(rect(2, 0, 202, 100))]);
    expect(Math.abs(r.iou.building.iou - 19800 / 20200)).toBeLessThan(0.0005);
    expect(r.agree).toBe(false);
    expect(r.criteria.find((c) => c.id === 'b').ok).toBe(false);
    expect(r.criteria.find((c) => c.id === 'd').ok).toBe(true);
    expect(r.failed).toHaveLength(1);
    expect(r.failed[0]).toMatch(/building IoU 98\.0\d% < 99\.00%/);
  });

  it('a big house 3.5 px off passes the IoU test but not the 3 px distance test, and says where', () => {
    const a = [gla(rect(0, 0, 2000, 1500))];
    const b = [gla(rect(3.5, 0, 2003.5, 1500))];
    const r = compareKeys(a, b);
    expect(r.iou.building.iou).toBeGreaterThan(0.99);
    expect(r.boundary.max).toBeCloseTo(3.5, 1);
    expect(r.criteria.find((c) => c.id === 'd').ok).toBe(false);
    expect(r.agree).toBe(false);
    // The two vertical sides are the regions; the horizontal ones agree.
    expect(r.regions).toHaveLength(2);
    const [first] = r.regions;
    expect(first.maxDistance).toBeCloseTo(3.5, 1);
    expect(first.id).toBe(1);
    expect(first.class).toBe('building');
    const xs = r.regions.map((g) => Math.round(g.bbox[0])).sort((p, q) => p - q);
    expect(xs[0]).toBeLessThanOrEqual(3);
    expect(xs[1]).toBeGreaterThanOrEqual(1999);
  });

  it('a corner missing from one key: IoU 96%, and the notch is the one region, 20 px deep', () => {
    const notched = [[0, 0], [80, 0], [80, 20], [100, 20], [100, 100], [0, 100]];
    const r = compareKeys([gla(rect(0, 0, 100, 100))], [gla(notched)]);
    expect(Math.abs(r.iou.building.iou - 0.96)).toBeLessThan(0.002);
    expect(r.boundary.max).toBeCloseTo(20, 0);
    expect(r.agree).toBe(false);
    expect(r.regions).toHaveLength(1);
    const [region] = r.regions;
    expect(region.bbox[0]).toBeGreaterThanOrEqual(78);
    expect(region.bbox[3]).toBeLessThanOrEqual(22);
    expect(region.maxDistance).toBeCloseTo(20, 0);
  });

  it('an L-shape against the bar it contains: IoU two thirds, the missing block is a region', () => {
    const ell = [[0, 0], [200, 0], [200, 100], [100, 100], [100, 200], [0, 200]];
    const r = compareKeys([gla(ell)], [gla(rect(0, 0, 200, 100))]);
    expect(Math.abs(r.iou.building.iou - 2 / 3)).toBeLessThan(0.002);
    expect(r.agree).toBe(false);
    expect(r.regions.length).toBeGreaterThan(0);
    expect(r.regions[0].maxDistance).toBeGreaterThan(50);
  });
});

describe('compare: outline types', () => {
  it('the same outline drawn as a garage by one and a porch by the other: types differ, both IoUs 0', () => {
    const r = compareKeys([garage(rect(0, 0, 100, 100))], [porch(rect(0, 0, 100, 100))]);
    expect(r.agree).toBe(false);
    expect(r.criteria[0]).toMatchObject({ id: 'a', ok: false });
    expect(r.iou.byType.garage.iou).toBe(0);
    expect(r.iou.byType.porch.iou).toBe(0);
    // Both are non-GLA space and sit where the other's does.
    expect(r.iou.nonGla.iou).toBe(1);
    expect(r.boundary.max).toBeLessThan(1e-9);
  });

  it('one key has a porch the other lacks: the class is missing and the outline is a region', () => {
    const house = gla(rect(0, 0, 100, 100));
    const r = compareKeys([house, porch(rect(100, 0, 150, 100))], [house]);
    expect(r.agree).toBe(false);
    expect(r.counts.a).toEqual({ gla: 1, porch: 1 });
    expect(r.counts.b).toEqual({ gla: 1 });
    expect(r.regions).toHaveLength(1);
    expect(r.regions[0]).toMatchObject({ missing: 'A', class: 'nonGla' });
    expect(r.criteria.find((c) => c.id === 'd').ok).toBe(false);
  });

  it('one outline against two of the same type: the multiset differs even where the area is equal', () => {
    const one = [gla(rect(0, 0, 200, 100))];
    const two = [gla(rect(0, 0, 100, 100)), gla(rect(100, 0, 200, 100))];
    const r = compareKeys(one, two);
    expect(r.criteria[0].ok).toBe(false);
    expect(r.iou.building.iou).toBeGreaterThan(0.999);
    expect(r.agree).toBe(false);
  });

  it('holds each non-GLA type to 97% on its own', () => {
    const house = gla(rect(0, 0, 400, 300));
    const a = [house, garage(rect(400, 0, 600, 300)), porch(rect(0, 300, 400, 400))];
    // The porch is 4 px shallower in B: IoU 96/100 = 96%.
    const b = [house, garage(rect(400, 0, 600, 300)), porch(rect(0, 300, 400, 396))];
    const r = compareKeys(a, b);
    expect(r.iou.byType.garage.iou).toBe(1);
    expect(Math.abs(r.iou.byType.porch.iou - 0.96)).toBeLessThan(0.002);
    expect(r.criteria.filter((c) => c.id === 'c').map((c) => c.ok)).toEqual([true, false]);
    expect(r.agree).toBe(false);
  });

  it('reports unfinished space but does not score it', () => {
    const house = gla(rect(0, 0, 400, 300));
    const a = [house, { type: 'unfinished', v: rect(0, 300, 100, 340) }];
    const b = [house, { type: 'unfinished', v: rect(0, 300, 100, 341) }];
    const r = compareKeys(a, b);
    expect(r.iou.unfinished.iou).toBeLessThan(1);
    expect(r.agree).toBe(true);
  });
});

describe('the boundary distance statistics', () => {
  it('takes the 95th percentile from the sorted values', () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(values, 0.95)).toBe(95);
    expect(percentile([], 0.95)).toBe(0);
    expect(percentile([7], 0.95)).toBe(7);
  });

  it('keeps the largest apart from the 95th percentile: a short far stretch is the largest only', () => {
    // B's right wall bulges 6 px over 20 px of its 300 px length.
    const a = [gla(rect(0, 0, 300, 300))];
    const b = [gla([[0, 0], [300, 0], [300, 140], [306, 140], [306, 160], [300, 160], [300, 300], [0, 300]])];
    const r = compareKeys(a, b);
    expect(r.boundary.max).toBeCloseTo(6, 0);
    expect(r.boundary.p95).toBeLessThan(3);
    expect(r.regions).toHaveLength(1);
    expect(r.regions[0].maxDistance).toBeCloseTo(6, 0);
    expect(r.regions[0].bbox[1]).toBeGreaterThanOrEqual(138);
    expect(r.regions[0].bbox[3]).toBeLessThanOrEqual(162);
  });

  it('clusters two separate disagreements into two regions, worst first', () => {
    const a = [gla(rect(0, 0, 600, 300))];
    const b = [gla([[0, 0], [600, 0], [600, 100], [606, 100], [606, 120], [600, 120],
      [600, 200], [610, 200], [610, 220], [600, 220], [600, 300], [0, 300]])];
    const r = compareKeys(a, b);
    expect(r.regions).toHaveLength(2);
    expect(r.regions[0].maxDistance).toBeGreaterThan(r.regions[1].maxDistance);
    expect(r.regions.map((g) => g.id)).toEqual([1, 2]);
  });
});
