import { describe, it, expect } from 'vitest';
import { inkIntegral } from '../inkMap';
import { labelAnchor } from '../labelAnchor';

// A white sheet with black boxes on it, as RGBA.
const sheet = (width, height, boxes = []) => {
  const rgba = new Uint8ClampedArray(width * height * 4).fill(255);
  for (const [x0, y0, x1, y1] of boxes) {
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const i = (y * width + x) * 4;
        rgba[i] = 0;
        rgba[i + 1] = 0;
        rgba[i + 2] = 0;
      }
    }
  }
  return rgba;
};

describe('inkIntegral', () => {
  it('reads blank paper as no ink and solid black as all of it', () => {
    const mean = inkIntegral(sheet(40, 30, [[10, 10, 20, 20]]), 40, 30);
    expect(mean(0, 0, 10, 10)).toBe(0);
    expect(mean(10, 10, 20, 20)).toBeCloseTo(1, 6);
    // A quarter of this box is the black square.
    expect(mean(0, 0, 20, 20)).toBeCloseTo(0.25, 6);
  });

  it('treats a transparent pixel as the paper under it', () => {
    const rgba = new Uint8ClampedArray(4 * 4 * 4); // black, fully transparent
    expect(inkIntegral(rgba, 4, 4)(0, 0, 4, 4)).toBe(0);
  });

  it('clips a box that runs off the sheet instead of failing', () => {
    const mean = inkIntegral(sheet(10, 10, [[0, 0, 10, 10]]), 10, 10);
    expect(mean(-50, -50, 5, 5)).toBeCloseTo(1, 6);
    expect(mean(20, 20, 30, 30)).toBe(0);
  });
});

describe('labelAnchor with the plan\'s ink', () => {
  const outline = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 200 }, { x: 0, y: 200 }];
  const size = { width: 100, height: 50 };

  // The case that put a label on the sample plan's kitchen size: print in the
  // middle of the room that nothing had read, so nothing said to avoid it.
  it('moves off print that was never read', () => {
    const print = [150, 80, 250, 120];
    const ink = inkIntegral(sheet(400, 200, [print]), 400, 200);
    const blind = labelAnchor(outline, { size });
    const seeing = labelAnchor(outline, { size, ink });
    expect(ink(blind.x - 50, blind.y - 25, blind.x + 50, blind.y + 25)).toBeGreaterThan(0.2);
    expect(seeing.ink).toBe(0);
    expect(seeing.clearance).toBeGreaterThanOrEqual(0);
  });

  it('reports the ink it could not avoid, so the caller can use a smaller label', () => {
    const ink = inkIntegral(sheet(400, 200, [[0, 0, 400, 200]]), 400, 200);
    expect(labelAnchor(outline, { size, ink }).ink).toBeCloseTo(1, 6);
  });

  it('says a label that fits nowhere does not fit', () => {
    const ink = inkIntegral(sheet(400, 200), 400, 200);
    const at = labelAnchor(outline, { size: { width: 500, height: 300 }, ink });
    expect(at.clearance).toBeLessThan(0);
  });
});
