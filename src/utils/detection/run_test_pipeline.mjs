/**
 * Standalone test-pipeline runner.
 *
 * Usage:  node --experimental-vm-modules src/utils/detection/run_test_pipeline.mjs [image]
 *
 * If no image path is given, defaults to ExampleFloorplan.png at the
 * repository root.  Debug images are written to ./test-output/.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// ---- inline pipeline imports (Node cannot resolve Vite aliases) ----

import { toGrayscale, boxBlurGray } from './preprocess.js';
import { closeMask, openMask } from './wallMask.js';
import { labelConnectedComponents, mooreBoundaryTrace, simplifyRdp } from './vectorize.js';

// We dynamically import pngjs so this file stays a pure ESM script.
const { PNG } = await import('pngjs');

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..');
const OUTPUT_DIR = resolve(REPO_ROOT, 'test-output');

/* ------------------------------------------------------------------ */
/*  Inline pipeline (mirrors pipeline.js to avoid extension issues)    */
/* ------------------------------------------------------------------ */

const otsuThreshold = (gray) => {
  const histogram = new Array(256).fill(0);
  const total = gray.length;
  for (let i = 0; i < total; i += 1) histogram[gray[i]] += 1;
  let sum = 0;
  for (let i = 0; i < 256; i += 1) sum += i * histogram[i];
  let sumB = 0, wB = 0, maxVariance = 0, threshold = 0;
  for (let t = 0; t < 256; t += 1) {
    wB += histogram[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * histogram[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > maxVariance) { maxVariance = v; threshold = t; }
  }
  return threshold;
};

const preprocessImage = (imageData) => {
  const { width, height, data } = imageData;
  const gray = toGrayscale(data, width, height);
  const blurred = boxBlurGray(gray, width, height, 1);
  const t = otsuThreshold(blurred);
  const binary = new Uint8Array(width * height);
  for (let i = 0; i < binary.length; i += 1) binary[i] = blurred[i] <= t ? 1 : 0;
  return { gray, binary, threshold: t, width, height };
};

const removeSmallComponents = (mask, w, h, minArea) => {
  const { labels, components } = labelConnectedComponents(mask, w, h, 1);
  const cleaned = new Uint8Array(w * h);
  for (const comp of components) {
    if (comp.size >= minArea) {
      for (let i = 0; i < labels.length; i += 1) if (labels[i] === comp.id) cleaned[i] = 1;
    }
  }
  return cleaned;
};

const cleanBinary = (binary, w, h) => {
  let c = closeMask(binary, w, h, 3);
  c = openMask(c, w, h, 2);
  return removeSmallComponents(c, w, h, Math.max(100, Math.round(w * h * 0.001)));
};

const fillExterior = (mask, w, h) => {
  const visited = new Uint8Array(w * h);
  const queue = [];
  for (let x = 0; x < w; x += 1) {
    if (!mask[x] && !visited[x]) { visited[x] = 1; queue.push(x); }
    const b = (h - 1) * w + x;
    if (!mask[b] && !visited[b]) { visited[b] = 1; queue.push(b); }
  }
  for (let y = 1; y < h - 1; y += 1) {
    const l = y * w;
    if (!mask[l] && !visited[l]) { visited[l] = 1; queue.push(l); }
    const r = y * w + w - 1;
    if (!mask[r] && !visited[r]) { visited[r] = 1; queue.push(r); }
  }
  for (let q = 0; q < queue.length; q += 1) {
    const idx = queue[q];
    const x = idx % w;
    const y = (idx - x) / w;
    if (x > 0)      { const n = idx - 1; if (!visited[n] && !mask[n]) { visited[n] = 1; queue.push(n); } }
    if (x < w - 1)  { const n = idx + 1; if (!visited[n] && !mask[n]) { visited[n] = 1; queue.push(n); } }
    if (y > 0)      { const n = idx - w; if (!visited[n] && !mask[n]) { visited[n] = 1; queue.push(n); } }
    if (y < h - 1)  { const n = idx + w; if (!visited[n] && !mask[n]) { visited[n] = 1; queue.push(n); } }
  }
  const filled = new Uint8Array(w * h);
  for (let i = 0; i < filled.length; i += 1) filled[i] = visited[i] ? 0 : 1;
  return filled;
};

const computePerimeter = (pts) => {
  let p = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const n = pts[(i + 1) % pts.length];
    const dx = n.x - pts[i].x, dy = n.y - pts[i].y;
    p += Math.sqrt(dx * dx + dy * dy);
  }
  return p;
};

const signedArea = (pts) => {
  let a = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const j = (i + 1) % pts.length;
    a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return a / 2;
};

/* ------------------------------------------------------------------ */
/*  Drawing helpers                                                    */
/* ------------------------------------------------------------------ */

const drawLineOnPng = (png, x0, y0, x1, y1, color, thickness = 2) => {
  let x = Math.round(x0), y = Math.round(y0);
  const tx = Math.round(x1), ty = Math.round(y1);
  const dx = Math.abs(tx - x), sx = x < tx ? 1 : -1;
  const dy = -Math.abs(ty - y), sy = y < ty ? 1 : -1;
  let err = dx + dy;
  const set = (px, py) => {
    if (px < 0 || py < 0 || px >= png.width || py >= png.height) return;
    const i = (py * png.width + px) * 4;
    png.data[i] = color[0]; png.data[i + 1] = color[1]; png.data[i + 2] = color[2]; png.data[i + 3] = 255;
  };
  while (true) {
    for (let oy = -thickness; oy <= thickness; oy += 1)
      for (let ox = -thickness; ox <= thickness; ox += 1)
        set(x + ox, y + oy);
    if (x === tx && y === ty) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
};

const drawCircleOnPng = (png, cx, cy, r, color) => {
  for (let dy = -r; dy <= r; dy += 1)
    for (let dx = -r; dx <= r; dx += 1) {
      if (dx * dx + dy * dy > r * r) continue;
      const px = cx + dx, py = cy + dy;
      if (px < 0 || py < 0 || px >= png.width || py >= png.height) continue;
      const i = (py * png.width + px) * 4;
      png.data[i] = color[0]; png.data[i + 1] = color[1]; png.data[i + 2] = color[2]; png.data[i + 3] = 255;
    }
};

const saveMaskPng = (mask, w, h, path) => {
  const png = new PNG({ width: w, height: h });
  for (let i = 0; i < w * h; i += 1) {
    const v = mask[i] ? 255 : 0;
    png.data[i * 4] = v; png.data[i * 4 + 1] = v; png.data[i * 4 + 2] = v; png.data[i * 4 + 3] = 255;
  }
  writeFileSync(path, PNG.sync.write(png));
};

/* ------------------------------------------------------------------ */
/*  run_test_pipeline                                                  */
/* ------------------------------------------------------------------ */

export function runTestPipeline(imagePath) {
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const fullPath = resolve(REPO_ROOT, imagePath);
  console.log(`Loading image: ${fullPath}`);
  const buffer = readFileSync(fullPath);
  const pngIn = PNG.sync.read(buffer);
  const imageData = { width: pngIn.width, height: pngIn.height, data: new Uint8ClampedArray(pngIn.data) };
  console.log(`Image size: ${imageData.width}×${imageData.height}`);

  // 1 – Preprocess
  const { binary } = preprocessImage(imageData);
  saveMaskPng(binary, imageData.width, imageData.height, resolve(OUTPUT_DIR, 'output_binary.png'));
  console.log('  ✓ output_binary.png');

  // 2 – Clean
  const cleaned = cleanBinary(binary, imageData.width, imageData.height);
  saveMaskPng(cleaned, imageData.width, imageData.height, resolve(OUTPUT_DIR, 'output_clean.png'));
  console.log('  ✓ output_clean.png');

  // 3 – Fill exterior
  const filled = fillExterior(cleaned, imageData.width, imageData.height);
  saveMaskPng(filled, imageData.width, imageData.height, resolve(OUTPUT_DIR, 'output_filled.png'));

  // 4 – Extract contour
  const { labels, components } = labelConnectedComponents(filled, imageData.width, imageData.height, 1);
  if (components.length === 0) { console.error('FAILED: no components found'); return null; }
  const largest = components.reduce((a, b) => (a.size > b.size ? a : b));
  const boundary = mooreBoundaryTrace(labels, imageData.width, imageData.height, largest.id);
  if (boundary.length < 3) { console.error('FAILED: boundary too short'); return null; }

  // 5 – Simplify
  const perimeter = computePerimeter(boundary);
  const epsilon = perimeter * 0.015;
  const closed = boundary.concat(boundary[0]);
  let polygon = simplifyRdp(closed, epsilon).slice(0, -1);
  if (polygon.length < 3) polygon = boundary;

  // 6 – Ensure clockwise
  if (signedArea(polygon) < 0) polygon.reverse();

  // Save contour overlay
  const pngOut = new PNG({ width: imageData.width, height: imageData.height });
  for (let i = 0; i < imageData.data.length; i += 1) pngOut.data[i] = imageData.data[i];
  for (let i = 0; i < polygon.length; i += 1) {
    const p1 = polygon[i], p2 = polygon[(i + 1) % polygon.length];
    drawLineOnPng(pngOut, p1.x, p1.y, p2.x, p2.y, [255, 0, 0], 2);
  }
  for (let i = 0; i < polygon.length; i += 1) {
    drawCircleOnPng(pngOut, Math.round(polygon[i].x), Math.round(polygon[i].y), 4, [0, 255, 0]);
  }
  writeFileSync(resolve(OUTPUT_DIR, 'output_contour.png'), PNG.sync.write(pngOut));
  console.log('  ✓ output_contour.png');

  // Metrics
  const area = Math.abs(signedArea(polygon));
  const imageArea = imageData.width * imageData.height;
  const ratio = area / imageArea;
  console.log(`\n  Contour area   : ${area.toFixed(0)}`);
  console.log(`  Vertices       : ${polygon.length}`);
  console.log(`  Area ratio     : ${(ratio * 100).toFixed(1)}%`);

  if (ratio < 0.05) console.warn('  ⚠  WARNING: contour area very small — possible failure');
  if (ratio > 0.95) console.warn('  ⚠  WARNING: contour covers nearly entire image');

  const touchesBorder = polygon.some(
    (p) => p.x <= 1 || p.y <= 1 || p.x >= imageData.width - 2 || p.y >= imageData.height - 2,
  );
  if (touchesBorder) console.warn('  ⚠  WARNING: contour touches image border');

  console.log('\nDone – debug images saved to test-output/\n');
  return { outer: polygon, debug: { area, vertices: polygon.length, areaRatio: ratio } };
}

/* ------------------------------------------------------------------ */
/*  Main entry point                                                   */
/* ------------------------------------------------------------------ */

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const imagePath = process.argv[2] || 'ExampleFloorplan.png';
  runTestPipeline(imagePath);
}
