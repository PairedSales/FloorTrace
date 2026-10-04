import { describe, it, expect } from 'vitest';
import { labelAnchor } from '../labelAnchor';

const rect = (x, y, w, h) => [
  { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h },
];

const insideRing = (p, ring) => {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i];
    const b = ring[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
};

describe('labelAnchor', () => {
  it('finds the middle of a plain rectangle', () => {
    const at = labelAnchor(rect(0, 0, 400, 200));
    expect(at.x).toBeCloseTo(200, -1);
    expect(at.y).toBeCloseTo(100, -1);
    expect(at.clearance).toBeGreaterThan(90);
  });

  // The centroid of an L sits in the notch, outside the shape — which is where
  // the old badge was drawn.
  it('stays inside an L-shaped outline', () => {
    const ell = [
      { x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 100 },
      { x: 100, y: 100 }, { x: 100, y: 400 }, { x: 0, y: 400 },
    ];
    const at = labelAnchor(ell);
    expect(insideRing(at, ell)).toBe(true);
    expect(at.clearance).toBeGreaterThan(40);
  });

  it('keeps clear of a room size printed where the middle is', () => {
    const outline = rect(0, 0, 400, 200);
    const printed = { x: 150, y: 80, width: 100, height: 40 };
    const at = labelAnchor(outline, { avoid: [printed] });
    const onPrint = at.x >= printed.x && at.x <= printed.x + printed.width
      && at.y >= printed.y && at.y <= printed.y + printed.height;
    expect(onPrint).toBe(false);
    expect(at.clearance).toBeGreaterThan(30);
  });

  it('never lands in a cut-out', () => {
    const outline = rect(0, 0, 300, 300);
    const hole = rect(100, 100, 100, 100);
    const at = labelAnchor(outline, { holes: [hole] });
    expect(insideRing(at, hole)).toBe(false);
    expect(insideRing(at, outline)).toBe(true);
  });

  it('answers the same for the same outline', () => {
    const outline = rect(10, 20, 333, 217);
    expect(labelAnchor(outline)).toEqual(labelAnchor(outline));
  });

  it('refuses an outline with no area', () => {
    expect(labelAnchor([{ x: 0, y: 0 }, { x: 10, y: 0 }])).toBeNull();
    expect(labelAnchor([{ x: 5, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 5 }])).toBeNull();
  });
});
