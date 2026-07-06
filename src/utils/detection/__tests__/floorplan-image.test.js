// Integration tests against the real ExampleFloorplan.png. Ground-truth wall
// faces were measured from the image (see scripts/detectionBenchmark.mjs,
// which shares these expectations).
import fs from 'fs';
import path from 'path';
import { describe, expect, it, beforeAll } from 'vitest';
import { PNG } from 'pngjs';
import { detectRoomFromClickCore, traceFloorplanBoundaryCore } from '../pipeline.js';
import { polygonArea } from '../polygon.js';

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..', '..');

const loadPng = (filePath) => {
  const png = PNG.sync.read(fs.readFileSync(filePath));
  return { width: png.width, height: png.height, data: new Uint8ClampedArray(png.data) };
};

const bboxIou = (a, b) => {
  const ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  const iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const inter = ix * iy;
  const areaA = (a[2] - a[0]) * (a[3] - a[1]);
  const areaB = (b[2] - b[0]) * (b[3] - b[1]);
  return inter / (areaA + areaB - inter);
};

const bboxOf = (overlay) => [overlay.x1, overlay.y1, overlay.x2, overlay.y2];

let image;

beforeAll(() => {
  image = loadPng(path.join(ROOT, 'ExampleFloorplan.png'));
});

describe('boundary tracing on ExampleFloorplan.png', () => {
  let traced;

  beforeAll(() => {
    traced = traceFloorplanBoundaryCore(image, {});
  });

  it('produces outer and inner boundaries', () => {
    expect(traced?.outer?.polygon?.length).toBeGreaterThanOrEqual(4);
    expect(traced?.inner?.polygon?.length).toBeGreaterThanOrEqual(4);
  });

  it('outer bbox matches the measured building extents', () => {
    const iou = bboxIou(bboxOf(traced.outer.overlay), [77, 97, 1960, 1156]);
    expect(iou).toBeGreaterThan(0.95);
  });

  it('inner envelope nests inside the outer footprint', () => {
    expect(polygonArea(traced.inner.polygon)).toBeLessThan(polygonArea(traced.outer.polygon));
    expect(traced.inner.overlay.x1).toBeGreaterThan(traced.outer.overlay.x1);
    expect(traced.inner.overlay.x2).toBeLessThan(traced.outer.overlay.x2);
    expect(traced.inner.overlay.y1).toBeGreaterThan(traced.outer.overlay.y1);
    expect(traced.inner.overlay.y2).toBeLessThan(traced.outer.overlay.y2);
  });

  it('footprint area lands in the plausible range for this condo', () => {
    // ~39.3 px/ft measured; the unit is ~1100-1250 sq ft including walls.
    const sqFt = polygonArea(traced.outer.polygon) / (39.3 * 39.3);
    expect(sqFt).toBeGreaterThan(1000);
    expect(sqFt).toBeLessThan(1350);
  });
});

describe('room detection on ExampleFloorplan.png', () => {
  const cases = [
    { name: 'PRIMARY BEDROOM', click: [344, 479], dims: [12.42, 16.33], rect: [97, 119, 583, 758], minIou: 0.9 },
    { name: 'BEDROOM (with closet band)', click: [872, 359], dims: [13.42, 12.92], rect: [598, 119, 1123, 624], minIou: 0.9 },
    { name: 'LIVING/DINING', click: [1462, 490], dims: [16.58, 25.83], rect: [1136, 119, 1803, 1133], minIou: 0.85 },
    { name: 'KITCHEN (thin counter lines)', click: [1229, 1000], dims: [10.75, 7.92], rect: [1000, 820, 1428, 1133], minIou: 0.75 },
  ];

  for (const c of cases) {
    it(`finds ${c.name}`, () => {
      const room = detectRoomFromClickCore(image, { x: c.click[0], y: c.click[1] }, {
        labelDims: { width: c.dims[0], height: c.dims[1] },
      });
      expect(room).toBeTruthy();
      const iou = bboxIou(bboxOf(room.overlay), c.rect);
      expect(iou).toBeGreaterThan(c.minIou);
      expect(room.confidence).toBeGreaterThan(0.5);
      expect(room.polygon.length).toBe(4);
    });
  }

  it('flags the open-plan ENTRY label with reduced confidence', () => {
    const room = detectRoomFromClickCore(image, { x: 938, y: 748 }, {
      labelDims: { width: 13.42, height: 10.58 },
    });
    expect(room).toBeTruthy();
    // No physical wall bounds this label on all sides; the result must be
    // bounded (not the whole floor) and marked less certain.
    const [x1, y1, x2, y2] = bboxOf(room.overlay);
    expect((x2 - x1) * (y2 - y1)).toBeLessThan(0.35 * 1883 * 1059);
    expect(room.confidence).toBeLessThan(0.75);
  });
});
