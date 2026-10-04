// The picture a key is drawn from (scripts/lib/keyView.mjs): a crop scaled to
// about 1,400 px with a grid in image pixels, and outlines where their
// coordinates say. Checked on pixels, so it does not depend on fonts.
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { renderView } from '../keyView.mjs';

const GUTTER = 30;
const page = (w, h) => {
  const p = new PNG({ width: w, height: h });
  p.data.fill(255);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) p.data[(y * w + x) * 4 + 3] = 255;
  return p;
};
const paint = (p, x0, y0, x1, y1) => {
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const i = (y * p.width + x) * 4;
      p.data[i] = 0;
      p.data[i + 1] = 0;
      p.data[i + 2] = 0;
    }
  }
};
const decode = (buffer) => PNG.sync.read(buffer);
const pixel = (png, x, y) => {
  const i = (Math.round(y) * png.width + Math.round(x)) * 4;
  return [png.data[i], png.data[i + 1], png.data[i + 2]];
};
const anyNear = (png, x, y, test, r = 2) => {
  for (let dy = -r; dy <= r; dy += 1) for (let dx = -r; dx <= r; dx += 1) if (test(pixel(png, x + dx, y + dy))) return true;
  return false;
};
const red = ([r, g, b]) => r > 200 && g < 90 && b < 90;

describe('a view', () => {
  const src = page(400, 300);
  paint(src, 100, 80, 300, 88);
  const bytes = PNG.sync.write(src);

  it('puts the page where the crop says, so a pixel of the page lands at a known place', async () => {
    const { png, summary } = await renderView(bytes, { crop: [80, 60, 320, 240], grid: 20 });
    const out = decode(png);
    // Inside the black band (page y 80-88) and above it (page y < 80).
    const at = (x, y) => pixel(out, GUTTER + (x - 80) * summary.scale, GUTTER + (y - 60) * summary.scale);
    expect(at(190, 84)[0]).toBeLessThan(60);
    expect(at(190, 70)[0]).toBeGreaterThan(200);
    // The band's top face is at page y = 80, which is where it starts on the picture.
    expect(at(190, 79.5)[0]).toBeGreaterThan(200);
    expect(at(190, 80.5)[0]).toBeLessThan(60);
  });

  it('draws an outline layer at its coordinates, clipped to the crop', async () => {
    const { png, summary } = await renderView(bytes, {
      crop: [80, 60, 320, 240],
      grid: 0,
      layers: [{
        label: 'A', color: '#ff0000', width: 2, outlines: [{ type: 'gla', v: [[100, 100], [300, 100], [300, 200], [100, 200]] }],
      }],
    });
    const out = decode(png);
    const map = (x, y) => [GUTTER + (x - 80) * summary.scale, GUTTER + (y - 60) * summary.scale];
    expect(anyNear(out, ...map(200, 100), red)).toBe(true);
    expect(anyNear(out, ...map(100, 150), red)).toBe(true);
    expect(anyNear(out, ...map(200, 150), red)).toBe(false);
  });

  it('marks the grid in the margin on all four edges, in image pixels', async () => {
    const { png, summary } = await renderView(bytes, { crop: [80, 60, 320, 240], grid: 20 });
    const out = decode(png);
    const px = (x) => GUTTER + (x - 80) * summary.scale;
    const py = (y) => GUTTER + (y - 60) * summary.scale;
    const tick = ([r, g, b]) => r > 100 && g < 60 && b < 60;
    // A tick at page x=100 above and below the picture, and at page y=100 left and right of it.
    const areaH = out.height - 2 * GUTTER - 20 * 2 - 8 - 4;
    expect(anyNear(out, px(100), GUTTER - 2, tick, 1)).toBe(true);
    expect(anyNear(out, px(100), GUTTER + (240 - 60) * summary.scale + 2, tick, 1)).toBe(true);
    expect(anyNear(out, GUTTER - 2, py(100), tick, 1)).toBe(true);
    expect(anyNear(out, GUTTER + (320 - 80) * summary.scale + 2, py(100), tick, 1)).toBe(true);
    expect(areaH).toBeGreaterThan(0);
  });

  it('clamps a crop that runs off the page, and can leave out the grid', async () => {
    const { summary } = await renderView(bytes, { crop: [-50, -50, 900, 900], grid: 0 });
    expect(summary.crop).toEqual([0, 0, 400, 300]);
    expect(summary.line).toMatch(/grid none$/);
  });
});
