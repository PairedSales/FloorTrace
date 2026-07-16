// Integration tests against the real ExampleFloorplan.png: a two-floor sheet
// (FLOOR 2 on top, FLOOR 1 with an attached garage below, ~16 px/ft). Wall
// faces were measured from the image (see scripts/detectionBenchmark.mjs,
// which shares these expectations). The sheet stresses the seal search:
// window spans up to ~142px, window gaps wrapping corners, and dashed
// stair-opening edges.
import fs from 'fs';
import path from 'path';
import { describe, expect, it, beforeAll } from 'vitest';
import { PNG } from 'pngjs';
import { detectRoomFromClickCore, traceFloorplanBoundaryCore } from '../pipeline.js';
import { polygonArea } from '../polygon.js';

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..', '..');
const PPF = 16.0;

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
  image = loadPng(path.join(ROOT, 'fixtures', 'ExampleFloorplan.png'));
});

describe('multi-floor boundary tracing on ExampleFloorplan.png', () => {
  let traced;

  beforeAll(() => {
    traced = traceFloorplanBoundaryCore(image, {});
  });

  it('finds both floors, in page reading order', () => {
    expect(traced?.floors?.length).toBe(2);
    const [top, bottom] = traced.floors;
    expect(bboxIou(bboxOf(top.outer.overlay), [29, 15, 620, 415])).toBeGreaterThan(0.9);
    // FLOOR 1 excludes the garage wing: the trace stops at the house's right
    // exterior wall instead of following the garage out to x=950.
    expect(bboxIou(bboxOf(bottom.outer.overlay), [29, 491, 620, 878])).toBeGreaterThan(0.9);
    expect(top.outer.overlay.y2).toBeLessThan(bottom.outer.overlay.y1);
  });

  it('excludes the garage geometrically, without any OCR label', () => {
    expect(traced.excludedRegions).toBe(1);
    expect(traced.excludedGarages).toBe(1);
    const bottom = traced.floors[1];
    const bottomSqFt = polygonArea(bottom.outer.polygon) / (PPF * PPF);
    // Living area only (~893 sq ft); with the garage the wing pushed this
    // above 1030 sq ft.
    expect(bottomSqFt).toBeGreaterThan(840);
    expect(bottomSqFt).toBeLessThan(950);
  });

  it('keeps the floors as separate polygons with plausible areas', () => {
    const [top, bottom] = traced.floors;
    const topSqFt = polygonArea(top.outer.polygon) / (PPF * PPF);
    const bottomSqFt = polygonArea(bottom.outer.polygon) / (PPF * PPF);
    expect(topSqFt).toBeGreaterThan(850);
    expect(topSqFt).toBeLessThan(980);
    expect(bottomSqFt).toBeGreaterThan(840);
    expect(bottomSqFt).toBeLessThan(950);
  });

  it('keeps the garage wing when auto garage exclusion is disabled', () => {
    const kept = traceFloorplanBoundaryCore(image, { boundary: { autoGarage: false } });
    expect(kept.excludedRegions).toBe(0);
    const bottom = kept.floors[1];
    expect(bboxIou(bboxOf(bottom.outer.overlay), [29, 491, 950, 878])).toBeGreaterThan(0.9);
    // Garage wing makes FLOOR 1 an L-shape with more corners than a rectangle.
    expect(bottom.outer.polygon.length).toBeGreaterThanOrEqual(6);
    const bottomSqFt = polygonArea(bottom.outer.polygon) / (PPF * PPF);
    expect(bottomSqFt).toBeGreaterThan(1030);
    expect(bottomSqFt).toBeLessThan(1180);
  });

  it('carves the same garage from an OCR label when geometry is off', () => {
    const labelled = traceFloorplanBoundaryCore(image, {
      boundary: { autoGarage: false },
      excludeRegions: [{ x: 757, y: 658, width: 50, height: 14, keyword: 'garage' }],
    });
    expect(labelled.excludedRegions).toBe(1);
    expect(labelled.excludedGarages).toBe(1);
    expect(bboxIou(bboxOf(labelled.floors[1].outer.overlay), [29, 491, 620, 878])).toBeGreaterThan(0.9);
  });

  it('produces a nested inner envelope for each floor', () => {
    for (const floor of traced.floors) {
      expect(floor.inner?.polygon?.length).toBeGreaterThanOrEqual(4);
      expect(polygonArea(floor.inner.polygon)).toBeLessThan(polygonArea(floor.outer.polygon));
      expect(floor.inner.overlay.x1).toBeGreaterThan(floor.outer.overlay.x1);
      expect(floor.inner.overlay.x2).toBeLessThan(floor.outer.overlay.x2);
      expect(floor.inner.overlay.y1).toBeGreaterThan(floor.outer.overlay.y1);
      expect(floor.inner.overlay.y2).toBeLessThan(floor.outer.overlay.y2);
    }
  });

  it('keeps the largest floor as the top-level boundary for single-boundary callers', () => {
    // With the garage carved from FLOOR 1, FLOOR 2 (909 sq ft) edges it out.
    const top = traced.floors[0];
    expect(traced.outer.polygon).toEqual(top.outer.polygon);
  });
});

describe('room detection on ExampleFloorplan.png', () => {
  const cases = [
    { name: 'BEDROOM (top-left, floor 2)', click: [205, 105], dims: [7.75, 10.33], rect: [149, 25, 269, 188] },
    { name: 'PRIMARY BEDROOM (floor 2)', click: [512, 128], dims: [12.58, 13.25], rect: [417, 25, 611, 231] },
    { name: 'BEDROOM (bottom-right, floor 2)', click: [512, 322], dims: [12.58, 10.83], rect: [417, 233, 611, 406] },
    { name: 'UTILITY (floor 1)', click: [513, 585], dims: [10.0, 9.25], rect: [456, 500, 611, 643] },
    { name: 'GARAGE (floor 1)', click: [778, 672], dims: [20.58, 9.5], rect: [620, 596, 943, 743] },
    { name: 'FAMILY ROOM (floor 1)', click: [495, 753], dims: [14.83, 14.08], rect: [380, 650, 611, 868], minIou: 0.85 },
  ];

  // Rooms span both floors: before per-floor footprints, clicks on the floor
  // that was not the largest footprint returned null or leaked.
  for (const c of cases) {
    it(`finds ${c.name}`, () => {
      const room = detectRoomFromClickCore(image, { x: c.click[0], y: c.click[1] }, {
        labelDims: { width: c.dims[0], height: c.dims[1] },
      });
      expect(room).toBeTruthy();
      const iou = bboxIou(bboxOf(room.overlay), c.rect);
      expect(iou).toBeGreaterThan(c.minIou ?? 0.9);
      expect(room.confidence).toBeGreaterThan(0.5);
      expect(room.polygon.length).toBe(4);
    });
  }

  it('flags the open-plan KITCHEN label with reduced confidence', () => {
    const room = detectRoomFromClickCore(image, { x: 250, y: 573 }, {
      labelDims: { width: 10.08, height: 10.33 },
    });
    expect(room).toBeTruthy();
    // No physical wall separates the kitchen from the dining area; the result
    // must stay bounded within floor 1 and be marked less certain.
    const [x1, y1, x2, y2] = bboxOf(room.overlay);
    expect(y1).toBeGreaterThanOrEqual(491);
    expect(x2).toBeLessThanOrEqual(620);
    expect((x2 - x1) * (y2 - y1)).toBeLessThan(0.4 * 921 * 387);
    expect(room.confidence).toBeLessThan(0.8);
  });
});
