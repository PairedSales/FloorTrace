// The key tool's snapping rule (scripts/lib/keySnap.mjs) on a synthetic wall
// band of known thickness: a rough outline a few pixels off each face must
// land on the outer faces, and an `in` edge on the inner face. Then the walls
// plan books really draw: hatched, double-line, with sills proud of them.
import { describe, expect, it } from 'vitest';
import { otsuOfImage, snapOutline, snapOutlines } from '../keySnap.mjs';

const W = 400;
const H = 300;
const blank = () => ({ width: W, height: H, data: new Uint8ClampedArray(W * H * 4).fill(255) });
const fillRect = (image, x0, y0, x1, y1, value = 0) => {
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const i = (y * W + x) * 4;
      image.data[i] = value;
      image.data[i + 1] = value;
      image.data[i + 2] = value;
    }
  }
};
// A house: a black band 8 px thick whose outer faces sit on the box
// (100, 80)-(300, 220), and a garage of the same band butted to its right.
const house = () => {
  const image = blank();
  fillRect(image, 100, 80, 300, 88);
  fillRect(image, 100, 212, 300, 220);
  fillRect(image, 100, 80, 108, 220);
  fillRect(image, 292, 80, 300, 220);
  return image;
};
const near = (a, b, tol = 0.5) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol);

describe('snapping a rough outline to the wall band', () => {
  it('lands each edge on the outer face, from either side of the wall', () => {
    const image = house();
    const rough = { v: [[97, 77], [303, 77], [303, 223], [97, 223]] };
    const { v, edges } = snapOutline(image, rough);
    near(v[0][0], 100);
    near(v[0][1], 80);
    near(v[1][0], 300);
    near(v[1][1], 80);
    near(v[2][0], 300);
    near(v[2][1], 220);
    near(v[3][0], 100);
    near(v[3][1], 220);
    expect(edges.every((e) => e.flag === null)).toBe(true);
  });

  it('lands within half a pixel of the true face wherever inside or outside the band it is drawn', () => {
    const image = house();
    for (const off of [-6, -3, -1, 0, 1, 3, 6]) {
      const { v } = snapOutline(image, { v: [[100, 80 + off], [300, 80 + off], [300, 220], [100, 220]], fix: [1, 2, 3] });
      near(v[0][1], 80);
    }
  });

  it('does not depend on which way the ring is wound', () => {
    const image = house();
    const rough = { v: [[96, 224], [304, 224], [304, 76], [96, 76]] };
    const { v } = snapOutline(image, rough);
    near(v[0][0], 100);
    near(v[0][1], 220);
    near(v[2][0], 300);
    near(v[2][1], 80);
  });

  it('puts an `in` edge on the inner face, where the house meets its garage', () => {
    const image = house();
    // The garage is drawn to the right of the house's right wall.
    const rough = { v: [[296, 80], [380, 80], [380, 220], [296, 220]], in: [3] };
    const { v } = snapOutline(image, rough);
    // Edge 3 runs (296, 220) -> (296, 80) and faces the house, so the band's
    // outer end is its far face (x = 292) and its inner end the house's
    // exterior face (x = 300), which is where the garage begins.
    near(v[0][0], 300);
    near(v[3][0], 300);
  });

  it('leaves a `fix` edge where it is drawn', () => {
    const image = house();
    const rough = { v: [[96, 76], [304, 76], [304, 224], [96, 224]], fix: [1] };
    const { v, edges } = snapOutline(image, rough);
    expect(edges[1].fixed).toBe(true);
    near(v[1][0], 304);
    near(v[2][0], 304);
    near(v[0][1], 80);
  });

  it('flags an edge that finds no band and leaves it', () => {
    const image = blank();
    const rough = { v: [[100, 80], [300, 80], [300, 220], [100, 220]] };
    const { v, edges } = snapOutline(image, rough);
    expect(edges.every((e) => e.flag === 'no-band')).toBe(true);
    expect(v[0]).toEqual([100, 80]);
  });

  it('flags an edge that moved more than 4 px, and one whose band reaches the end of the search', () => {
    const image = house();
    const far = snapOutline(image, { v: [[90, 70], [300, 80], [300, 220], [100, 220]], R: 14 });
    expect(far.edges[0].flag).toBe('far');
    expect(far.edges[3].flag).toBe('far');
    const solid = blank();
    fillRect(solid, 100, 40, 300, 260);
    const swallowed = snapOutline(solid, { v: [[100, 100], [300, 100], [300, 200], [100, 200]], R: 6 });
    expect(swallowed.edges[0].flag).toBe('reaches-end');
  });

  it('follows a wall a scan has tilted when asked to', () => {
    // A top wall 8 px thick running from y=80 at x=100 to y=90 at x=500,
    // drawn by shifting each column.
    const big = { width: 600, height: 300, data: new Uint8ClampedArray(600 * 300 * 4).fill(255) };
    for (let x = 100; x < 500; x += 1) {
      const top = Math.round(80 + (10 * (x - 100)) / 400);
      for (let y = top; y < top + 8; y += 1) {
        const i = (y * 600 + x) * 4;
        big.data[i] = 0;
        big.data[i + 1] = 0;
        big.data[i + 2] = 0;
      }
    }
    const rough = { v: [[100, 84], [500, 84], [500, 200], [100, 200]], fix: [1, 2, 3], tilt: true };
    const { v } = snapOutline(big, rough);
    near(v[0][1], 80, 1);
    near(v[1][1], 90, 1);
  });

  it('reads the ink threshold from the page', () => {
    const t = otsuOfImage(house());
    expect(t).toBeGreaterThanOrEqual(0);
    expect(t).toBeLessThan(255);
    // Two tones: the midpoint of their means, not the tone itself.
    expect(t).toBeCloseTo(127.5, 0);
  });
});

// A wall drawn the way plan books draw it: not one solid band.
describe('walls that are not one solid band', () => {
  // A top wall whose face is the outer line at y=80: a 2 px line, a 7 px zone
  // hatched with 45-degree strokes 2 px wide every 12 px, then a solid band
  // from y=89 to y=97.
  const hatched = () => {
    const image = blank();
    fillRect(image, 100, 80, 300, 82);
    for (let y = 82; y < 89; y += 1) {
      for (let x = 100; x < 300; x += 1) if ((((x - y) % 12) + 12) % 12 < 2) fillRect(image, x, y, x + 1, y + 1);
    }
    fillRect(image, 100, 89, 300, 97);
    return image;
  };
  const rough = (y, extra = {}) => ({
    v: [[100, y], [300, y], [300, 200], [100, 200]], fix: [1, 2, 3], ...extra,
  });

  it('takes the outer line of a hatched wall when it is drawn on or beside it', () => {
    const image = hatched();
    for (const y of [77, 80, 84]) {
      const { v, edges } = snapOutline(image, rough(y));
      near(v[0][1], 80);
      expect(edges[0].flags).not.toContain('no-band');
    }
  });

  it('flags a hatched wall drawn on its solid band as ink-beyond, and bridges it when told to', () => {
    const image = hatched();
    const solid = snapOutline(image, rough(91));
    near(solid.v[0][1], 89);
    expect(solid.edges[0].flags).toContain('ink-beyond');
    expect(solid.edges[0].beyond).toBeCloseTo(7, 0);
    const bridged = snapOutline(image, rough(91, { bridge: 8 }));
    near(bridged.v[0][1], 80);
    expect(bridged.edges[0].flags).not.toContain('ink-beyond');
  });

  it('reads a double-line wall by its outer line, and its inner line for an `in` edge once bridged', () => {
    const image = blank();
    fillRect(image, 100, 80, 300, 82);
    fillRect(image, 100, 88, 300, 90);
    // Drawn outside, it lands on the outer line and nothing lies beyond it.
    const outside = snapOutline(image, rough(78));
    near(outside.v[0][1], 80);
    expect(outside.edges[0].flags).toEqual([]);
    // Drawn between the lines and nearer the inner one, it takes the inner
    // line's outer end, and says the outer line lies 6 px beyond.
    const between = snapOutline(image, rough(86));
    near(between.v[0][1], 88);
    expect(between.edges[0].flags).toContain('ink-beyond');
    expect(between.edges[0].beyond).toBeCloseTo(6, 0);
    const merged = snapOutline(image, rough(86, { bridge: 8 }));
    near(merged.v[0][1], 80);
    const inner = snapOutline(image, rough(84, { bridge: 8, in: [0] }));
    near(inner.v[0][1], 90);
  });

  it('does not take a window sill drawn proud of the wall for the wall', () => {
    const image = house();
    // A sill 5 px proud of the top wall along 15% of its length.
    fillRect(image, 150, 75, 180, 80);
    const { v } = snapOutline(image, { v: [[97, 77], [303, 77], [303, 223], [97, 223]] });
    near(v[0][1], 80);
  });

  it('bridges a hairline of paper inside one stroke without being asked', () => {
    const image = blank();
    fillRect(image, 100, 80, 300, 83);
    fillRect(image, 100, 85, 300, 90);
    const { v } = snapOutline(image, rough(84));
    near(v[0][1], 80);
  });
});

describe('the flags on a snapped edge', () => {
  it('flags reaches-end only for the side that decides the face', () => {
    // A band 30 px thick: its inner end lies beyond the reach of a drawn line
    // near the outer face, which does not matter for an outer face.
    const image = blank();
    fillRect(image, 100, 80, 300, 110);
    const shape = { v: [[100, 78], [300, 78], [300, 200], [100, 200]], R: 10, fix: [1, 2, 3] };
    const outer = snapOutline(image, shape);
    near(outer.v[0][1], 80);
    expect(outer.edges[0].flags).not.toContain('reaches-end');
    const inner = snapOutline(image, { ...shape, in: [0] });
    expect(inner.edges[0].flags).toContain('reaches-end');
  });

  it('slides a vertex whose edges are nearly parallel instead of throwing it across the page', () => {
    const image = house();
    // Edge 0 is fixed and rises a little; edge 1 snaps to the wall face at
    // y=80 from y=76. The two lines would meet 400 px away.
    const { v, warnings } = snapOutline(image, {
      v: [[100, 74], [200, 76], [300, 76], [300, 220], [100, 220]], fix: [0, 2, 3, 4],
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/nearly parallel/);
    near(v[1][1], 80);
    near(v[1][0], 200, 5);
  });
});

describe('outlines that share a boundary', () => {
  it('a ref vertex takes the referred vertex exactly, after it has snapped', () => {
    const image = house();
    fillRect(image, 292, 80, 380, 88);
    fillRect(image, 292, 212, 380, 220);
    fillRect(image, 372, 80, 380, 220);
    const [gla, garage] = snapOutlines(image, [
      { type: 'gla', v: [[97, 77], [303, 77], [303, 223], [97, 223]] },
      { type: 'garage', v: [['ref', 0, 1], [383, 80], [383, 220], ['ref', 0, 2]] },
    ]);
    expect(garage.v[0]).toEqual(gla.v[1]);
    expect(garage.v[3]).toEqual(gla.v[2]);
    near(garage.v[1][0], 380);
    near(garage.v[1][1], 80);
    // Both refs make edge 3 the shared boundary: it does not move.
    expect(garage.edges[3].fixed).toBe(true);
  });

  it('refuses outlines that refer to each other in a loop', () => {
    const image = house();
    expect(() => snapOutlines(image, [
      { v: [['ref', 1, 0], [300, 80], [300, 220]] },
      { v: [['ref', 0, 0], [300, 80], [300, 220]] },
    ])).toThrow(/loop/);
  });
});
