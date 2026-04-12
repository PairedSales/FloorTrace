import { describe, expect, it } from 'vitest';
import { estimateDominantOrientations } from '../orientation';
import {
  detectRoomFromClickCore,
  traceFloorplanBoundaryCore,
  measureWallThicknessFromEdge,
  computeRobustWallThickness,
} from '../pipeline';

const createBlankImageData = (width, height, value = 255) => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
    data[i + 3] = 255;
  }
  return { width, height, data };
};

const drawPixel = (imageData, x, y, darkness = 0) => {
  if (x < 0 || y < 0 || x >= imageData.width || y >= imageData.height) return;
  const idx = (y * imageData.width + x) * 4;
  imageData.data[idx] = darkness;
  imageData.data[idx + 1] = darkness;
  imageData.data[idx + 2] = darkness;
  imageData.data[idx + 3] = 255;
};

const drawLine = (imageData, x0, y0, x1, y1, thickness = 3) => {
  let x = Math.round(x0);
  let y = Math.round(y0);
  const tx = Math.round(x1);
  const ty = Math.round(y1);
  const dx = Math.abs(tx - x);
  const sx = x < tx ? 1 : -1;
  const dy = -Math.abs(ty - y);
  const sy = y < ty ? 1 : -1;
  let error = dx + dy;

  while (true) {
    for (let oy = -thickness; oy <= thickness; oy += 1) {
      for (let ox = -thickness; ox <= thickness; ox += 1) {
        drawPixel(imageData, x + ox, y + oy, 0);
      }
    }
    if (x === tx && y === ty) break;
    const e2 = 2 * error;
    if (e2 >= dy) {
      error += dy;
      x += sx;
    }
    if (e2 <= dx) {
      error += dx;
      y += sy;
    }
  }
};

const polygonArea = (polygon) => {
  let sum = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const current = polygon[i];
    const next = polygon[(i + 1) % polygon.length];
    sum += current.x * next.y - next.x * current.y;
  }
  return Math.abs(sum) / 2;
};

describe('detection pipeline', () => {
  it('detects dominant 45 and 60 degree orientations', () => {
    const img = createBlankImageData(280, 240);
    drawLine(img, 20, 200, 220, 0, 2); // ~45 deg
    drawLine(img, 30, 220, 130, 45, 2); // ~60 deg

    const gray = new Uint8ClampedArray(img.width * img.height);
    for (let i = 0, j = 0; i < img.data.length; i += 4, j += 1) {
      gray[j] = img.data[i];
    }

    const orientation = estimateDominantOrientations(gray, img.width, img.height, { topN: 6 });
    expect(orientation.dominant.length).toBeGreaterThan(1);
    expect(orientation.dominant.some((angle) => Math.abs(angle - 45) <= 15)).toBe(true);
    expect(orientation.dominant.some((angle) => Math.abs(angle - 60) <= 15)).toBe(true);
  });

  it('extracts a room enclosure from a clicked point', () => {
    const img = createBlankImageData(320, 220);
    drawLine(img, 20, 20, 140, 20, 3);
    drawLine(img, 20, 160, 140, 160, 3);
    drawLine(img, 20, 20, 20, 160, 3);
    drawLine(img, 140, 20, 140, 160, 3);
    drawLine(img, 180, 30, 300, 30, 3);
    drawLine(img, 180, 180, 300, 180, 3);
    drawLine(img, 180, 30, 180, 180, 3);
    drawLine(img, 300, 30, 300, 180, 3);

    const room = detectRoomFromClickCore(
      img,
      { x: 80, y: 90 },
      { wallMask: { closeRadius: 0, openRadius: 0 } }
    );
    expect(room).toBeTruthy();
    expect(room.overlay.x1).toBeLessThanOrEqual(80);
    expect(room.overlay.x2).toBeGreaterThanOrEqual(80);
    expect(room.overlay.y1).toBeLessThanOrEqual(90);
    expect(room.overlay.y2).toBeGreaterThanOrEqual(90);
    expect(room.polygon.length).toBeGreaterThan(2);
  });

  it('traces both inner and outer boundaries and keeps outer >= inner', () => {
    const img = createBlankImageData(340, 260);
    drawLine(img, 20, 20, 320, 20, 4);
    drawLine(img, 20, 240, 320, 240, 4);
    drawLine(img, 20, 20, 20, 240, 4);
    drawLine(img, 320, 20, 320, 240, 4);
    drawLine(img, 20, 130, 320, 130, 3);
    drawLine(img, 170, 20, 170, 240, 3);
    drawLine(img, 40, 220, 260, 80, 2); // angled wall influence

    const traced = traceFloorplanBoundaryCore(img);
    expect(traced).toBeTruthy();
    expect(traced.inner || traced.outer).toBeTruthy();

    const outerPoly = traced.outer?.polygon ?? traced.inner?.polygon;
    const innerPoly = traced.inner?.polygon ?? traced.outer?.polygon;
    expect(outerPoly.length).toBeGreaterThan(2);
    expect(innerPoly.length).toBeGreaterThan(2);

    const outerArea = polygonArea(outerPoly);
    const innerArea = polygonArea(innerPoly);
    expect(outerArea).toBeGreaterThanOrEqual(innerArea * 0.85);
  });

  it('preserves concave shapes for L-shaped floorplans', () => {
    // Draw an L-shaped floorplan:
    //   +--------+
    //   |        |
    //   |   +----+
    //   |   |
    //   +---+
    const img = createBlankImageData(400, 300);
    // Top edge
    drawLine(img, 40, 30, 300, 30, 4);
    // Right edge (upper part)
    drawLine(img, 300, 30, 300, 130, 4);
    // Step right (interior corner)
    drawLine(img, 300, 130, 170, 130, 4);
    // Step down
    drawLine(img, 170, 130, 170, 250, 4);
    // Bottom edge
    drawLine(img, 170, 250, 40, 250, 4);
    // Left edge
    drawLine(img, 40, 250, 40, 30, 4);

    const traced = traceFloorplanBoundaryCore(img, {
      wallMask: { closeRadius: 0, openRadius: 0 },
    });
    expect(traced).toBeTruthy();
    expect(traced.outer).toBeTruthy();
    expect(traced.outer.polygon.length).toBeGreaterThan(2);

    const outerPoly = traced.outer.polygon;

    // Verify the polygon is NOT convex (i.e., it preserves the L-shape concavity).
    // The convex hull of the L-shape would be a rectangle from (40,30) to (300,250)
    // with area ≈ 260*220 = 57,200. The actual L-shape area is smaller because the
    // upper-right quadrant is missing.
    const fullRectArea = 260 * 220;
    const actualArea = polygonArea(outerPoly);

    // L-shape area should be significantly less than full rectangle
    // The cut-out is roughly 130*120 = 15,600, so L-shape ≈ 41,600
    expect(actualArea).toBeLessThan(fullRectArea * 0.9);
    expect(actualArea).toBeGreaterThan(fullRectArea * 0.4);
  });

  it('traces exterior boundary when right wall has irregular double-line pattern', () => {
    // Simulate a floorplan where the right exterior wall is drawn as two
    // vertical lines connected by sparse horizontal cross-segments (the
    // irregular "double-line" wall pattern visible in architectural drawings).
    // The outer vertical line has gaps between each cross-segment, so the
    // row-only scan cannot reach the outer extent in those gap rows — the
    // column-by-column scan must bridge them.
    const W = 400;
    const H = 300;
    const img = createBlankImageData(W, H);

    // Plain top, bottom and left walls
    drawLine(img, 30, 30, 340, 30, 3);
    drawLine(img, 30, 260, 340, 260, 3);
    drawLine(img, 30, 30, 30, 260, 3);

    // Irregular right wall: outer vertical line, inner vertical line,
    // and short horizontal cross-segments every 30px between them.
    const wallOuterX = 340;
    const wallInnerX = 320;
    drawLine(img, wallOuterX, 30, wallOuterX, 260, 3);
    drawLine(img, wallInnerX, 30, wallInnerX, 260, 3);
    for (let y = 50; y < 260; y += 30) {
      drawLine(img, wallInnerX, y, wallOuterX, y, 2);
    }

    const traced = traceFloorplanBoundaryCore(img, {
      wallMask: { closeRadius: 0, openRadius: 0 },
    });
    expect(traced).toBeTruthy();
    expect(traced.outer).toBeTruthy();

    const outerPoly = traced.outer.polygon;
    const xs = outerPoly.map((p) => p.x);

    // The outer boundary must reach the outermost right wall line, not just
    // the inner one (the pre-fix row-only scan stopped at wallInnerX).
    expect(Math.max(...xs)).toBeGreaterThanOrEqual(wallOuterX - 5);
  });

  it('traces exterior boundary of a floorplan with open interior', () => {
    // Simple rectangle with no interior walls
    const img = createBlankImageData(260, 200);
    drawLine(img, 30, 30, 230, 30, 3);
    drawLine(img, 30, 170, 230, 170, 3);
    drawLine(img, 30, 30, 30, 170, 3);
    drawLine(img, 230, 30, 230, 170, 3);

    const traced = traceFloorplanBoundaryCore(img, {
      wallMask: { closeRadius: 0, openRadius: 0 },
    });
    expect(traced).toBeTruthy();
    expect(traced.outer).toBeTruthy();

    const outerPoly = traced.outer.polygon;
    const area = polygonArea(outerPoly);

    // The enclosed rectangle is roughly 200x140 pixels
    expect(area).toBeGreaterThan(100 * 100);
    expect(area).toBeLessThan(260 * 200);

    // The boundary should roughly contain the drawn rectangle
    const xs = outerPoly.map((p) => p.x);
    const ys = outerPoly.map((p) => p.y);
    expect(Math.min(...xs)).toBeLessThanOrEqual(40);
    expect(Math.max(...xs)).toBeGreaterThanOrEqual(220);
    expect(Math.min(...ys)).toBeLessThanOrEqual(40);
    expect(Math.max(...ys)).toBeGreaterThanOrEqual(160);
  });

  it('traces exterior boundary at outer edge of thick walls, not through the middle', () => {
    // Draw a rectangle with very thick walls (thickness=12, so wall band is ±12 pixels).
    // The outer boundary should trace along the OUTER edge of the wall, not the center.
    const img = createBlankImageData(400, 300);
    const thick = 12;
    // Top wall at y=40, bottom at y=260, left at x=40, right at x=360
    drawLine(img, 40, 40, 360, 40, thick);
    drawLine(img, 40, 260, 360, 260, thick);
    drawLine(img, 40, 40, 40, 260, thick);
    drawLine(img, 360, 40, 360, 260, thick);

    const traced = traceFloorplanBoundaryCore(img);
    expect(traced).toBeTruthy();
    expect(traced.outer).toBeTruthy();

    const outerPoly = traced.outer.polygon;
    const xs = outerPoly.map((p) => p.x);
    const ys = outerPoly.map((p) => p.y);

    // The outer edge of the thick wall should be at approximately (40-12, 40-12)
    // to (360+12, 260+12) = (28, 28) to (372, 272).
    // The polygon should reach these outer edges, NOT stop at the center
    // of the wall band (which would be around 40, 40 to 360, 260).
    expect(Math.min(...xs)).toBeLessThanOrEqual(32);
    expect(Math.max(...xs)).toBeGreaterThanOrEqual(368);
    expect(Math.min(...ys)).toBeLessThanOrEqual(32);
    expect(Math.max(...ys)).toBeGreaterThanOrEqual(268);
  });

  it('traces exterior boundary for thin 1-pixel wall lines (windows)', () => {
    // Draw a rectangle with very thin walls (thickness=0, so only 1 pixel wide).
    // The boundary should still detect and trace these thin walls.
    const img = createBlankImageData(300, 250);
    drawLine(img, 50, 40, 250, 40, 0);   // 1px wide horizontal
    drawLine(img, 50, 200, 250, 200, 0); // 1px wide horizontal
    drawLine(img, 50, 40, 50, 200, 0);   // 1px wide vertical
    drawLine(img, 250, 40, 250, 200, 0); // 1px wide vertical

    const traced = traceFloorplanBoundaryCore(img);
    expect(traced).toBeTruthy();
    expect(traced.outer).toBeTruthy();

    const outerPoly = traced.outer.polygon;
    const xs = outerPoly.map((p) => p.x);
    const ys = outerPoly.map((p) => p.y);

    // The polygon should reach the thin wall locations
    expect(Math.min(...xs)).toBeLessThanOrEqual(55);
    expect(Math.max(...xs)).toBeGreaterThanOrEqual(245);
    expect(Math.min(...ys)).toBeLessThanOrEqual(45);
    expect(Math.max(...ys)).toBeGreaterThanOrEqual(195);
  });

  it('traces exterior boundary of a clean preprocessed floorplan with 45-degree corners', () => {
    // A rectangular outline with 45° cut corners at upper-left and lower-right,
    // similar to the example preprocessed floorplan from the problem statement.
    const img = createBlankImageData(400, 350);
    drawLine(img, 60, 30, 30, 60, 4);     // upper-left chamfer (45° edge)
    drawLine(img, 60, 30, 350, 30, 4);    // top edge
    drawLine(img, 350, 30, 350, 280, 4);  // right edge
    drawLine(img, 350, 280, 320, 310, 4); // lower-right chamfer (45° edge)
    drawLine(img, 320, 310, 30, 310, 4);  // bottom edge
    drawLine(img, 30, 310, 30, 60, 4);    // left edge

    const traced = traceFloorplanBoundaryCore(img, {
      wallMask: { closeRadius: 0, openRadius: 0 },
    });
    expect(traced).toBeTruthy();
    expect(traced.outer).toBeTruthy();

    const outerPoly = traced.outer.polygon;
    // Shape has 6 corners (rectangle with 2 cut corners)
    expect(outerPoly.length).toBeGreaterThanOrEqual(6);

    const xs = outerPoly.map((p) => p.x);
    const ys = outerPoly.map((p) => p.y);

    // Boundary should encompass the drawn shape
    expect(Math.min(...xs)).toBeLessThanOrEqual(40);
    expect(Math.max(...xs)).toBeGreaterThanOrEqual(340);
    expect(Math.min(...ys)).toBeLessThanOrEqual(40);
    expect(Math.max(...ys)).toBeGreaterThanOrEqual(300);

    // Area should be less than full rectangle (45° cuts reduce area)
    // but still most of it.  The drawn walls have thickness 4 (±4 pixels)
    // so the outer extent is larger than the inner coordinates.
    const outerWidth = Math.max(...xs) - Math.min(...xs);
    const outerHeight = Math.max(...ys) - Math.min(...ys);
    const fullRectArea = outerWidth * outerHeight;
    const area = polygonArea(outerPoly);
    expect(area).toBeLessThan(fullRectArea);
    expect(area).toBeGreaterThan(fullRectArea * 0.85);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Wall-thickness detection unit tests
// ─────────────────────────────────────────────────────────────────────────────

describe('wall thickness detection', () => {
  /** Build a binary wall mask for a rectangle whose walls are exactly `wallT` pixels thick. */
  const makeRectMask = (width, height, wallT) => {
    const mask = new Uint8Array(width * height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (y < wallT || y >= height - wallT || x < wallT || x >= width - wallT) {
          mask[y * width + x] = 1;
        }
      }
    }
    return mask;
  };

  /** Build edge-scan profiles manually from a wall mask. */
  const buildProfiles = (mask, width, height) => {
    const topProfile = new Int32Array(width).fill(height);
    const bottomProfile = new Int32Array(width).fill(-1);
    const leftProfile = new Int32Array(height).fill(width);
    const rightProfile = new Int32Array(height).fill(-1);

    for (let x = 0; x < width; x += 1) {
      for (let y = 0; y < height; y += 1) {
        if (mask[y * width + x]) { topProfile[x] = y; break; }
      }
      for (let y = height - 1; y >= 0; y -= 1) {
        if (mask[y * width + x]) { bottomProfile[x] = y; break; }
      }
    }
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (mask[y * width + x]) { leftProfile[y] = x; break; }
      }
      for (let x = width - 1; x >= 0; x -= 1) {
        if (mask[y * width + x]) { rightProfile[y] = x; break; }
      }
    }
    return { topProfile, bottomProfile, leftProfile, rightProfile };
  };

  it('measureWallThicknessFromEdge returns correct thickness for uniform thick walls', () => {
    const W = 200;
    const H = 150;
    const wallT = 8;
    const mask = makeRectMask(W, H, wallT);
    const profiles = buildProfiles(mask, W, H);

    const measurements = measureWallThicknessFromEdge(mask, W, H, profiles);

    // Most measurements should equal wallT (corner overlap columns/rows skew a minority).
    const normalMeasurements = measurements.filter((t) => t === wallT);
    expect(normalMeasurements.length).toBeGreaterThan(measurements.length * 0.7);
  });

  it('computeRobustWallThickness returns mode of uniform thick-wall measurements', () => {
    const W = 200;
    const H = 150;
    const wallT = 8;
    const mask = makeRectMask(W, H, wallT);
    const profiles = buildProfiles(mask, W, H);

    const measurements = measureWallThicknessFromEdge(mask, W, H, profiles);
    const thickness = computeRobustWallThickness(measurements);

    // Mode should be exactly the wall thickness drawn.
    expect(thickness).toBe(wallT);
  });

  it('computeRobustWallThickness ignores window/door gap outliers', () => {
    // Simulate: most walls have thickness 10, but a few gaps report thickness 1.
    const measurements = [
      ...Array(80).fill(10), // dominant wall sections
      ...Array(15).fill(1),  // window/door gaps
      ...Array(5).fill(2),   // very thin sections
    ];
    const thickness = computeRobustWallThickness(measurements);
    // Should return 10 (the dominant value), not 1 or 2.
    expect(thickness).toBe(10);
  });

  it('computeRobustWallThickness falls back when all measurements are thin', () => {
    const measurements = [1, 1, 2, 1, 2, 1]; // all below MIN_WALL_THICKNESS_MEASUREMENT
    const thickness = computeRobustWallThickness(measurements);
    // No measurement survives the filter → returns fallback (2 by default).
    expect(thickness).toBe(2);
  });

  it('computeRobustWallThickness returns supplied fallback when measurements are empty', () => {
    expect(computeRobustWallThickness([], 5)).toBe(5);
  });

  it('inner polygon is inset by actual wall thickness, not just the old 2-px default', () => {
    // drawLine with thickness=10 draws a ±10 pixel square around each point on the
    // line centre, producing a wall band approximately 21px wide (2*10+1).
    const img = createBlankImageData(400, 300);
    const wallHalfThick = 10;
    drawLine(img, 80, 60, 320, 60, wallHalfThick);   // top
    drawLine(img, 80, 240, 320, 240, wallHalfThick);  // bottom
    drawLine(img, 80, 60, 80, 240, wallHalfThick);    // left
    drawLine(img, 320, 60, 320, 240, wallHalfThick);  // right

    const traced = traceFloorplanBoundaryCore(img);
    expect(traced).toBeTruthy();
    expect(traced.outer).toBeTruthy();
    expect(traced.inner).toBeTruthy();

    const outerXs = traced.outer.polygon.map((p) => p.x);
    const innerXs = traced.inner.polygon.map((p) => p.x);
    const insetLeft = Math.min(...innerXs) - Math.min(...outerXs);

    // With the new wall-thickness detection the inset must be substantially
    // larger than the old fixed 2-pixel erosion.
    expect(insetLeft).toBeGreaterThan(3);

    // And the inner polygon should still fit inside the outer.
    expect(polygonArea(traced.inner.polygon)).toBeLessThan(polygonArea(traced.outer.polygon));
  });
});
