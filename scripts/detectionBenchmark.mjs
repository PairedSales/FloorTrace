/**
 * Detection benchmark harness (sibling of ocrBenchmark.mjs).
 *
 * Runs the room + boundary detection cores against floorplan PNGs with known
 * ground truth and reports per-image pass/fail and timings.
 *
 * Usage:  node scripts/detectionBenchmark.mjs [image.png|folder ...]
 *
 * Ground truth: a "<image>.truth.json" sidecar next to each PNG:
 * {
 *   "pixelsPerFoot": 39.6,                      // optional; enables sq-ft checks
 *   "boundary": {                               // any subset of these
 *     "outerBbox": [x1, y1, x2, y2],            // px, original image space
 *     "outerPolygon": [[x, y], ...],            // px; scored by mask IoU
 *     "outerAreaSqFt": 1234,
 *     "innerAreaSqFt": 1100,
 *     "excludeRegions": [[x, y, w, h], ...]     // porch/patio label bboxes,
 *   },                                          // as OCR would supply them
 *   "rooms": [
 *     { "name": "KITCHEN",
 *       "click": [x, y],                        // px; usually the label centre
 *       "labelBbox": [x, y, w, h],              // optional
 *       "dims": [10.75, 7.92],                  // optional; parsed label feet
 *       "rect": [x1, y1, x2, y2],               // optional; scored by bbox IoU
 *       "minIou": 0.5,                          // optional; default 0.75
 *       "areaSqFt": 85.1 }                      // optional
 *   ]
 * }
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PNG } from 'pngjs';
import {
  detectRoomFromClickCore,
  traceFloorplanBoundaryCore,
} from '../src/utils/detection/pipeline.js';
import { polygonArea } from '../src/utils/detection/polygon.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Ground truth for ExampleFloorplan.png (px in the 2036x1440 original).
 * Wall-face positions were measured from the image; ENTRY is an open-plan
 * label (no physical wall on two sides) so it is scored with a looser IoU.
 */
const EXAMPLE_TRUTH = {
  pixelsPerFoot: 39.3,
  boundary: {
    outerBbox: [77, 97, 1960, 1156],
  },
  rooms: [
    { name: 'PRIMARY BEDROOM', click: [344, 479], dims: [12.42, 16.33], rect: [97, 119, 583, 758] },
    { name: 'BEDROOM', click: [872, 359], dims: [13.42, 12.92], rect: [598, 119, 1123, 624] },
    { name: 'LIVING/DINING', click: [1462, 490], dims: [16.58, 25.83], rect: [1136, 119, 1803, 1133] },
    { name: 'ENTRY', click: [938, 748], dims: [13.42, 10.58], rect: [616, 660, 1143, 1076], minIou: 0.5 },
    { name: 'KITCHEN', click: [1229, 1000], dims: [10.75, 7.92], rect: [1000, 820, 1428, 1133] },
  ],
};

const loadPng = (filePath) => {
  const png = PNG.sync.read(fs.readFileSync(filePath));
  return { width: png.width, height: png.height, data: new Uint8ClampedArray(png.data) };
};

const bboxOf = (overlay) => [overlay.x1, overlay.y1, overlay.x2, overlay.y2];

const bboxIou = (a, b) => {
  const ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  const iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const inter = ix * iy;
  const areaA = (a[2] - a[0]) * (a[3] - a[1]);
  const areaB = (b[2] - b[0]) * (b[3] - b[1]);
  return inter / (areaA + areaB - inter);
};

// Even-odd scanline rasterization onto a coarse grid for polygon IoU.
const rasterize = (polygon, bounds, gridW, gridH) => {
  const mask = new Uint8Array(gridW * gridH);
  const sx = gridW / (bounds[2] - bounds[0]);
  const sy = gridH / (bounds[3] - bounds[1]);
  const pts = polygon.map((p) => ({
    x: ((Array.isArray(p) ? p[0] : p.x) - bounds[0]) * sx,
    y: ((Array.isArray(p) ? p[1] : p.y) - bounds[1]) * sy,
  }));
  for (let gy = 0; gy < gridH; gy += 1) {
    const y = gy + 0.5;
    const xs = [];
    for (let i = 0; i < pts.length; i += 1) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) {
        xs.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = Math.max(0, Math.ceil(xs[k] - 0.5));
      const to = Math.min(gridW - 1, Math.floor(xs[k + 1] - 0.5));
      for (let x = from; x <= to; x += 1) mask[gy * gridW + x] = 1;
    }
  }
  return mask;
};

const polygonIou = (polyA, polyB) => {
  const all = [...polyA, ...polyB].map((p) => (Array.isArray(p) ? { x: p[0], y: p[1] } : p));
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of all) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const bounds = [minX, minY, maxX, maxY];
  const gridW = 512;
  const gridH = Math.max(32, Math.round(512 * (maxY - minY) / Math.max(1, maxX - minX)));
  const a = rasterize(polyA, bounds, gridW, gridH);
  const b = rasterize(polyB, bounds, gridW, gridH);
  let inter = 0;
  let union = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] && b[i]) inter += 1;
    if (a[i] || b[i]) union += 1;
  }
  return union > 0 ? inter / union : 0;
};

const pct = (x) => `${(x * 100).toFixed(1)}%`;

const scoreBoundary = (result, truth, ppf) => {
  const lines = [];
  let pass = true;
  if (!result?.outer) {
    return { pass: false, lines: ['   BOUNDARY MISS: no outer polygon'] };
  }
  const outerAreaPx = polygonArea(result.outer.polygon);
  lines.push(`   outer: ${result.outer.polygon.length} vertices, bbox=[${bboxOf(result.outer.overlay).map((v) => v.toFixed(0)).join(', ')}]`);
  if (ppf) lines.push(`   outer area: ${(outerAreaPx / (ppf * ppf)).toFixed(1)} sq ft`);

  if (truth?.outerBbox) {
    const iou = bboxIou(bboxOf(result.outer.overlay), truth.outerBbox);
    const ok = iou >= 0.9;
    pass = pass && ok;
    lines.push(`   ${ok ? 'HIT ' : 'MISS'}  outer bbox IoU=${pct(iou)}`);
  }
  if (truth?.outerPolygon) {
    const iou = polygonIou(result.outer.polygon, truth.outerPolygon);
    const ok = iou >= 0.9;
    pass = pass && ok;
    lines.push(`   ${ok ? 'HIT ' : 'MISS'}  outer polygon IoU=${pct(iou)}`);
  }
  if (truth?.outerAreaSqFt && ppf) {
    const area = outerAreaPx / (ppf * ppf);
    const err = Math.abs(area - truth.outerAreaSqFt) / truth.outerAreaSqFt;
    const ok = err <= 0.05;
    pass = pass && ok;
    lines.push(`   ${ok ? 'HIT ' : 'MISS'}  outer area ${area.toFixed(1)} vs ${truth.outerAreaSqFt} sq ft (err ${pct(err)})`);
  }
  if (truth?.innerAreaSqFt && ppf) {
    if (!result.inner) {
      pass = false;
      lines.push('   MISS  inner: not produced');
    } else {
      const area = polygonArea(result.inner.polygon) / (ppf * ppf);
      const err = Math.abs(area - truth.innerAreaSqFt) / truth.innerAreaSqFt;
      const ok = err <= 0.05;
      pass = pass && ok;
      lines.push(`   ${ok ? 'HIT ' : 'MISS'}  inner area ${area.toFixed(1)} vs ${truth.innerAreaSqFt} sq ft (err ${pct(err)})`);
    }
  }
  return { pass, lines };
};

const scoreRoom = (result, room, ppf) => {
  if (!result) return { pass: false, line: `   MISS  ${room.name}: no result` };
  const det = bboxOf(result.overlay);
  const detStr = `bbox=[${det.map((v) => v.toFixed(0)).join(', ')}] conf=${result.confidence.toFixed(2)}`;
  if (room.rect) {
    const iou = bboxIou(det, room.rect);
    const ok = iou >= (room.minIou ?? 0.75);
    return { pass: ok, line: `   ${ok ? 'HIT ' : 'MISS'}  ${room.name}: IoU=${pct(iou)} ${detStr}` };
  }
  if (room.areaSqFt && ppf) {
    const area = (det[2] - det[0]) * (det[3] - det[1]) / (ppf * ppf);
    const err = Math.abs(area - room.areaSqFt) / room.areaSqFt;
    const ok = err <= 0.1;
    return { pass: ok, line: `   ${ok ? 'HIT ' : 'MISS'}  ${room.name}: area ${area.toFixed(1)} vs ${room.areaSqFt} (err ${pct(err)}) ${detStr}` };
  }
  return { pass: true, line: `   ----  ${room.name}: ${detStr} (no truth to score)` };
};

const collectTargets = (args) => {
  if (args.length === 0) {
    return [{ file: path.join(ROOT, 'ExampleFloorplan.png'), truth: EXAMPLE_TRUTH }];
  }
  const files = [];
  for (const arg of args) {
    const resolved = path.resolve(arg);
    const stat = fs.statSync(resolved);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(resolved)) {
        if (/\.png$/i.test(entry)) files.push(path.join(resolved, entry));
      }
    } else {
      files.push(resolved);
    }
  }
  return files.map((file) => {
    const truthPath = file.replace(/\.png$/i, '.truth.json');
    const truth = fs.existsSync(truthPath)
      ? JSON.parse(fs.readFileSync(truthPath, 'utf8'))
      : null;
    return { file, truth };
  });
};

const run = () => {
  const targets = collectTargets(process.argv.slice(2));
  let totalPass = 0;
  let totalChecks = 0;

  for (const { file, truth } of targets) {
    console.log(`\n=== ${path.basename(file)} ===`);
    const imageData = loadPng(file);
    console.log(`   ${imageData.width}x${imageData.height}px`);
    const ppf = truth?.pixelsPerFoot;

    const boundaryOpts = truth?.boundary?.excludeRegions
      ? {
        excludeRegions: truth.boundary.excludeRegions.map(
          ([x, y, w, h]) => ({ x, y, width: w, height: h }),
        ),
      }
      : {};
    const t0 = Date.now();
    const boundary = traceFloorplanBoundaryCore(imageData, boundaryOpts);
    const boundaryMs = Date.now() - t0;
    console.log(`   boundary: ${boundaryMs}ms  ${boundary ? `sealRadius=${boundary.debug.sealRadius} wallThickness=${boundary.debug.wallThickness} extThickness=${boundary.debug.exteriorThickness} excluded=${boundary.excludedRegions}${boundary.debug.usedFallback ? ' (fallback)' : ''}` : 'FAILED'}`);
    const bScore = scoreBoundary(boundary, truth?.boundary, ppf);
    for (const line of bScore.lines) console.log(line);
    if (truth?.boundary) {
      totalChecks += 1;
      if (bScore.pass) totalPass += 1;
    }

    for (const room of truth?.rooms ?? []) {
      const opts = {
        labelBbox: room.labelBbox
          ? { x: room.labelBbox[0], y: room.labelBbox[1], width: room.labelBbox[2], height: room.labelBbox[3] }
          : undefined,
        labelDims: room.dims ? { width: room.dims[0], height: room.dims[1] } : undefined,
      };
      const t1 = Date.now();
      const result = detectRoomFromClickCore(imageData, { x: room.click[0], y: room.click[1] }, opts);
      const ms = Date.now() - t1;
      const score = scoreRoom(result, room, ppf);
      console.log(`${score.line}  (${ms}ms)`);
      totalChecks += 1;
      if (score.pass) totalPass += 1;
    }
  }

  console.log(`\n=== TOTAL: ${totalPass}/${totalChecks} checks passed ===`);
  if (totalChecks > 0 && totalPass < totalChecks) process.exitCode = 1;
};

run();
