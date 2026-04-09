import { describe, expect, it } from 'vitest';
import { estimateDominantOrientations } from '../orientation';
import { detectRoomFromClickCore, traceFloorplanBoundaryCore, boundaryByMode } from '../pipeline';

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

  it('detectRoomFromClickCore returns null (algorithm removed)', () => {
    const img = createBlankImageData(320, 220);
    const result = detectRoomFromClickCore(img, { x: 80, y: 90 });
    expect(result).toBeNull();
  });

  it('traceFloorplanBoundaryCore returns null (algorithm removed)', () => {
    const img = createBlankImageData(340, 260);
    const result = traceFloorplanBoundaryCore(img);
    expect(result).toBeNull();
  });

  it('boundaryByMode returns null for null input', () => {
    expect(boundaryByMode(null)).toBeNull();
    expect(boundaryByMode(null, 'outer')).toBeNull();
  });
});
