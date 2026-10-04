/**
 * The outline step as the app runs it, timed and checked against itself.
 *
 * `bench:detection` traces each fixture with the truth file's rooms as its
 * constraints, cold. The app does neither: its constraints are the labels the
 * scan read and the rooms measured from them, and it traces through a memo the
 * room clamp has already warmed. Two things only show on that path:
 *
 *  - the second-chance trace (`remediate.js`). A label the scan found outside
 *    the first outline starts an `escalate` or a `join` pass, which is most of
 *    the trace when it runs. The truth file's rooms never leave one outside, so
 *    the benchmark prints "no retry needed" on every fixture.
 *  - a memo that answers differently from a cold trace. That is a bug by
 *    definition — warm and cold run the same code over the same rasters — and
 *    only the browser has a memo to be wrong.
 *
 * Usage:  npm run probe:trace -- [options] [image ...]
 *   (no images)     every plan in fixtures/
 *   --scans FILE    read the scan's labels from FILE, and write them there when
 *                   it does not exist — the scan is the slow half, and two
 *                   builds of the tracer should be handed the same labels
 *   --out FILE      the whole result of every trace, timings left out, to diff
 *                   one build against another
 *
 * Exits 1 when a memoised trace and a cold one disagree on any plan.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { detectDimensionsCore } from '../src/utils/dimensions/pipeline.js';
import { configureTesseract, terminateOcrWorker } from '../src/utils/dimensions/ocrTesseract.js';
import {
  detectRoomFromClickCore, traceFloorplanBoundaryCore, prewarmDetectionCore,
} from '../src/utils/detection/pipeline.js';
import { selectProjectScale } from '../src/utils/detection/scale.js';
import { boundaryConstraints, labelKeyOf, nonGlaExcludeRegions } from '../src/utils/traceInputs.js';
import { decodeImage, toOcrInput } from './lib/benchUtils.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
configureTesseract({ langPath: path.join(ROOT, 'public', 'tesseract') });

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i < 0 ? null : args.splice(i, 2)[1];
};
const scansFile = flag('--scans');
const outFile = flag('--out');
const images = args.length
  ? args
  : fs.readdirSync(path.join(ROOT, 'fixtures'))
    .filter((f) => /\.(png|jpe?g)$/i.test(f))
    .sort()
    .map((f) => path.join(ROOT, 'fixtures', f));

const scans = scansFile && fs.existsSync(scansFile)
  ? JSON.parse(fs.readFileSync(scansFile, 'utf8'))
  : {};
let scanned = false;

// Timings and the memo's own statistics are the two things allowed to differ.
const told = (traced) => JSON.stringify(traced, (key, value) => (
  key === 'elapsedMs' || key === 'searchMemo' ? undefined : value
));

const results = {};
let disagreed = 0;
for (const file of images) {
  const name = path.basename(file);
  const image = await decodeImage(fs.readFileSync(file));
  if (!scans[name]) {
    // Given the time to finish: the app's budget is wall clock, and a harness
    // sharing a machine with other work would lose labels to it unsaid.
    const scan = await detectDimensionsCore(image, { toOcrInput, budgetMs: 60000 });
    scans[name] = {
      dimensions: scan.dimensions, exteriorLabels: scan.exteriorLabels, areaLabels: scan.areaLabels,
    };
    scanned = true;
  }
  const scan = scans[name];
  const cacheKey = `probe:${name}`;

  // App.runAutoScale and the detection worker's batch, in the app's order: the
  // prewarm, every label measured with the others as places it is not, the
  // rooms that agree recorded, then the trace with them as evidence.
  prewarmDetectionCore(image, { cacheKey });
  const labels = scan.dimensions
    .filter((d) => d.bbox && d.width > 0 && d.height > 0)
    .map((d) => ({
      id: labelKeyOf(d),
      point: { x: d.bbox.x + d.bbox.width / 2, y: d.bbox.y + d.bbox.height / 2 },
      labelBbox: d.bbox,
      labelDims: { width: d.width, height: d.height },
    }));
  const measured = labels.map((label, index) => {
    const room = detectRoomFromClickCore(image, label.point, {
      cacheKey,
      labelBbox: label.labelBbox,
      labelDims: label.labelDims,
      pixelsPerFoot: null,
      foreignPoints: labels.filter((_, i) => i !== index).map((l) => l.point),
    });
    return room ? { ...room, labelId: label.id, labelDims: label.labelDims } : null;
  }).filter(Boolean);

  const state = {
    detectedDimensions: scan.dimensions,
    exteriorLabels: scan.exteriorLabels,
    areaLabels: scan.areaLabels,
    rooms: [],
  };
  const decision = measured.length
    ? selectProjectScale(measured, { nonGlaRegions: scan.exteriorLabels.map((l) => l.bbox) })
    : null;
  if (decision?.pixelsPerFoot > 0) {
    state.rooms = decision.contributors.map((c) => ({
      labelId: c.name,
      name: null,
      rect: c.rect,
      confidence: c.confidence,
      sides: c.sides,
      feetPerPixel: { x: 1 / c.pixelsPerFoot.x, y: 1 / c.pixelsPerFoot.y },
    }));
  }
  const options = {
    excludeRegions: nonGlaExcludeRegions(state),
    constraints: boundaryConstraints(state),
  };

  const t0 = performance.now();
  const traced = traceFloorplanBoundaryCore(image, { ...options, cacheKey });
  const traceMs = performance.now() - t0;
  // Again from the memo, and once with no memo at all.
  const again = traceFloorplanBoundaryCore(image, { ...options, cacheKey });
  const cold = traceFloorplanBoundaryCore(image, options);
  const agrees = told(again) === told(traced) && told(cold) === told(traced);
  if (!agrees) disagreed += 1;

  const passes = (traced?.quality?.remediation?.passes ?? [])
    .map((p) => `${p.pass} ${p.accepted ? 'kept' : 'thrown away'}`);
  console.log(`${name.slice(0, 40).padEnd(40)} ${`${image.width}x${image.height}`.padEnd(10)}`
    + ` ${String(labels.length).padStart(2)} labels  outline ${traceMs.toFixed(0).padStart(5)} ms`
    + `  ${passes.length ? passes.join(', ') : 'no second pass'}`
    + `${agrees ? '' : '   MEMO AND COLD DISAGREE'}`);
  results[name] = JSON.parse(told(traced) ?? 'null');
}

if (scansFile && scanned) fs.writeFileSync(scansFile, JSON.stringify(scans));
if (outFile) fs.writeFileSync(outFile, JSON.stringify(results));
await terminateOcrWorker();

if (disagreed) {
  console.error(`\n${disagreed} plan${disagreed === 1 ? '' : 's'} traced differently from the memo than cold.`);
  process.exit(1);
}
