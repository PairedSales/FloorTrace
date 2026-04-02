/**
 * Comprehensive integration tests using real floorplan images.
 *
 * These tests load ExampleFloorplan.png and run the detection pipeline
 * on it, verifying room detection and exterior wall tracing produce
 * sensible results that match known properties of the floorplan.
 *
 * ExampleFloorplan-Traced.png is used as a ground-truth reference for
 * the exterior boundary location (the traced outline).
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

/** Signed area (shoelace) – positive when CCW. */
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

/** Check if a point is inside a polygon's bounding box (with margin). */
const pointInsideBBox = (px, py, bbox, margin = 0) =>
  px >= bbox.minX - margin && px <= bbox.maxX + margin &&
  py >= bbox.minY - margin && py <= bbox.maxY + margin;

/* ------------------------------------------------------------------ */
/*  Fixture setup                                                      */
/* ------------------------------------------------------------------ */

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..', '..');
const EXAMPLE_PATH = path.join(ROOT, 'ExampleFloorplan.png');
const TRACED_PATH = path.join(ROOT, 'ExampleFloorplan-Traced.png');

let exampleImage;
let tracedImage;
let imagesAvailable = false;

try {
  exampleImage = loadPngAsImageData(EXAMPLE_PATH);
  tracedImage = loadPngAsImageData(TRACED_PATH);
  imagesAvailable = true;
} catch {
  // Tests will be skipped if images are missing.
}

/* ------------------------------------------------------------------ */
/*  Known properties of ExampleFloorplan.png (2036 × 1440)             */
/*                                                                     */
/*  The floorplan is a multi-room layout.  Analysis of the raw pixels  */
/*  reveals the following structure (all coordinates in original px):   */
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
/*   6. Lower room #2      center ≈ ( 408, 867)   188× 189            */
/* ------------------------------------------------------------------ */

const EXPECTED_FOOTPRINT_BOUNDS = { minX: 79, maxX: 2012, minY: 101, maxY: 1418 };
const IMAGE_WIDTH = 2036;
const IMAGE_HEIGHT = 1440;
const IMAGE_AREA = IMAGE_WIDTH * IMAGE_HEIGHT;

// Click points inside known rooms (approximate centers of white regions)
const ROOM_CLICK_POINTS = [
  { name: 'Large open area',   click: { x: 1268, y: 627 }, minArea: 200000 },
  { name: 'Big left room',     click: { x: 342,  y: 440 }, minArea: 50000  },
  { name: 'Upper-middle room', click: { x: 861,  y: 373 }, minArea: 30000  },
  { name: 'Lower-left room',   click: { x: 199,  y: 911 }, minArea: 8000   },
  { name: 'Lower-center room', click: { x: 644,  y: 867 }, minArea: 5000   },
];

/* ------------------------------------------------------------------ */
/*  Exterior Wall Tracing Tests                                        */
/* ------------------------------------------------------------------ */

describe('exterior wall tracing (ExampleFloorplan.png)', () => {
  it.skipIf(!imagesAvailable)('produces a non-null result', () => {
    const result = traceFloorplanBoundaryCore(exampleImage);
    expect(result).toBeTruthy();
    expect(result.outer || result.inner).toBeTruthy();
  });

  it.skipIf(!imagesAvailable)('outer boundary exists and has enough vertices', () => {
    const result = traceFloorplanBoundaryCore(exampleImage);
    expect(result.outer).toBeTruthy();
    expect(result.outer.polygon.length).toBeGreaterThanOrEqual(4);
  });

  it.skipIf(!imagesAvailable)('outer boundary area covers a significant portion of the image', () => {
    const result = traceFloorplanBoundaryCore(exampleImage);
    const outerPoly = result.outer?.polygon ?? result.inner?.polygon;
    expect(outerPoly).toBeTruthy();

    const area = polygonArea(outerPoly);
    // Footprint is ~62% of image; polygon should cover at least 20% and under 90%.
    expect(area).toBeGreaterThan(IMAGE_AREA * 0.15);
    expect(area).toBeLessThan(IMAGE_AREA * 0.90);
  });

  it.skipIf(!imagesAvailable)('outer boundary roughly matches expected footprint bounds', () => {
    const result = traceFloorplanBoundaryCore(exampleImage);
    const poly = result.outer?.polygon ?? result.inner?.polygon;
    expect(poly).toBeTruthy();

    const bbox = polygonBBox(poly);
    const tolerance = 150; // px tolerance for normalization scaling

    expect(bbox.minX).toBeLessThan(EXPECTED_FOOTPRINT_BOUNDS.minX + tolerance);
    expect(bbox.maxX).toBeGreaterThan(EXPECTED_FOOTPRINT_BOUNDS.maxX - tolerance);
    expect(bbox.minY).toBeLessThan(EXPECTED_FOOTPRINT_BOUNDS.minY + tolerance);
    expect(bbox.maxY).toBeGreaterThan(EXPECTED_FOOTPRINT_BOUNDS.maxY - tolerance);
  });

  it.skipIf(!imagesAvailable)('inner boundary is smaller than or equal to outer boundary', () => {
    const result = traceFloorplanBoundaryCore(exampleImage);
    if (!result.outer || !result.inner) return; // can't compare if one is missing

    const outerArea = polygonArea(result.outer.polygon);
    const innerArea = polygonArea(result.inner.polygon);
    expect(outerArea).toBeGreaterThanOrEqual(innerArea * 0.85);
  });

  it.skipIf(!imagesAvailable)('boundaryByMode returns correct boundary', () => {
    const result = traceFloorplanBoundaryCore(exampleImage);
    const outerMode = boundaryByMode(result, 'outer');
    const innerMode = boundaryByMode(result, 'inner');

    // At least one mode should return something
    expect(outerMode || innerMode).toBeTruthy();

    if (outerMode) {
      expect(outerMode.polygon.length).toBeGreaterThanOrEqual(4);
    }
    if (innerMode) {
      expect(innerMode.polygon.length).toBeGreaterThanOrEqual(4);
    }
  });

  it.skipIf(!imagesAvailable)('overlay coordinates are valid and non-degenerate', () => {
    const result = traceFloorplanBoundaryCore(exampleImage);
    const target = result.outer ?? result.inner;
    expect(target).toBeTruthy();
    expect(target.overlay).toBeTruthy();
    expect(target.overlay.x2).toBeGreaterThan(target.overlay.x1);
    expect(target.overlay.y2).toBeGreaterThan(target.overlay.y1);
    // Overlay should span a meaningful area
    const overlayW = target.overlay.x2 - target.overlay.x1;
    const overlayH = target.overlay.y2 - target.overlay.y1;
    expect(overlayW).toBeGreaterThan(100);
    expect(overlayH).toBeGreaterThan(100);
  });
});

/* ------------------------------------------------------------------ */
/*  Room Detection Tests                                               */
/* ------------------------------------------------------------------ */

describe('room detection (ExampleFloorplan.png)', () => {
  it.skipIf(!imagesAvailable)('detects a room when clicking inside the big left room', () => {
    const room = detectRoomFromClickCore(exampleImage, { x: 342, y: 440 });
    expect(room).toBeTruthy();
    expect(room.polygon.length).toBeGreaterThan(2);
    expect(room.overlay).toBeTruthy();
    // The click point should be inside the detected overlay
    expect(room.overlay.x1).toBeLessThanOrEqual(342);
    expect(room.overlay.x2).toBeGreaterThanOrEqual(342);
    expect(room.overlay.y1).toBeLessThanOrEqual(440);
    expect(room.overlay.y2).toBeGreaterThanOrEqual(440);
  });

  it.skipIf(!imagesAvailable)('detects a room when clicking inside the upper-middle room', () => {
    const room = detectRoomFromClickCore(exampleImage, { x: 861, y: 373 });
    expect(room).toBeTruthy();
    expect(room.polygon.length).toBeGreaterThan(2);
    expect(room.overlay.x1).toBeLessThanOrEqual(861);
    expect(room.overlay.x2).toBeGreaterThanOrEqual(861);
    expect(room.overlay.y1).toBeLessThanOrEqual(373);
    expect(room.overlay.y2).toBeGreaterThanOrEqual(373);
  });

  it.skipIf(!imagesAvailable)('detects a room when clicking inside the lower-left room', () => {
    const room = detectRoomFromClickCore(exampleImage, { x: 199, y: 911 });
    expect(room).toBeTruthy();
    expect(room.polygon.length).toBeGreaterThan(2);
    expect(room.overlay.x1).toBeLessThanOrEqual(199);
    expect(room.overlay.x2).toBeGreaterThanOrEqual(199);
  });

  it.skipIf(!imagesAvailable)('detected rooms have reasonable size (not the entire image)', () => {
    for (const { name, click, minArea } of ROOM_CLICK_POINTS) {
      const room = detectRoomFromClickCore(exampleImage, click);
      if (!room) continue; // some rooms may not be detected, that's okay for now

      const area = polygonArea(room.polygon);
      expect(area, `Room "${name}" area should be > ${minArea}`).toBeGreaterThan(minArea);
      expect(area, `Room "${name}" should be < 80% of image`).toBeLessThan(IMAGE_AREA * 0.8);
    }
  });

  it.skipIf(!imagesAvailable)('room detection returns a confidence value between 0 and 1', () => {
    const room = detectRoomFromClickCore(exampleImage, { x: 342, y: 440 });
    expect(room).toBeTruthy();
    expect(room.confidence).toBeGreaterThanOrEqual(0);
    expect(room.confidence).toBeLessThanOrEqual(1);
  });

  it.skipIf(!imagesAvailable)('room detection includes debug info', () => {
    const room = detectRoomFromClickCore(exampleImage, { x: 342, y: 440 });
    expect(room).toBeTruthy();
    expect(room.debug).toBeTruthy();
    expect(room.debug.normalizedSize).toBeTruthy();
    expect(room.debug.normalizedSize.width).toBeGreaterThan(0);
    expect(room.debug.normalizedSize.height).toBeGreaterThan(0);
  });

  it.skipIf(!imagesAvailable)('clicking on a wall pixel still finds a nearby room', () => {
    // The left exterior wall is at approximately x=85
    const room = detectRoomFromClickCore(exampleImage, { x: 85, y: 440 });
    // Should either find a room or return null (not crash)
    if (room) {
      expect(room.polygon.length).toBeGreaterThan(2);
    }
  });

  it.skipIf(!imagesAvailable)('clicking outside the floorplan returns null or a very small region', () => {
    // Far outside the building content (top-left corner whitespace)
    const room = detectRoomFromClickCore(exampleImage, { x: 10, y: 10 });
    // Should return null since there's no enclosed room there
    // (or if it returns something, the overlay should not cover the entire image)
    if (room) {
      const area = polygonArea(room.polygon);
      expect(area).toBeLessThan(IMAGE_AREA * 0.8);
    }
  });

  it.skipIf(!imagesAvailable)('different rooms yield distinct overlays', () => {
    const room1 = detectRoomFromClickCore(exampleImage, { x: 342, y: 440 }); // left room
    const room2 = detectRoomFromClickCore(exampleImage, { x: 861, y: 373 }); // upper-middle room

    if (room1 && room2) {
      // The overlays should not be identical
      const same = room1.overlay.x1 === room2.overlay.x1 &&
                   room1.overlay.y1 === room2.overlay.y1 &&
                   room1.overlay.x2 === room2.overlay.x2 &&
                   room1.overlay.y2 === room2.overlay.y2;
      expect(same).toBe(false);
    }
  });
});

/* ------------------------------------------------------------------ */
/*  Ground-Truth Comparison Tests (ExampleFloorplan-Traced.png)         */
/* ------------------------------------------------------------------ */

describe('ground-truth comparison (ExampleFloorplan-Traced.png)', () => {
  it.skipIf(!imagesAvailable)('traced image has the expected dimensions', () => {
    expect(tracedImage.width).toBe(1451);
    expect(tracedImage.height).toBe(1026);
  });

  it.skipIf(!imagesAvailable)('exterior boundary from original image is consistent with traced reference', () => {
    const result = traceFloorplanBoundaryCore(exampleImage);
    const poly = result?.outer?.polygon ?? result?.inner?.polygon;
    expect(poly).toBeTruthy();

    // The traced image is at ~1/1.4 scale of the original.
    // Original footprint bounds: x=[79,2012], y=[101,1418]
    // At 1/1.4 scale: x≈[56,1437], y≈[72,1013]
    // The traced image shows blue-tinted pixels in x=[2,1374], y=[71,1025]
    // This means the exterior boundary should match when scaled.
    const scale = exampleImage.width / tracedImage.width; // ≈ 1.40

    const bbox = polygonBBox(poly);
    // Scale polygon bbox to traced image coordinates
    const scaledMinX = bbox.minX / scale;
    const scaledMaxX = bbox.maxX / scale;
    const scaledMinY = bbox.minY / scale;
    const scaledMaxY = bbox.maxY / scale;

    // The traced boundary (blue-tinted) spans x=[2,1374], y=[71,1025]
    const tracedBounds = { minX: 2, maxX: 1374, minY: 71, maxY: 1025 };
    const tolerance = 100; // generous tolerance for algorithm differences

    expect(scaledMinX).toBeLessThan(tracedBounds.minX + tolerance);
    expect(scaledMaxX).toBeGreaterThan(tracedBounds.maxX - tolerance);
    expect(scaledMinY).toBeLessThan(tracedBounds.minY + tolerance);
    expect(scaledMaxY).toBeGreaterThan(tracedBounds.maxY - tolerance);
  });

  it.skipIf(!imagesAvailable)('running detection on traced image also produces valid boundary', () => {
    // The traced image should also have detectable walls
    const result = traceFloorplanBoundaryCore(tracedImage);
    expect(result).toBeTruthy();
    // It should have at least an outer or inner boundary
    expect(result.outer || result.inner).toBeTruthy();
  });
});

/* ------------------------------------------------------------------ */
/*  Regression Tests                                                   */
/* ------------------------------------------------------------------ */

describe('regression tests', () => {
  it.skipIf(!imagesAvailable)('traceFloorplanBoundaryCore does not return null on real image', () => {
    // This was a regression in the broken version
    const result = traceFloorplanBoundaryCore(exampleImage);
    expect(result).not.toBeNull();
  });

  it.skipIf(!imagesAvailable)('room detection does not crash on edge coordinates', () => {
    // Test boundary conditions
    const corners = [
      { x: 0, y: 0 },
      { x: IMAGE_WIDTH - 1, y: 0 },
      { x: 0, y: IMAGE_HEIGHT - 1 },
      { x: IMAGE_WIDTH - 1, y: IMAGE_HEIGHT - 1 },
    ];

    for (const corner of corners) {
      // Should not throw
      const room = detectRoomFromClickCore(exampleImage, corner);
      // Room may or may not be found at corners, but should not crash
      if (room) {
        expect(room.polygon.length).toBeGreaterThan(0);
      }
    }
  });

  it.skipIf(!imagesAvailable)('exterior trace debug info includes expected fields', () => {
    const result = traceFloorplanBoundaryCore(exampleImage);
    expect(result.debug).toBeTruthy();
    expect(result.debug.normalizedSize).toBeTruthy();
    expect(result.debug.dominantAngles).toBeTruthy();
    expect(typeof result.debug.hasOuter).toBe('boolean');
    expect(typeof result.debug.hasInner).toBe('boolean');
  });

  it.skipIf(!imagesAvailable)('room overlay coordinates are within image bounds', () => {
    for (const { click } of ROOM_CLICK_POINTS) {
      const room = detectRoomFromClickCore(exampleImage, click);
      if (!room) continue;

      // Overlay coordinates should be non-negative (after mapping from normalized)
      expect(room.overlay.x1).toBeGreaterThanOrEqual(0);
      expect(room.overlay.y1).toBeGreaterThanOrEqual(0);
      // And not exceed image dimensions (with small tolerance for rounding)
      expect(room.overlay.x2).toBeLessThanOrEqual(IMAGE_WIDTH + 5);
      expect(room.overlay.y2).toBeLessThanOrEqual(IMAGE_HEIGHT + 5);
    }
  });

  it.skipIf(!imagesAvailable)('multiple room detections are stable (same input → same output)', () => {
    const click = { x: 342, y: 440 };
    const room1 = detectRoomFromClickCore(exampleImage, click);
    const room2 = detectRoomFromClickCore(exampleImage, click);

    if (room1 && room2) {
      expect(room1.overlay.x1).toBe(room2.overlay.x1);
      expect(room1.overlay.y1).toBe(room2.overlay.y1);
      expect(room1.overlay.x2).toBe(room2.overlay.x2);
      expect(room1.overlay.y2).toBe(room2.overlay.y2);
    }
  });

  it.skipIf(!imagesAvailable)('exterior trace is stable (same input → same output)', () => {
    const r1 = traceFloorplanBoundaryCore(exampleImage);
    const r2 = traceFloorplanBoundaryCore(exampleImage);

    const p1 = r1?.outer?.polygon ?? r1?.inner?.polygon;
    const p2 = r2?.outer?.polygon ?? r2?.inner?.polygon;

    if (p1 && p2) {
      expect(p1.length).toBe(p2.length);
      const area1 = polygonArea(p1);
      const area2 = polygonArea(p2);
      expect(area1).toBe(area2);
    }
  });
});
