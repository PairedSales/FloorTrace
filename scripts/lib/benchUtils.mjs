// Shared measurement helpers for the Node harnesses. Previously duplicated
// verbatim between scripts/detectionBenchmark.mjs and the image tests.
import fs from 'fs';
import { PNG } from 'pngjs';

export const loadPng = (filePath) => {
  const png = PNG.sync.read(fs.readFileSync(filePath));
  return { width: png.width, height: png.height, data: new Uint8ClampedArray(png.data) };
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
