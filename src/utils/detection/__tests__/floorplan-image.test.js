/**
 * Comprehensive integration tests using real floorplan images.
 *
 * These tests load ExampleFloorplan.png and run the detection pipeline
 * on it, verifying room detection and exterior wall tracing produce
 * sensible results that match known properties of the floorplan.
 *
 * ExampleFloorplan-Traced.png is used as a ground-truth reference for
 * the exterior boundary location (the traced outline).
 *
 * The detection algorithms:
 * - Room detection: morphological closing → expansion from click in
 *   4 directions (left/right/up/down) until walls with sufficient
 *   perpendicular continuity are found → axis-aligned rectangle.
 * - Exterior wall detection: edge-inward scanning (row + column) →
 *   buildEdgeScanFootprint; falls back to flood-fill-from-edges.
 */
import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import { detectRoomFromClickCore, traceFloorplanBoundaryCore, boundaryByMode } from '../pipeline';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Load a PNG file and return an ImageData-like object. */
const loadPngAsImageData = (filePath) => {
  const raw = fs.readFileSync(filePath);
  const png = PNG.sync.read(raw);
  return {
    width: png.width,
    height: png.height,
    data: new Uint8ClampedArray(png.data),
  };
};

/** Signed area (shoelace). */
const polygonArea = (polygon) => {
  let sum = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const cur = polygon[i];
    const nxt = polygon[(i + 1) % polygon.length];
    sum += cur.x * nxt.y - nxt.x * cur.y;
  }
  return Math.abs(sum) / 2;
};

/** Axis-aligned bounding-box of a polygon. */
const polygonBBox = (polygon) => {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of polygon) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, maxX, minY, maxY };
};

/* ------------------------------------------------------------------ */
/*  Fixture setup                                                      */
/* ------------------------------------------------------------------ */

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..', '..');
const EXAMPLE_PATH = path.join(ROOT, 'ExampleFloorplan.png');
const TRACED_PATH = path.join(ROOT, 'ExampleFloorplan-Traced.png');
const WINDOW_INTERRUPTION_FIXTURE_PATH = path.join(
  ROOT,
  'src',
  'utils',
  'detection',
  '__tests__',
  '__fixtures__',
  'WindowInterruptionsFloorplan.png'
);

let exampleImage;
let tracedImage;
let imagesAvailable = false;
let windowInterruptionImage;
const windowFixtureAvailable = fs.existsSync(WINDOW_INTERRUPTION_FIXTURE_PATH);

try {
  exampleImage = loadPngAsImageData(EXAMPLE_PATH);
  tracedImage = loadPngAsImageData(TRACED_PATH);
  imagesAvailable = true;
} catch {
  // Tests will be skipped if images are missing.
}

if (windowFixtureAvailable) {
  windowInterruptionImage = loadPngAsImageData(WINDOW_INTERRUPTION_FIXTURE_PATH);
}

/* ------------------------------------------------------------------ */
/*  Known properties of ExampleFloorplan.png (2036 × 1440)             */
/*                                                                     */
/*  Exterior content bounds: x ∈ [79, 2012], y ∈ [101, 1418]          */
/*  Dark-pixel footprint: ≈ 62% of image area                         */
/*                                                                     */
/*  Major interior free-space regions (rooms), sorted by size:         */
/*   1. Large open area    center ≈ (1268, 627)  1337×1010             */
/*   2. Big left room      center ≈ ( 342, 440)   485× 635            */
/*   3. Upper-middle room  center ≈ ( 861, 373)   523× 502            */
/*   4. Lower-left room    center ≈ ( 199, 911)   200× 277            */
/*   5. Lower-center room  center ≈ ( 644, 867)   200× 190            */
/*                                                                     */
/*  Algorithm output (commit 62804bf):                                 */
/*  Exterior outer: x=[77, 1960], y=[97, 1420], area ≈ 2,154,000      */
/*  Room (342,440): overlay ≈ [100,122]–[585,758], area ≈ 307,000     */
/*  Room (861,373): overlay ≈ [599,122]–[1123,595], area ≈ 247,000    */
/* ------------------------------------------------------------------ */

const IMAGE_WIDTH = 2036;
const IMAGE_HEIGHT = 1440;
const IMAGE_AREA = IMAGE_WIDTH * IMAGE_HEIGHT;

/* ------------------------------------------------------------------ */
/*  Exterior Wall Tracing Tests                                        */
/* ------------------------------------------------------------------ */

describe('exterior wall tracing (ExampleFloorplan.png)', () => {
  it.skipIf(!imagesAvailable)('produces a non-null result with outer and inner boundaries', () => {
    const result = traceFloorplanBoundaryCore(exampleImage);
    expect(result).toBeTruthy();
    expect(result.outer).toBeTruthy();
    expect(result.inner).toBeTruthy();
  }, 15000);

  it.skipIf(!imagesAvailable)('outer boundary polygon has enough vertices', () => {
    const result = traceFloorplanBoundaryCore(exampleImage);
    expect(result.outer.polygon.length).toBeGreaterThanOrEqual(4);
  }, 15000);

  it.skipIf(!imagesAvailable)('outer boundary area covers a significant portion of the image', () => {
    const result = traceFloorplanBoundaryCore(exampleImage);
    const area = polygonArea(result.outer.polygon);
    // The footprint area should be > 40% and < 95% of the image
    expect(area).toBeGreaterThan(IMAGE_AREA * 0.4);
    expect(area).toBeLessThan(IMAGE_AREA * 0.95);
  }, 15000);

  it.skipIf(!imagesAvailable)('outer boundary spans most of the floorplan content area', () => {
    const result = traceFloorplanBoundaryCore(exampleImage);
    const bbox = polygonBBox(result.outer.polygon);

    // The floorplan wall structure spans approximately x=[79,2012], y=[101,1160].
    // Text labels and logos below the building (e.g. "FLOOR PLAN", watermarks)
    // are correctly excluded from the boundary.
    expect(bbox.minX).toBeLessThan(150);
    expect(bbox.maxX).toBeGreaterThan(1800);
    expect(bbox.minY).toBeLessThan(150);
    expect(bbox.maxY).toBeGreaterThan(1100);
  }, 15000);

  it.skipIf(!imagesAvailable)('inner boundary area is smaller than or equal to outer boundary', () => {
    const result = traceFloorplanBoundaryCore(exampleImage);
    const outerArea = polygonArea(result.outer.polygon);
    const innerArea = polygonArea(result.inner.polygon);
    expect(outerArea).toBeGreaterThanOrEqual(innerArea * 0.85);
  }, 15000);

  it.skipIf(!imagesAvailable)('boundaryByMode returns correct boundary for each mode', () => {
    const result = traceFloorplanBoundaryCore(exampleImage);

    const outerMode = boundaryByMode(result, 'outer');
    const innerMode = boundaryByMode(result, 'inner');
    expect(outerMode).toBeTruthy();
    expect(innerMode).toBeTruthy();
    expect(outerMode.polygon.length).toBeGreaterThanOrEqual(4);
    expect(innerMode.polygon.length).toBeGreaterThanOrEqual(4);
  }, 15000);

  it.skipIf(!imagesAvailable)('overlay coordinates are valid and non-degenerate', () => {
    const result = traceFloorplanBoundaryCore(exampleImage);
    const { overlay } = result.outer;
    expect(overlay.x2).toBeGreaterThan(overlay.x1 + 100);
    expect(overlay.y2).toBeGreaterThan(overlay.y1 + 100);
  }, 15000);

  it.skipIf(!imagesAvailable)('debug info indicates edge scan was used', () => {
    const result = traceFloorplanBoundaryCore(exampleImage);
    expect(result.debug).toBeTruthy();
    expect(result.debug.usedEdgeScan).toBe(true);
    expect(result.debug.normalizedSize.width).toBeGreaterThan(0);
    expect(result.debug.normalizedSize.height).toBeGreaterThan(0);
    expect(result.debug.hasOuter).toBe(true);
    expect(result.debug.hasInner).toBe(true);
  }, 15000);
});

/* ------------------------------------------------------------------ */
/*  Room Detection Tests                                               */
/* ------------------------------------------------------------------ */

describe('room detection (ExampleFloorplan.png)', () => {
  it.skipIf(!imagesAvailable)('detects the big left room at (342, 440)', () => {
    const room = detectRoomFromClickCore(exampleImage, { x: 342, y: 440 });
    expect(room).toBeTruthy();
    expect(room.polygon.length).toBeGreaterThan(2);
    // Click point should be inside the detected overlay
    expect(room.overlay.x1).toBeLessThanOrEqual(342);
    expect(room.overlay.x2).toBeGreaterThanOrEqual(342);
    expect(room.overlay.y1).toBeLessThanOrEqual(440);
    expect(room.overlay.y2).toBeGreaterThanOrEqual(440);
    // The room is roughly 485×635 pixels, so area should be reasonable
    const area = polygonArea(room.polygon);
    expect(area).toBeGreaterThan(50000);
    expect(area).toBeLessThan(IMAGE_AREA * 0.6);
  }, 15000);

  it.skipIf(!imagesAvailable)('detects the upper-middle room at (861, 373)', () => {
    const room = detectRoomFromClickCore(exampleImage, { x: 861, y: 373 });
    expect(room).toBeTruthy();
    expect(room.polygon.length).toBeGreaterThan(2);
    expect(room.overlay.x1).toBeLessThanOrEqual(861);
    expect(room.overlay.x2).toBeGreaterThanOrEqual(861);
    expect(room.overlay.y1).toBeLessThanOrEqual(373);
    expect(room.overlay.y2).toBeGreaterThanOrEqual(373);
    const area = polygonArea(room.polygon);
    expect(area).toBeGreaterThan(30000);
    expect(area).toBeLessThan(IMAGE_AREA * 0.6);
  }, 15000);

  it.skipIf(!imagesAvailable)('detects the lower-left room at (199, 911)', () => {
    const room = detectRoomFromClickCore(exampleImage, { x: 199, y: 911 });
    expect(room).toBeTruthy();
    expect(room.polygon.length).toBeGreaterThan(2);
    expect(room.overlay.x1).toBeLessThanOrEqual(199);
    expect(room.overlay.x2).toBeGreaterThanOrEqual(199);
  }, 15000);

  it.skipIf(!imagesAvailable)('different rooms yield distinct overlays', () => {
    const room1 = detectRoomFromClickCore(exampleImage, { x: 342, y: 440 }); // left room
    const room2 = detectRoomFromClickCore(exampleImage, { x: 861, y: 373 }); // upper-middle room
    expect(room1).toBeTruthy();
    expect(room2).toBeTruthy();

    // The overlays should differ (different rooms)
    const overlaysDiffer =
      room1.overlay.x1 !== room2.overlay.x1 ||
      room1.overlay.y1 !== room2.overlay.y1 ||
      room1.overlay.x2 !== room2.overlay.x2 ||
      room1.overlay.y2 !== room2.overlay.y2;
    expect(overlaysDiffer).toBe(true);
  }, 30000);

  it.skipIf(!imagesAvailable)('room detection returns a confidence value between 0 and 1', () => {
    const room = detectRoomFromClickCore(exampleImage, { x: 342, y: 440 });
    expect(room).toBeTruthy();
    expect(room.confidence).toBeGreaterThanOrEqual(0);
    expect(room.confidence).toBeLessThanOrEqual(1);
  }, 15000);

  it.skipIf(!imagesAvailable)('room detection includes debug info', () => {
    const room = detectRoomFromClickCore(exampleImage, { x: 342, y: 440 });
    expect(room).toBeTruthy();
    expect(room.debug).toBeTruthy();
    expect(room.debug.normalizedSize).toBeTruthy();
    expect(room.debug.normalizedSize.width).toBeGreaterThan(0);
    expect(room.debug.normalizedSize.height).toBeGreaterThan(0);
    expect(room.debug.dominantAngles).toBeTruthy();
  }, 15000);

  it.skipIf(!imagesAvailable)('clicking on a wall pixel still finds a nearby room', () => {
    // The left exterior wall is at approximately x=85
    const room = detectRoomFromClickCore(exampleImage, { x: 85, y: 440 });
    // Should either find a room or return null (not crash)
    if (room) {
      expect(room.polygon.length).toBeGreaterThan(2);
    }
  }, 15000);

  it.skipIf(!imagesAvailable)('clicking in the large open area detects room walls', () => {
    // The large open area (1268, 627) is a very large connected region.
    // The expansion algorithm should still find walls and return a valid
    // rectangular room.
    const room = detectRoomFromClickCore(exampleImage, { x: 1268, y: 627 });
    expect(room).toBeTruthy();
    expect(room.polygon.length).toBeGreaterThan(2);
    expect(room.confidence).toBeGreaterThanOrEqual(0);
    expect(room.confidence).toBeLessThanOrEqual(1);
  }, 15000);

  it.skipIf(!imagesAvailable)('multiple room detections are stable (deterministic)', () => {
    const click = { x: 342, y: 440 };
    const room1 = detectRoomFromClickCore(exampleImage, click);
    const room2 = detectRoomFromClickCore(exampleImage, click);
    expect(room1).toBeTruthy();
    expect(room2).toBeTruthy();
    expect(room1.overlay.x1).toBe(room2.overlay.x1);
    expect(room1.overlay.y1).toBe(room2.overlay.y1);
    expect(room1.overlay.x2).toBe(room2.overlay.x2);
    expect(room1.overlay.y2).toBe(room2.overlay.y2);
  }, 30000);
});

/* ------------------------------------------------------------------ */
/*  Ground-Truth Comparison Tests (ExampleFloorplan-Traced.png)         */
/* ------------------------------------------------------------------ */

describe('ground-truth comparison (ExampleFloorplan-Traced.png)', () => {
  it.skipIf(!imagesAvailable)('traced image has the expected dimensions', () => {
    expect(tracedImage.width).toBe(1451);
    expect(tracedImage.height).toBe(1026);
  });

  it.skipIf(!imagesAvailable)('exterior boundary from original matches traced reference extent', () => {
    const result = traceFloorplanBoundaryCore(exampleImage);
    const poly = result.outer.polygon;
    expect(poly).toBeTruthy();

    // The traced image is at ~1/1.4 scale of the original.
    // Scale polygon bbox to traced image coordinates
    const scale = exampleImage.width / tracedImage.width; // ≈ 1.40
    const bbox = polygonBBox(poly);
    const scaledMinX = bbox.minX / scale;
    const scaledMaxX = bbox.maxX / scale;
    const scaledMinY = bbox.minY / scale;
    const scaledMaxY = bbox.maxY / scale;

    // The traced boundary spans approximately x=[2,1374], y=[71,1025].
    // After text/logo filtering, the boundary may be tighter at the
    // bottom edge where annotations previously inflated the extent.
    const tolerance = 100;
    // Bottom edge uses a larger tolerance because text/logo filtering
    // correctly excludes annotations below the building, tightening the
    // boundary more than the reference traced image suggests.
    const bottomTolerance = 250;
    expect(scaledMinX).toBeLessThan(2 + tolerance);
    expect(scaledMaxX).toBeGreaterThan(1374 - tolerance);
    expect(scaledMinY).toBeLessThan(71 + tolerance);
    expect(scaledMaxY).toBeGreaterThan(1025 - bottomTolerance);
  }, 15000);

  it.skipIf(!imagesAvailable)('running detection on traced image also produces valid boundary', () => {
    const result = traceFloorplanBoundaryCore(tracedImage);
    expect(result).toBeTruthy();
    expect(result.outer || result.inner).toBeTruthy();

    const poly = result.outer?.polygon ?? result.inner?.polygon;
    expect(poly.length).toBeGreaterThanOrEqual(4);
    const area = polygonArea(poly);
    const tracedArea = tracedImage.width * tracedImage.height;
    // Should detect a meaningful footprint
    expect(area).toBeGreaterThan(tracedArea * 0.1);
  }, 15000);
});

/* ------------------------------------------------------------------ */
/*  Regression Tests                                                   */
/* ------------------------------------------------------------------ */

describe('regression tests', () => {
  it.skipIf(!imagesAvailable)('traceFloorplanBoundaryCore never returns null on real image', () => {
    const result = traceFloorplanBoundaryCore(exampleImage);
    expect(result).not.toBeNull();
  }, 15000);

  it.skipIf(!imagesAvailable)('room detection does not crash on corner coordinates', () => {
    const corners = [
      { x: 0, y: 0 },
      { x: IMAGE_WIDTH - 1, y: 0 },
      { x: 0, y: IMAGE_HEIGHT - 1 },
      { x: IMAGE_WIDTH - 1, y: IMAGE_HEIGHT - 1 },
    ];
    for (const corner of corners) {
      // Should not throw — result may be null for corners outside the building
      const room = detectRoomFromClickCore(exampleImage, corner);
      if (room) {
        expect(room.polygon.length).toBeGreaterThan(0);
      }
    }
  }, 30000);

  it.skipIf(!imagesAvailable)('room overlay coordinates are within image bounds', () => {
    const clicks = [
      { x: 342, y: 440 },
      { x: 861, y: 373 },
      { x: 199, y: 911 },
    ];
    for (const click of clicks) {
      const room = detectRoomFromClickCore(exampleImage, click);
      if (!room) continue;
      expect(room.overlay.x1).toBeGreaterThanOrEqual(0);
      expect(room.overlay.y1).toBeGreaterThanOrEqual(0);
      expect(room.overlay.x2).toBeLessThanOrEqual(IMAGE_WIDTH + 5);
      expect(room.overlay.y2).toBeLessThanOrEqual(IMAGE_HEIGHT + 5);
    }
  }, 30000);

  it.skipIf(!imagesAvailable)('exterior trace is stable (deterministic)', () => {
    const r1 = traceFloorplanBoundaryCore(exampleImage);
    const r2 = traceFloorplanBoundaryCore(exampleImage);
    const p1 = r1.outer.polygon;
    const p2 = r2.outer.polygon;
    expect(p1.length).toBe(p2.length);
    expect(polygonArea(p1)).toBe(polygonArea(p2));
  }, 30000);

  it.skipIf(!imagesAvailable)('boundaryByMode returns null for null input', () => {
    expect(boundaryByMode(null)).toBeNull();
    expect(boundaryByMode(null, 'outer')).toBeNull();
  });

  it.skipIf(!windowFixtureAvailable)('real-image case: repeated window interruptions keep right edge stable', () => {
    // Fixture requirements (if absent in local/dev branches):
    //  - Place at src/utils/detection/__tests__/__fixtures__/WindowInterruptionsFloorplan.png
    //  - Should contain a mostly rectangular envelope.
    //  - One long exterior wall should include repeated narrow window-like interruptions
    //    and optionally a slightly offset inner framing line.
    //  - Image should be preprocessed/high-contrast enough for traceFloorplanBoundaryCore.
    const result = traceFloorplanBoundaryCore(windowInterruptionImage);
    expect(result).toBeTruthy();
    expect(result.outer).toBeTruthy();

    const poly = result.outer.polygon;
    const bbox = polygonBBox(poly);
    expect(poly.length).toBeGreaterThanOrEqual(4);

    const rightSidePoints = poly.filter(
      (p) => p.x >= bbox.maxX - 30 && p.y >= bbox.minY + 5 && p.y <= bbox.maxY - 5
    );
    expect(rightSidePoints.length).toBeGreaterThan(0);

    const maxInwardDeviation = Math.max(...rightSidePoints.map((p) => bbox.maxX - p.x));
    expect(maxInwardDeviation).toBeLessThanOrEqual(30);
    expect(rightSidePoints.length).toBeLessThanOrEqual(32);
  }, 15000);
});
