// The key tool's snapping rule (scripts/lib/keySnap.mjs) on a synthetic wall
// band of known thickness: a rough outline a few pixels off each face must
// land on the outer faces, and an `in` edge on the inner face.
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
