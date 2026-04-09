import { describe, expect, it } from 'vitest';
import { estimateDominantOrientations } from '../orientation';
import {
  detectRoomFromClickCore,
  traceFloorplanBoundaryCore,
  boundaryByMode,
  preprocessImage,
  cleanBinary,
  fillExterior,
  extractOuterContour,
  simplifyContour,
  postProcessContour,
  otsuThreshold,
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
        const px = x + ox;
        const py = y + oy;
        if (px < 0 || py < 0 || px >= imageData.width || py >= imageData.height) continue;
        const idx = (py * imageData.width + px) * 4;
        imageData.data[idx] = 0;
        imageData.data[idx + 1] = 0;
        imageData.data[idx + 2] = 0;
        imageData.data[idx + 3] = 255;
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

/** Draw a filled rectangle (black) on a white image. */
const drawRect = (imageData, x, y, w, h) => {
  for (let py = y; py < y + h && py < imageData.height; py += 1) {
    for (let px = x; px < x + w && px < imageData.width; px += 1) {
      if (px < 0 || py < 0) continue;
      const idx = (py * imageData.width + px) * 4;
      imageData.data[idx] = 0;
      imageData.data[idx + 1] = 0;
      imageData.data[idx + 2] = 0;
    }
  }
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

  it('traceFloorplanBoundaryCore returns null for blank white image', () => {
    const img = createBlankImageData(340, 260);
    const result = traceFloorplanBoundaryCore(img);
    expect(result).toBeNull();
  });

  it('boundaryByMode returns null for null input', () => {
    expect(boundaryByMode(null)).toBeNull();
    expect(boundaryByMode(null, 'outer')).toBeNull();
  });
});

describe('otsuThreshold', () => {
  it('returns 0 for uniform image', () => {
    const gray = new Uint8ClampedArray(100).fill(128);
    expect(otsuThreshold(gray)).toBe(0);
  });

  it('separates bimodal distribution', () => {
    const gray = new Uint8ClampedArray(200);
    for (let i = 0; i < 100; i += 1) gray[i] = 50;
    for (let i = 100; i < 200; i += 1) gray[i] = 200;
    const t = otsuThreshold(gray);
    expect(t).toBeGreaterThanOrEqual(50);
    expect(t).toBeLessThanOrEqual(200);
  });
});

describe('preprocessImage', () => {
  it('binarises dark pixels as walls', () => {
    const img = createBlankImageData(100, 100);
    // Draw a dark rectangle in the centre
    drawRect(img, 30, 30, 40, 40);
    const { binary, width, height } = preprocessImage(img);
    expect(width).toBe(100);
    expect(height).toBe(100);
    // Centre pixel should be wall (1)
    expect(binary[50 * 100 + 50]).toBe(1);
    // Corner should be background (0)
    expect(binary[0]).toBe(0);
  });
});

describe('cleanBinary', () => {
  it('removes small noise components', () => {
    const w = 100;
    const h = 100;
    const mask = new Uint8Array(w * h);
    // Large region
    for (let y = 20; y < 80; y += 1) {
      for (let x = 20; x < 80; x += 1) mask[y * w + x] = 1;
    }
    // Tiny noise (2×2)
    mask[5 * w + 5] = 1;
    mask[5 * w + 6] = 1;
    mask[6 * w + 5] = 1;
    mask[6 * w + 6] = 1;

    const cleaned = cleanBinary(mask, w, h, { minComponentArea: 10, closeRadius: 0, openRadius: 0 });
    // Noise should be removed
    expect(cleaned[5 * w + 5]).toBe(0);
    // Large region preserved
    expect(cleaned[50 * w + 50]).toBe(1);
  });
});

describe('fillExterior', () => {
  it('fills interior holes', () => {
    const w = 50;
    const h = 50;
    const mask = new Uint8Array(w * h);
    // Draw a hollow square (wall ring)
    for (let x = 10; x <= 40; x += 1) { mask[10 * w + x] = 1; mask[40 * w + x] = 1; }
    for (let y = 10; y <= 40; y += 1) { mask[y * w + 10] = 1; mask[y * w + 40] = 1; }

    const filled = fillExterior(mask, w, h);
    // Interior should be filled
    expect(filled[25 * w + 25]).toBe(1);
    // Exterior should not be filled
    expect(filled[0]).toBe(0);
    expect(filled[5 * w + 5]).toBe(0);
  });
});

describe('extractOuterContour', () => {
  it('returns boundary of a filled region', () => {
    const w = 60;
    const h = 60;
    const mask = new Uint8Array(w * h);
    for (let y = 15; y < 45; y += 1) {
      for (let x = 15; x < 45; x += 1) mask[y * w + x] = 1;
    }
    const contour = extractOuterContour(mask, w, h);
    expect(contour).not.toBeNull();
    expect(contour.length).toBeGreaterThanOrEqual(4);
  });

  it('returns null for empty mask', () => {
    const mask = new Uint8Array(100);
    expect(extractOuterContour(mask, 10, 10)).toBeNull();
  });
});

describe('simplifyContour', () => {
  it('reduces vertex count for a detailed contour', () => {
    // Create a square boundary with many redundant points along edges
    const points = [];
    for (let x = 0; x <= 100; x += 1) points.push({ x, y: 0 });
    for (let y = 1; y <= 100; y += 1) points.push({ x: 100, y });
    for (let x = 99; x >= 0; x -= 1) points.push({ x, y: 100 });
    for (let y = 99; y >= 1; y -= 1) points.push({ x: 0, y });

    const simplified = simplifyContour(points);
    expect(simplified.length).toBeLessThan(points.length);
    expect(simplified.length).toBeGreaterThanOrEqual(4);
  });
});

describe('postProcessContour', () => {
  it('ensures clockwise winding', () => {
    // CCW square in screen coordinates
    const ccw = [
      { x: 0, y: 0 },
      { x: 0, y: 100 },
      { x: 100, y: 100 },
      { x: 100, y: 0 },
    ];
    const result = postProcessContour(ccw);
    // Shoelace area should be positive (CW in screen coords)
    let area = 0;
    for (let i = 0; i < result.length; i += 1) {
      const j = (i + 1) % result.length;
      area += result[i].x * result[j].y - result[j].x * result[i].y;
    }
    expect(area).toBeGreaterThan(0);
  });

  it('removes nearly collinear points', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 50, y: 0.5 }, // nearly collinear
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    const result = postProcessContour(points);
    expect(result.length).toBeLessThan(points.length);
  });
});

describe('traceFloorplanBoundaryCore – synthetic rectangle', () => {
  it('detects outer boundary of a rectangle floor plan', () => {
    const img = createBlankImageData(200, 200);
    // Draw rectangle walls
    drawLine(img, 40, 40, 160, 40, 3);
    drawLine(img, 160, 40, 160, 160, 3);
    drawLine(img, 160, 160, 40, 160, 3);
    drawLine(img, 40, 160, 40, 40, 3);

    const result = traceFloorplanBoundaryCore(img);
    expect(result).not.toBeNull();
    expect(result.outer).toBeDefined();
    expect(result.outer.length).toBeGreaterThanOrEqual(4);
    expect(result.debug.areaRatio).toBeGreaterThan(0.05);
    expect(result.debug.vertices).toBeGreaterThanOrEqual(4);
  });

  it('detects L-shaped floorplan', () => {
    const img = createBlankImageData(300, 300);
    // L shape walls
    drawLine(img, 50, 50, 200, 50, 3);
    drawLine(img, 200, 50, 200, 150, 3);
    drawLine(img, 200, 150, 150, 150, 3);
    drawLine(img, 150, 150, 150, 250, 3);
    drawLine(img, 150, 250, 50, 250, 3);
    drawLine(img, 50, 250, 50, 50, 3);

    const result = traceFloorplanBoundaryCore(img);
    expect(result).not.toBeNull();
    expect(result.outer.length).toBeGreaterThanOrEqual(5);
    expect(result.debug.areaRatio).toBeGreaterThan(0.05);
  });

  it('returns null for invalid input', () => {
    expect(traceFloorplanBoundaryCore(null)).toBeNull();
    expect(traceFloorplanBoundaryCore({})).toBeNull();
    expect(traceFloorplanBoundaryCore({ data: null, width: 0, height: 0 })).toBeNull();
  });
});
