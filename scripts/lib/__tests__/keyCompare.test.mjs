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
});

describe('compare: off the pixel grid, where the 99% line is decided', () => {
  const verdictOf = (a, b) => {
    const r = compareKeys([gla(rect(...a))], [gla(rect(...b))]);
    return { r, b: r.criteria.find((c) => c.id === 'b') };
  };

  it('a small house just under 99% disagrees though a raster read it as 99.14%', () => {
    // 114.9 x 117.4 px against a copy with every side moved by under 0.5 px:
    // exactly 98.635% (a 0.5 px raster says 99.14%).
    const a = [49.4, 36.3, 164.3, 153.7];
    const b = [48.9, 35.9, 164.7, 153.4];
    const inter = (164.3 - 49.4) * (153.4 - 36.3);
    const union = (164.3 - 49.4) * (153.7 - 36.3) + (164.7 - 48.9) * (153.4 - 35.9) - inter;
    const { r, b: crit } = verdictOf(a, b);
    expect(r.iou.building.iou).toBeCloseTo(inter / union, 12);
    expect(crit.ok).toBe(false);
    expect(r.agree).toBe(false);
    expect(r.failed[0]).toMatch(/building IoU 98\.6\d% < 99\.00%/);
  });

  it('a small house just over 99% agrees though a raster read it as 98.97%', () => {
    const a = [10.2, 11.8, 167.8, 135.9];
    const b = [10, 12, 167.1, 135.6];
    const inter = (167.1 - 10.2) * (135.6 - 12);
    const union = (167.8 - 10.2) * (135.9 - 11.8) + (167.1 - 10) * (135.6 - 12) - inter;
    const { r, b: crit } = verdictOf(a, b);
    expect(r.iou.building.iou).toBeCloseTo(inter / union, 12);
    expect(crit.ok).toBe(true);
    expect(r.agree).toBe(true);
  });
});

describe('compare: a difference in one direction only', () => {
  // A 200 x 200 house, and the same with a 4 px wide, 20 px long spike out of its
  // top wall, or a notch into it. The other key's wall passes within 2 px of the
  // spike's root, so measured from the plain key the spike is invisible: only a
  // measurement from the spiked key to the plain one finds its tip 20 px away.
  const plain = [gla(rect(0, 0, 200, 200))];
  const spiked = [gla([[0, 0], [98, 0], [98, -20], [102, -20], [102, 0], [200, 0], [200, 200], [0, 200]])];
  const notched = [gla([[0, 0], [98, 0], [98, 20], [102, 20], [102, 0], [200, 0], [200, 200], [0, 200]])];

  it.each([
    ['a spike on B', plain, spiked, 'B'],
    ['a spike on A', spiked, plain, 'A'],
    ['a notch in B', plain, notched, 'B'],
    ['a notch in A', notched, plain, 'A'],
  ])('%s: the tip is 20 px from the other key, and only the measurement from that key finds it', (_, a, b, side) => {
    const r = compareKeys(a, b);
    const [own, other] = side === 'A' ? [r.boundary.aToB, r.boundary.bToA] : [r.boundary.bToA, r.boundary.aToB];
    expect(own.max).toBeCloseTo(20, 0);
    expect(other.max).toBeLessThan(3);
    expect(r.boundary.max).toBeCloseTo(20, 0);
    // 80 px2 of 40,000: the IoU alone would let it through.
    expect(r.iou.building.iou).toBeGreaterThan(0.99);
    expect(r.criteria.find((c) => c.id === 'd').ok).toBe(false);
    expect(r.agree).toBe(false);
    expect(r.regions).toHaveLength(1);
    expect(r.regions[0]).toMatchObject({ side, class: 'building' });
    expect(r.regions[0].maxDistance).toBeCloseTo(20, 0);
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

describe('compare: small unfinished outlines do not decide agreement', () => {
  // A 300 x 200 house is 60,000 px2, so 2% of it is 1,200 px2. Unfinished space
  // is not scored: only a large outline of it is a type the keys must share.
  const house = gla(rect(0, 0, 300, 200));
  const unfinished = (v) => ({ type: 'unfinished', v });
  // A chimney mass out of the right wall, 24 x 20 = 480 px2 = 0.8% of the house
  // (about 12 sq ft at 0.5 ft/px on a 1,500 sq ft house).
  const chimney = unfinished(rect(300, 80, 324, 100));
  const criterion = (r, id) => r.criteria.find((c) => c.id === id);

  it('a 12 sq ft chimney that only A drew: they agree, and it is listed as informational', () => {
    const r = compareKeys([house, chimney], [house]);
    expect(r.agree).toBe(true);
    expect(criterion(r, 'a')).toMatchObject({ ok: true });
    expect(criterion(r, 'a').text).toMatch(/outline types match \(gla\) \(1 small unfinished outline\(s\) set aside, under 2\.00% of their key's building: informational\)/);
    expect(r.informational).toHaveLength(1);
    expect(r.informational[0]).toMatchObject({ key: 'A', outline: 1, inOther: false });
    expect(r.informational[0].area).toBeCloseTo(480, 6);
    expect(r.informational[0].share).toBeCloseTo(0.008, 9);
    expect(r.informational[0].bbox).toEqual([300, 80, 324, 100]);
    // The raw counts still say what each key drew; the boundary and the regions do not read it.
    expect(r.counts.a).toEqual({ gla: 1, unfinished: 1 });
    expect(r.counts.b).toEqual({ gla: 1 });
    expect(r.regions).toEqual([]);
    expect(criterion(r, 'd').ok).toBe(true);
    expect(r.boundary.byClass.unfinished).toBeUndefined();
    expect(r.boundary.max).toBeLessThan(1e-9);
  });

  it('a 10% unfinished region that only B drew: DISAGREE, on the types, with the outline as a region to look at', () => {
    // 100 x 60 = 6,000 px2 = 10% of the house.
    const eave = unfinished(rect(300, 0, 400, 60));
    const r = compareKeys([house], [house, eave]);
    expect(r.agree).toBe(false);
    expect(criterion(r, 'a').ok).toBe(false);
    expect(criterion(r, 'a').text).toBe('outline types differ: A has [gla], B has [gla, unfinished]');
    expect(r.informational).toEqual([]);
    expect(r.failed).toHaveLength(1);
    // Not a distance failure: unfinished is in no boundary criterion.
    expect(criterion(r, 'd').ok).toBe(true);
    expect(r.regions).toHaveLength(1);
    expect(r.regions[0]).toMatchObject({ missing: 'B', class: 'unfinished', scored: false, id: 1 });
    expect(r.regions[0].bbox).toEqual([300, 0, 400, 60]);
  });

  it('the line is 2% of the key\'s own building: 1,190 px2 is set aside, 1,210 px2 counts', () => {
    // 34 x 35 = 1,190 px2 = 1.983%; 22 x 55 = 1,210 px2 = 2.017%.
    const under = compareKeys([house, unfinished(rect(300, 0, 334, 35))], [house]);
    expect(under.agree).toBe(true);
    expect(under.informational).toHaveLength(1);
    const over = compareKeys([house, unfinished(rect(300, 0, 322, 55))], [house]);
    expect(over.agree).toBe(false);
    expect(over.informational).toEqual([]);
    expect(criterion(over, 'a').ok).toBe(false);
  });

  it('the building is the gla and the below-grade outlines of that key, summed', () => {
    // 20,000 + 20,000 px2: 2% is 800. 750 px2 is 3.75% of the gla alone.
    const ground = gla(rect(0, 0, 200, 100));
    const basement = { type: 'below-grade', v: rect(0, 100, 200, 200) };
    const stub = unfinished(rect(200, 40, 230, 65));
    const r = compareKeys([ground, basement, stub], [ground, basement]);
    expect(r.agree).toBe(true);
    expect(r.informational[0].share).toBeCloseTo(0.01875, 9);
    // The same stub against the ground floor alone is 3.75%: it counts.
    expect(compareKeys([ground, stub], [ground]).agree).toBe(false);
  });

  it('each key\'s own building sets its own limit: a stub small in A only is set aside in A only', () => {
    // B draws a half-size house, so the same 700 px2 stub is 3.5% of B's building.
    const big = gla(rect(0, 0, 200, 200));
    const small = gla(rect(0, 0, 200, 100));
    const stub = unfinished(rect(200, 40, 220, 75));
    const r = compareKeys([big, stub], [small, stub]);
    expect(r.informational.map((i) => i.key)).toEqual(['A']);
    expect(criterion(r, 'a').ok).toBe(false);
    expect(criterion(r, 'a').text).toMatch(/A has \[gla\], B has \[gla, unfinished\]/);
  });

  it('a large unfinished region both keys drew agrees whatever its edges do: unfinished is not in the IoU or the distance', () => {
    const eave = (x) => unfinished(rect(300 + x, 0, 400 + x, 60));
    const r = compareKeys([house, eave(0)], [house, eave(10)]);
    expect(r.agree).toBe(true);
    expect(r.iou.unfinished.iou).toBeLessThan(1);
    expect(r.boundary.max).toBeLessThan(1e-9);
    expect(r.informational).toEqual([]);
  });

  it('a small unfinished outline beside a large one leaves the large one to count', () => {
    const eave = unfinished(rect(300, 0, 400, 60));
    const withBoth = [house, chimney, eave];
    expect(compareKeys(withBoth, [house, eave]).agree).toBe(true);
    const r = compareKeys(withBoth, [house]);
    expect(r.agree).toBe(false);
    expect(criterion(r, 'a').text).toMatch(/A has \[gla, unfinished\], B has \[gla\]/);
    expect(r.regions.map((g) => g.bbox)).toEqual([[300, 0, 400, 60]]);
  });

  it('never softens a scored outline: a small garage is still a type, and a building 3.5 px off still fails', () => {
    const shed = garage(rect(300, 80, 324, 100));
    expect(compareKeys([house, shed], [house]).agree).toBe(false);
    const big = [gla(rect(0, 0, 2000, 1500))];
    expect(compareKeys([...big, unfinished(rect(2000, 0, 2020, 20))], [gla(rect(3.5, 0, 2003.5, 1500))]).agree).toBe(false);
  });
});
