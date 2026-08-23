// Shared measurement helpers for the Node harnesses. Previously duplicated
// verbatim between scripts/detectionBenchmark.mjs and the image tests.
import fs from 'fs';
import { PNG } from 'pngjs';

// `readPng` is separate because drawBoundary.mjs paints into the decoded PNG
// and writes it back out, so it needs the pngjs object and not just the pixels.
export const readPng = (filePath) => PNG.sync.read(fs.readFileSync(filePath));

export const imageDataOf = (png) => ({
  width: png.width, height: png.height, data: new Uint8ClampedArray(png.data),
});

export const loadPng = (filePath) => imageDataOf(readPng(filePath));

// The pipeline hands `env.toOcrInput` a gray `{data, width, height}`; pngjs
// wants w*h*4 RGBA, so the expansion the browser encoder no longer needs
// happens here instead.
export const toOcrInput = (gray) => {
  const { width, height, data } = gray;
  const png = new PNG({ width, height });
  const rgba = Buffer.allocUnsafe(width * height * 4);
  for (let i = 0, j = 0; i < data.length; i += 1, j += 4) {
    rgba[j] = data[i];
    rgba[j + 1] = data[i];
    rgba[j + 2] = data[i];
    rgba[j + 3] = 255;
  }
  png.data = rgba;
  return PNG.sync.write(png);
};

export const bboxOf = (overlay) => [overlay.x1, overlay.y1, overlay.x2, overlay.y2];

export const bboxIou = (a, b) => {
  const ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  const iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const inter = ix * iy;
  const areaA = (a[2] - a[0]) * (a[3] - a[1]);
  const areaB = (b[2] - b[0]) * (b[3] - b[1]);
  return inter / (areaA + areaB - inter);
};

export { polygonIou } from '../../src/utils/detection/__tests__/synthetic.js';

export const pct = (x) => `${(x * 100).toFixed(1)}%`;
