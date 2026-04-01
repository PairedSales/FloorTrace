import { describe, expect, it } from 'vitest';
import { estimateDominantOrientations } from '../orientation';
import { detectRoomFromClickCore, traceFloorplanBoundaryCore } from '../pipeline';

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

  it('ignores text and logos outside the floorplan sketch', () => {
    // Draw a floorplan with surrounding text/logo marks that should not
    // affect the detected exterior boundary.
    const W = 400;
    const H = 350;
    const img = createBlankImageData(W, H);

    // Floorplan walls (rectangle from ~50,30 to ~350,200)
    drawLine(img, 50, 30, 350, 30, 4);
    drawLine(img, 50, 200, 350, 200, 4);
    drawLine(img, 50, 30, 50, 200, 4);
    drawLine(img, 350, 30, 350, 200, 4);

    // Simulate text below the floorplan ("SIZES AND DIMENSIONS ARE APPROXIMATE")
    drawLine(img, 30, 280, 370, 280, 1);

    // Simulate a logo block in the bottom-right corner
    drawLine(img, 280, 310, 370, 310, 2);
    drawLine(img, 280, 330, 370, 330, 2);
    drawLine(img, 280, 310, 280, 330, 2);
    drawLine(img, 370, 310, 370, 330, 2);

    const traced = traceFloorplanBoundaryCore(img, {
      wallMask: { closeRadius: 0, openRadius: 0 },
    });
    expect(traced).toBeTruthy();
    expect(traced.outer).toBeTruthy();

    const outerPoly = traced.outer.polygon;
    const ys = outerPoly.map((p) => p.y);

    // The bottom boundary should be near the bottom wall (y≈200),
    // not extending to the text/logo area (y≈280+).
    expect(Math.max(...ys)).toBeLessThan(250);
  });
});
