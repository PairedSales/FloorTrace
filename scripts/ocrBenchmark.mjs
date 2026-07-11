/**
 * Dimension-OCR benchmark harness.
 *
 * Runs the detection pipeline (Tesseract path — the PaddleOCR rescue pass is
 * browser-only) against floorplan PNGs with known ground truth and reports
 * detection rate, parsed-value accuracy, and per-phase timings.
 *
 * Usage:  node scripts/ocrBenchmark.mjs [image.png ...]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PNG } from 'pngjs';
import { detectDimensionsCore } from '../src/utils/dimensions/pipeline.js';
import { terminateOcrWorker } from '../src/utils/dimensions/ocrTesseract.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Known labels on ExampleFloorplan.png (feet; [width, height]). */
const EXAMPLE_GROUND_TRUTH = [
  { name: 'W.I.C.', w: 8 + 8 / 12, h: 4 + 11 / 12 },
  { name: 'BEDROOM (top-left)', w: 7 + 9 / 12, h: 10 + 4 / 12 },
  { name: 'PRIMARY BEDROOM', w: 12 + 7 / 12, h: 13 + 3 / 12 },
  { name: 'BATH (floor 2)', w: 8 + 8 / 12, h: 5 + 1 / 12 },
  { name: 'BEDROOM (floor 2 right)', w: 12 + 7 / 12, h: 10 + 10 / 12 },
  { name: 'DINING AREA', w: 9 + 3 / 12, h: 10 + 8 / 12 },
  { name: 'KITCHEN', w: 10 + 1 / 12, h: 10 + 4 / 12 },
  { name: 'BATH (floor 1)', w: 8 + 7 / 12, h: 5 + 11 / 12 },
  { name: 'UTILITY', w: 10, h: 9 + 3 / 12 },
  { name: 'GARAGE', w: 20 + 7 / 12, h: 9 + 6 / 12 },
  { name: 'LIVING ROOM', w: 19 + 9 / 12, h: 12 + 11 / 12 },
  { name: 'FAMILY ROOM', w: 14 + 10 / 12, h: 14 + 1 / 12 }
];

const loadPng = (filePath) => {
  const png = PNG.sync.read(fs.readFileSync(filePath));
  return {
    width: png.width,
    height: png.height,
    data: new Uint8ClampedArray(png.data)
  };
};

const toOcrInput = (imageDataLike) => {
  const png = new PNG({ width: imageDataLike.width, height: imageDataLike.height });
  png.data = Buffer.from(
    imageDataLike.data.buffer,
    imageDataLike.data.byteOffset,
    imageDataLike.data.byteLength
  );
  return PNG.sync.write(png);
};

const matches = (dim, gt, tol = 0.05) => {
  const straight = Math.abs(dim.width - gt.w) <= tol && Math.abs(dim.height - gt.h) <= tol;
  const swapped = Math.abs(dim.width - gt.h) <= tol && Math.abs(dim.height - gt.w) <= tol;
  return straight || swapped;
};

const run = async () => {
  const args = process.argv.slice(2);
  // A "<image>.truth.json" file next to an image supplies ground truth:
  // either a bare array [{ name, w, h }] in decimal feet, or the combined
  // detectionBenchmark sidecar object with that array under an "ocr" key.
  const truthFor = (file) => {
    const truthPath = file.replace(/\.(png|jpg)$/i, '.truth.json');
    if (!fs.existsSync(truthPath)) return null;
    const parsed = JSON.parse(fs.readFileSync(truthPath, 'utf8'));
    return Array.isArray(parsed) ? parsed : parsed.ocr ?? null;
  };
  const targets = args.length > 0
    ? args.map((a) => ({ file: path.resolve(a), truth: truthFor(path.resolve(a)) }))
    : [{ file: path.join(ROOT, 'ExampleFloorplan.png'), truth: EXAMPLE_GROUND_TRUTH }];

  for (const { file, truth } of targets) {
    console.log(`\n=== ${path.basename(file)} ===`);
    const imageData = loadPng(file);
    console.log(`   ${imageData.width}x${imageData.height}px`);

    // Warm the worker separately so the report isolates per-image cost
    // (the app keeps a cached worker across detections too).
    const warmup = Date.now();
    await detectDimensionsCore(
      { width: 40, height: 20, data: new Uint8ClampedArray(40 * 20 * 4).fill(255) },
      { toOcrInput, budgetMs: 4000 }
    );
    console.log(`   engine warm-up: ${Date.now() - warmup}ms (one-time)`);

    const debug = process.env.OCR_DEBUG === '1';
    const t0 = Date.now();
    const result = await detectDimensionsCore(imageData, { toOcrInput, budgetMs: 2600, debug });
    const wall = Date.now() - t0;

    if (debug && result.debug) {
      console.log('   --- pass1 digit lines ---');
      for (const l of result.debug.pass1Lines) console.log(`     [${l.conf}] "${l.text}"`);
      console.log('   --- spatial boxes ---');
      for (const b of result.debug.spatialBoxes) {
        console.log(`     ${b.vertical ? 'V' : 'H'} (${b.x},${b.y},${b.width},${b.height}) glyphs=${b.glyphCount}`);
      }
      console.log('   --- alpha boxes ---');
      for (const b of result.debug.alphaBoxes ?? []) {
        console.log(`     (${b.x},${b.y},${b.width},${b.height})`);
      }
      console.log('   --- ROI queue ---');
      for (const q of result.debug.roiQueue ?? []) {
        console.log(`     ${q.vertical ? 'V' : 'H'} p=${q.priority} (${q.x},${q.y},${q.width},${q.height})`);
      }
      console.log('   --- ROI reads ---');
      for (const r of result.debug.rois) {
        console.log(`     ${r.vertical ? 'V' : 'H'} p=${r.priority} (${r.bbox.x},${r.bbox.y},${r.bbox.width},${r.bbox.height}) -> ${r.parsed} ${JSON.stringify(r.reads)}`);
      }
    }

    console.log(`   timings: ${JSON.stringify(result.timings)}  wall=${wall}ms`);
    console.log(`   detectedFormat: ${result.detectedFormat}`);
    console.log(`   dimensions found: ${result.dimensions.length}`);
    for (const d of result.dimensions) {
      console.log(
        `     ${d.width.toFixed(2)} x ${d.height.toFixed(2)} ft  conf=${d.confidence}` +
        `  fmt=${d.format}  bbox=(${d.bbox.x},${d.bbox.y},${d.bbox.width},${d.bbox.height})  "${d.text}"`
      );
    }

    if (truth) {
      let hits = 0;
      for (const gt of truth) {
        const found = result.dimensions.find((d) => matches(d, gt));
        console.log(`   ${found ? 'HIT ' : 'MISS'}  ${gt.name}  (${gt.w.toFixed(2)} x ${gt.h.toFixed(2)})`);
        if (found) hits++;
      }
      const extras = result.dimensions.filter((d) => !truth.some((gt) => matches(d, gt)));
      console.log(`   detection rate: ${hits}/${truth.length}  false positives: ${extras.length}`);
    }
  }

  await terminateOcrWorker();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
