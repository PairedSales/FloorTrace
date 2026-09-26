/**
 * CubiCasa5K benchmark: the tracer and the scale against plans whose outline
 * and scale are known exactly — hundreds of them, where detectionBenchmark
 * has nine hand-authored fixtures. See datasets/README.md for the download.
 *
 * Usage:  npm run bench:cubicasa -- [options]
 *   --split dev|test|val|train|all  which plans (default test: 400). dev is a
 *                                fixed 400 of train weighted toward the
 *                                listing-style categories: the edit loop
 *   --category NAME              colorful | high_quality | high_quality_architectural
 *   --limit N                    an even spread of N plans from the selection
 *   --ids a/1,b/2                exactly these plans
 *   --workers N                  parallel workers (default: half the cores)
 *   --out NAME                   results file (default latest), under
 *                                datasets/cubicasa5k_runs/ beside the corpus
 *   --compare NAME               per-plan deltas against an earlier results file
 *   --draw N                     overlays of the N worst plans
 *   --draw-changed               with --compare: overlays of every plan whose
 *                                verdict changed, named before-to-after_id.png
 *   --boundary JSON              options for every trace, e.g. '{"autoGarage":false}',
 *                                to measure a change before making it
 *
 * Each plan is cropped to its annotated unit plus a margin, the way a user
 * crops a sheet to the plan they are measuring, and measured three ways:
 *   bare   the trace before anything has been read off the page
 *   scale  every room label measured as one batch and pooled, as the scan
 *          does, with each label's feet-inches as OCR would have read them
 *   app    the trace the app runs after the scan: non-GLA labels excluded, the
 *          labels and the rooms that set the scale as constraints
 * Traces are scored by mask IoU and area against living-area truth, and given
 * a verdict — perfect, near-perfect or wrong — which is the number the work in
 * docs/accuracy-roadmap.md is steering by. The scale is scored against the
 * drawing's 30.48 px/ft; the confidence against the error it sat on, because a
 * wrong area shown green is the failure that matters most. CubiCasa prints no
 * feet-inches on its images, so OCR itself is not measured.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { Worker, isMainThread, parentPort } from 'worker_threads';
import { PNG } from 'pngjs';
import {
  detectRoomFromClickCore,
  traceFloorplanBoundaryCore,
} from '../src/utils/detection/pipeline.js';
import { pointInPolygon, ringSetArea } from '../src/utils/detection/polygon.js';
import { labelComponents, openRect } from '../src/utils/detection/raster.js';
import { selectProjectScale } from '../src/utils/detection/scale.js';
import { bboxIou, pct } from './lib/benchUtils.mjs';
import {
  CUBICASA_ROOT, DATASETS_DIR, PX_PER_FOOT, buildTruth, cropImage, evenSpread, fillPolygon,
  listPlans, loadPlan, wallInkAgreement,
} from './lib/cubicasa.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUNS_DIR = path.join(DATASETS_DIR, 'cubicasa5k_runs');

// Below this share of walls on ink the truth is misregistered, not the tracer.
const MIN_WALL_AGREEMENT = 0.6;
// What an OCR hit on a room label spans at CubiCasa's 1 px = 1 cm.
const LABEL_BOX = { width: 90, height: 30 };
const GOOD_AREA = 0.05;
const BAD_AREA = 0.1;
const ROOM_IOU = 0.75;

// The verdict (docs/accuracy-roadmap.md). A trace is perfect when its IoU with
// the truth reaches PERFECT_IOU; measured on the test split, every plan that
// does has its area within 3%, and half within 1%. It is near-perfect when
// fixing at most FIXES error regions, each no more than FIX_MAX_SHARE of the
// true area, would make it perfect: a balcony left in, a closet left out, a
// wing cut short — what a user sees and corrects with one edit. A region
// bigger than that is a redraw, not a fix. Anything else is wrong.
const PERFECT_IOU = 0.97;
const FIXES = 2;
const FIX_MAX_SHARE = 0.2;
// Error no thicker than twice this many truth cells (2 cm each) is the outline
// sitting on another face of a wall: no single edit fixes it, so it stays in
// the residual instead of counting as a region.
const SLIVER_CELLS = 4;
// Regions under this share of the true area are noise, not something to fix.
const MIN_REGION_SHARE = 0.005;
const VERDICTS = ['perfect', 'near', 'wrong'];
// colorful and high_quality are single units on a clean sheet, the closest
// thing here to a listing plan; the architectural sheets carry neighbouring
// flats and tile-grid wet rooms, so they are reported beside them, not mixed in.
const GROUPS = [
  ['listing-like', (r) => r.category !== 'high_quality_architectural'],
  ['colorful', (r) => r.category === 'colorful'],
  ['high_quality', (r) => r.category === 'high_quality'],
  ['architectural', (r) => r.category === 'high_quality_architectural'],
  ['all', () => true],
];

const round = (v, digits) => (Number.isFinite(v) ? Number(v.toFixed(digits)) : null);

const median = (values) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const share = (list, test) => (list.length ? list.filter(test).length / list.length : 0);

const labelRegion = (point, keyword) => ({
  x: point[0] - LABEL_BOX.width / 2,
  y: point[1] - LABEL_BOX.height / 2,
  width: LABEL_BOX.width,
  height: LABEL_BOX.height,
  keyword,
});

// Every outline a trace produced — all floors, each with its voids.
const tracedFloors = (result) => {
  if (result?.floors?.length) {
    return result.floors
      .filter((f) => f.outer)
      .map((f) => ({ outer: f.outer.polygon, holes: f.holes ?? [] }));
  }
  return result?.outer ? [{ outer: result.outer.polygon, holes: result.holes ?? [] }] : [];
};

const compactRing = (ring) => ring.map((p) => [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10]);

// The trace's error as discrete regions: connected pieces of the difference
// between outline and truth once slivers along the wall faces are trimmed off,
// each with its cause and its size as a share of the true area.
const errorRegions = (mask, truth, truthCells) => {
  const { width, height } = truth.grid;
  const over = new Uint8Array(mask.length);
  const missed = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i += 1) {
    if (mask[i] && !truth.footprint[i]) over[i] = 1;
    else if (!mask[i] && truth.footprint[i]) missed[i] = 1;
  }
  const regions = [];
  for (const [kind, diff] of [['over', over], ['missed', missed]]) {
    const { labels, components } = labelComponents(openRect(diff, width, height, SLIVER_CELLS), width, height);
    for (const comp of components) {
      if (comp.size < MIN_REGION_SHARE * truthCells) continue;
      let nonGla = 0;
      if (kind === 'over') {
        for (let y = comp.bbox.minY; y <= comp.bbox.maxY; y += 1) {
          for (let x = comp.bbox.minX; x <= comp.bbox.maxX; x += 1) {
            const i = y * width + x;
            if (labels[i] === comp.id && truth.nonGla[i]) nonGla += 1;
          }
        }
      }
      regions.push({
        cause: kind === 'missed' ? 'missed' : (nonGla > comp.size / 2 ? 'nonGla' : 'other'),
        share: comp.size / truthCells,
      });
    }
  }
  return regions.sort((a, b) => b.share - a.share);
};

// Fixing a region takes it out of the union when the outline took it in, and
// adds it to the intersection when the outline left it out.
const verdictOf = (inter, union, truthCells, regions) => {
  if (union && inter / union >= PERFECT_IOU) return 'perfect';
  let i = inter;
  let u = union;
  for (const region of regions.filter((r) => r.share <= FIX_MAX_SHARE).slice(0, FIXES)) {
    if (region.cause === 'missed') i += region.share * truthCells;
    else u -= region.share * truthCells;
  }
  return u && i / u >= PERFECT_IOU ? 'near' : 'wrong';
};

const scoreTrace = (result, truth, ms) => {
  const floors = tracedFloors(result);
  const { width, height, cell } = truth.grid;
  const mask = new Uint8Array(width * height);
  for (const floor of floors) {
    fillPolygon(mask, width, height, floor.outer, { cell });
    for (const hole of floor.holes) fillPolygon(mask, width, height, hole, { cell, value: 0 });
  }
  let inter = 0;
  let union = 0;
  let truthCells = 0;
  let overNonGla = 0;
  let overOther = 0;
  for (let i = 0; i < mask.length; i += 1) {
    if (truth.footprint[i]) truthCells += 1;
    if (mask[i] && truth.footprint[i]) inter += 1;
    if (mask[i] || truth.footprint[i]) union += 1;
    if (mask[i] && !truth.footprint[i]) {
      if (truth.nonGla[i]) overNonGla += 1;
      else overOther += 1;
    }
  }
  const areaPx = floors.reduce((sum, f) => sum + ringSetArea(f.outer, f.holes), 0);
  const quality = result?.quality;
  const regions = errorRegions(mask, truth, truthCells);
  return {
    verdict: verdictOf(inter, union, truthCells, regions),
    iou: round(union ? inter / union : 0, 4),
    areaErr: round(areaPx / (truth.areaSqFt * PX_PER_FOOT * PX_PER_FOOT) - 1, 4),
    // The error by cause, each as a share of the true area: non-GLA space the
    // outline kept, anything else it took in, and living space it left out.
    overNonGla: round(truthCells ? overNonGla / truthCells : 0, 4),
    overOther: round(truthCells ? overOther / truthCells : 0, 4),
    missed: round(truthCells ? (truthCells - inter) / truthCells : 0, 4),
    regions: regions.slice(0, 4).map((r) => ({ cause: r.cause, share: round(r.share, 4) })),
    areaPx: Math.round(areaPx),
    floors: floors.length,
    confidence: round(quality?.confidence ?? 0, 3),
    carves: result?.excludedRegions ?? 0,
    garages: result?.excludedGarages ?? 0,
    // `info` notes describe how an outline was reached, not a reason to doubt
    // it, and the app does not count them either.
    warnings: [...new Set((quality?.warnings ?? [])
      .filter((w) => w.severity !== 'info')
      .map((w) => w.code))],
    ms,
    rings: floors.map((f) => ({ outer: compactRing(f.outer), holes: f.holes.map(compactRing) })),
  };
};

const evaluatePlan = (id, boundary) => {
  const started = Date.now();
  const plan = loadPlan(id);
  const truth = buildTruth(plan.model, plan.image);
  if (!truth) return { id, category: plan.category, skipped: 'no-living-space' };
  const image = cropImage(plan.image, truth.crop);
  const agreement = wallInkAgreement(truth.walls, image);
  const base = {
    id,
    category: plan.category,
    size: [image.width, image.height],
    floorsTruth: truth.floorCount,
    truthSqFt: round(truth.areaSqFt, 1),
    voidsTruth: truth.voids,
    garageTruth: truth.rooms.some((r) => r.keyword === 'GARAGE' || r.keyword === 'CARPORT'),
    wallAgreement: round(agreement, 3),
  };
  if (agreement < MIN_WALL_AGREEMENT) return { ...base, skipped: 'truth-misregistered' };

  const cacheKey = `cubicasa:${id}`;
  let t = Date.now();
  const bare = scoreTrace(traceFloorplanBoundaryCore(image, { cacheKey, boundary }), truth, Date.now() - t);

  // The scan's batch: every label on the page, one shared cacheKey, no scale
  // prior, and every other label as a place this room is not. CubiCasa writes
  // a bounding-box size on every room, a diagonal bathroom included; a plan
  // prints feet-inches on rectangles, so only rectangles carry them here.
  t = Date.now();
  const labels = truth.rooms.filter((r) => r.point && r.dims && r.rectangular);
  const nonGla = truth.rooms
    .filter((r) => r.excluded && r.point)
    .map((r) => labelRegion(r.point, r.keyword));
  const measured = [];
  labels.forEach((room, i) => {
    const labelDims = { width: room.dims[0], height: room.dims[1] };
    const result = detectRoomFromClickCore(image, { x: room.point[0], y: room.point[1] }, {
      cacheKey,
      boundary,
      labelDims,
      pixelsPerFoot: null,
      foreignPoints: labels.filter((_, j) => j !== i).map((o) => ({ x: o.point[0], y: o.point[1] })),
    });
    if (result) measured.push({ ...result, labelId: `${i}:${room.name ?? room.type}`, labelDims, labelIndex: i });
  });
  const decision = selectProjectScale(measured, { footprintAreaPx: bare.areaPx, nonGlaRegions: nonGla });
  const ppf = decision.pixelsPerFoot;
  const scale = {
    labels: labels.length,
    measured: measured.length,
    rooms: decision.roomCount,
    level: decision.level,
    reason: decision.reason,
    ppf: round(ppf, 3),
    err: ppf ? round(ppf / PX_PER_FOOT - 1, 4) : null,
    ms: Date.now() - t,
  };

  const byLabel = new Map(measured.map((m) => [m.labelIndex, m]));
  const roomIous = labels
    .map((room, i) => ({ room, found: byLabel.get(i) }))
    .filter(({ room }) => room.rectangular && !room.excluded)
    .map(({ room, found }) => (found
      ? bboxIou(
        [found.rect.left, found.rect.top, found.rect.right, found.rect.bottom],
        [room.rect.left, room.rect.top, room.rect.right, room.rect.bottom],
      )
      : 0));

  t = Date.now();
  const appResult = traceFloorplanBoundaryCore(image, {
    cacheKey,
    boundary,
    excludeRegions: nonGla,
    constraints: {
      rooms: decision.contributors.map((c) => ({ name: c.name, rect: c.rect })),
      interiorPoints: truth.rooms
        .filter((r) => !r.excluded && r.point)
        .map((r) => ({ x: r.point[0], y: r.point[1], name: r.name })),
    },
  });
  const app = scoreTrace(appResult, truth, Date.now() - t);
  // Every non-GLA label the app's outline still holds: the carve was told this
  // space was a balcony or a garage and counted it anyway.
  const appFloors = tracedFloors(appResult);
  app.nonGlaInside = truth.rooms.filter((r) => r.excluded && r.point && appFloors.some(
    (f) => pointInPolygon({ x: r.point[0], y: r.point[1] }, f.outer, f.holes),
  )).length;

  return {
    ...base,
    nonGlaLabels: nonGla.length,
    bare,
    scale,
    app,
    rooms: {
      scored: roomIous.length,
      hit: roomIous.filter((v) => v >= ROOM_IOU).length,
      medianIou: round(median(roomIous), 3),
    },
    // What the user would read: the app's outline at the app's own scale.
    reportedErr: ppf ? round(app.areaPx / (ppf * ppf) / truth.areaSqFt - 1, 4) : null,
    ms: Date.now() - started,
  };
};

if (!isMainThread) {
  parentPort.on('message', ({ id, boundary }) => {
    let result;
    try {
      result = evaluatePlan(id, boundary);
    } catch (err) {
      result = { id, category: id.split('/')[0], error: String(err?.stack ?? err) };
    }
    parentPort.postMessage(result);
  });
}

const parseArgs = (argv) => {
  const args = {
    split: 'test', workers: Math.max(1, Math.floor(os.availableParallelism() / 2)), out: 'latest',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i].replace(/^--/, '');
    const value = argv[i + 1];
    if (key === 'boundary') {
      args.boundary = JSON.parse(value);
      i += 1;
    } else if (['split', 'category', 'out', 'compare'].includes(key)) {
      args[key] = value;
      i += 1;
    } else if (['limit', 'workers', 'draw'].includes(key)) {
      args[key] = Number(value);
      i += 1;
    } else if (key === 'ids') {
      args.ids = value.split(',').map((s) => s.trim().replace(/^\/+|\/+$/g, '')).filter(Boolean);
      i += 1;
    } else if (key === 'draw-changed') {
      args.drawChanged = true;
    }
  }
  return args;
};

const runPool = (ids, workerCount, boundary) => new Promise((resolve) => {
  const results = [];
  const started = Date.now();
  let next = 0;
  const progress = () => {
    if (results.length % 10 && results.length !== ids.length) return;
    process.stderr.write(`\r   ${results.length}/${ids.length} plans, ${Math.round((Date.now() - started) / 1000)}s`);
    if (results.length === ids.length) process.stderr.write('\n');
  };
  const spawn = () => {
    const worker = new Worker(new URL(import.meta.url));
    let current = null;
    const give = () => {
      if (next >= ids.length) {
        worker.terminate();
        return;
      }
      current = ids[next];
      next += 1;
      worker.postMessage({ id: current, boundary });
    };
    const finish = (result) => {
      results.push(result);
      progress();
      if (results.length === ids.length) resolve(results);
    };
    worker.on('message', (result) => {
      current = null;
      finish(result);
      give();
    });
    // A worker that dies (out of memory, a native fault) takes one plan with
    // it; that plan is recorded as an error and a fresh worker takes over.
    worker.on('error', (err) => {
      if (current) finish({ id: current, category: current.split('/')[0], error: String(err?.message ?? err) });
      current = null;
      if (next < ids.length) spawn();
    });
    give();
  };
  for (let w = 0; w < Math.min(workerCount, ids.length); w += 1) spawn();
});

const summariseTraces = (scored, run) => {
  const list = scored.map((r) => r[run]);
  const errs = list.map((s) => Math.abs(s.areaErr));
  return [
    `   ${run.padEnd(5)} IoU median ${pct(median(list.map((s) => s.iou)))}`
      + ` | >=95% ${pct(share(list, (s) => s.iou >= 0.95))}`
      + ` | >=90% ${pct(share(list, (s) => s.iou >= 0.9))}`
      + ` | <80% ${pct(share(list, (s) => s.iou < 0.8))}`,
    `         area |err| median ${pct(median(errs))}`
      + ` | <=2% ${pct(share(errs, (e) => e <= 0.02))}`
      + ` | <=5% ${pct(share(errs, (e) => e <= GOOD_AREA))}`
      + ` | >10% ${pct(share(errs, (e) => e > BAD_AREA))}`
      + ` | >25% ${pct(share(errs, (e) => e > 0.25))}`
      + ` | bias ${pct(median(list.map((s) => s.areaErr)))}`,
  ];
};

const CONFIDENCE_BANDS = [[0.9, 1.01], [0.75, 0.9], [0.5, 0.75], [0, 0.5]];

const summarise = (results) => {
  const lines = [];
  const scored = results.filter((r) => !r.skipped && !r.error);
  const skipped = results.filter((r) => r.skipped);
  const errors = results.filter((r) => r.error);
  const reasons = {};
  for (const r of skipped) reasons[r.skipped] = (reasons[r.skipped] ?? 0) + 1;
  lines.push(`\n=== CubiCasa5K: ${scored.length} scored of ${results.length}`
    + `${skipped.length ? `, skipped ${Object.entries(reasons).map(([k, v]) => `${v} ${k}`).join(', ')}` : ''}`
    + `${errors.length ? `, ${errors.length} errors` : ''} ===`);
  if (!scored.length) return lines;

  lines.push(`\nVerdict (perfect: IoU >= ${pct(PERFECT_IOU)}; near-perfect: perfect once at most ${FIXES}`
    + ` error regions of <= ${pct(FIX_MAX_SHARE)} of the area each are fixed):`);
  lines.push(`   ${''.padEnd(14)}    n | app perfect | near-perfect |  wrong | bare near-perfect`);
  for (const [name, test] of GROUPS) {
    const group = scored.filter(test);
    if (!group.length) continue;
    const rate = (run, verdicts) => pct(share(group, (r) => verdicts.includes(r[run].verdict)));
    lines.push(`   ${name.padEnd(14)} ${String(group.length).padStart(4)}`
      + ` | ${rate('app', ['perfect']).padStart(11)}`
      + ` | ${rate('app', ['perfect', 'near']).padStart(12)}`
      + ` | ${rate('app', ['wrong']).padStart(6)}`
      + ` | ${rate('bare', ['perfect', 'near']).padStart(17)}`);
  }
  const REGION_CAUSES = [
    ['nonGla', 'non-GLA space kept'], ['other', 'anything else taken in'], ['missed', 'living space left out'],
  ];
  lines.push(`   plans with an error region (>= ${pct(MIN_REGION_SHARE)} of the area) in the app trace: `
    + REGION_CAUSES.map(([cause, label]) => `${label} ${pct(share(scored, (r) => r.app.regions.some(
      (region) => region.cause === cause,
    )))}`).join(' | '));
  const labelled = scored.reduce((sum, r) => sum + r.nonGlaLabels, 0);
  const labelledInside = scored.reduce((sum, r) => sum + r.app.nonGlaInside, 0);
  lines.push(`   non-GLA labels the app outline still holds: ${labelledInside} of ${labelled}`
    + ` (${pct(labelled ? labelledInside / labelled : 0)}), on ${scored.filter((r) => r.app.nonGlaInside).length} plans`);

  lines.push('\nOutline against living-area truth:');
  lines.push(...summariseTraces(scored, 'bare'), ...summariseTraces(scored, 'app'));

  lines.push('\nConfidence the app would show (app trace) against the error it sat on:');
  for (const [lo, hi] of CONFIDENCE_BANDS) {
    const band = scored.filter((r) => r.app.confidence >= lo && r.app.confidence < hi);
    if (!band.length) continue;
    lines.push(`   ${(`${Math.round(lo * 100)}-${Math.min(100, Math.round(hi * 100))}%`).padEnd(8)}`
      + ` ${String(band.length).padStart(4)} plans`
      + ` | near-perfect ${pct(share(band, (r) => r.app.verdict !== 'wrong'))}`
      + ` | within 5% ${pct(share(band, (r) => Math.abs(r.app.areaErr) <= GOOD_AREA))}`
      + ` | off >10% ${pct(share(band, (r) => Math.abs(r.app.areaErr) > BAD_AREA))}`);
  }

  const CAUSES = [
    ['overNonGla', 'kept non-GLA space (balcony, terrace, garage…)'],
    ['overOther', 'took in anything else (neighbours, margins, stairs…)'],
    ['missed', 'left out living space'],
  ];
  lines.push('\nWhere the app trace\'s area error comes from (share of true area):');
  for (const [key, label] of CAUSES) {
    const hit = scored.filter((r) => r.app[key] > GOOD_AREA);
    lines.push(`   ${label.padEnd(52)} >5% on ${pct(hit.length / scored.length).padStart(6)} of plans`
      + ` (median there ${pct(median(hit.map((r) => r.app[key])) ?? 0)})`);
  }
  const loudWrong = scored.filter((r) => r.app.confidence >= 0.9 && Math.abs(r.app.areaErr) > BAD_AREA);
  const dominant = {};
  for (const r of loudWrong) {
    const [key] = CAUSES.map(([k]) => [k, r.app[k]]).sort((a, b) => b[1] - a[1])[0];
    dominant[key] = (dominant[key] ?? 0) + 1;
  }
  lines.push(`   ${loudWrong.length} plans at >=90% confidence and >10% off, by largest cause: `
    + `${CAUSES.map(([k]) => `${k} ${dominant[k] ?? 0}`).join(', ')}`);
  lines.push(`   ${scored.filter((r) => r.app.confidence >= 0.9 && r.app.verdict === 'wrong').length}`
    + ' plans at >=90% confidence with a wrong verdict');

  const scales = scored.map((r) => r.scale);
  const chosen = scales.filter((s) => s.ppf);
  const okLevel = chosen.filter((s) => s.level === 'ok');
  lines.push('\nProject scale from the labels (OCR assumed perfect):');
  lines.push(`   chosen ${pct(chosen.length / scales.length)}`
    + ` | |err|<=2% ${pct(share(scales, (s) => s.ppf && Math.abs(s.err) <= 0.02))}`
    + ` | <=4% ${pct(share(scales, (s) => s.ppf && Math.abs(s.err) <= 0.04))}`
    + ` | >10% ${pct(share(scales, (s) => s.ppf && Math.abs(s.err) > 0.1))}`
    + ` | median |err| ${pct(median(chosen.map((s) => Math.abs(s.err))))}`);
  lines.push(`   'ok' verdicts ${okLevel.length}, of which >4% off: ${okLevel.filter((s) => Math.abs(s.err) > 0.04).length}`
    + ` | 'check' verdicts ${chosen.length - okLevel.length} (${Object.entries(chosen
      .filter((s) => s.level !== 'ok')
      .reduce((acc, s) => ({ ...acc, [s.reason]: (acc[s.reason] ?? 0) + 1 }), {}))
      .map(([k, v]) => `${v} ${k}`).join(', ')})`);

  const reported = scored.map((r) => r.reportedErr);
  lines.push('\nArea the user reads (app outline at app scale):');
  lines.push(`   within 2% ${pct(share(reported, (e) => e !== null && Math.abs(e) <= 0.02))}`
    + ` | within 5% ${pct(share(reported, (e) => e !== null && Math.abs(e) <= GOOD_AREA))}`
    + ` | off >10% ${pct(share(reported, (e) => e !== null && Math.abs(e) > BAD_AREA))}`
    + ` | no scale ${pct(share(reported, (e) => e === null))}`);

  const roomTotal = scored.reduce((s, r) => s + r.rooms.scored, 0);
  const roomHit = scored.reduce((s, r) => s + r.rooms.hit, 0);
  lines.push(`\nRectangular rooms found by a label click (IoU >= ${ROOM_IOU * 100}%): ${roomHit}/${roomTotal} (${pct(roomTotal ? roomHit / roomTotal : 0)})`);

  lines.push('\nBy category (app trace):');
  const categories = [...new Set(scored.map((r) => r.category))].sort();
  for (const category of categories) {
    const group = scored.filter((r) => r.category === category);
    lines.push(`   ${category.padEnd(27)} ${String(group.length).padStart(4)}`
      + ` | IoU median ${pct(median(group.map((r) => r.app.iou)))}`
      + ` | area within 5% ${pct(share(group, (r) => Math.abs(r.app.areaErr) <= GOOD_AREA))}`
      + ` | scale within 2% ${pct(share(group, (r) => r.scale.ppf && Math.abs(r.scale.err) <= 0.02))}`);
  }

  const warningCounts = {};
  for (const r of scored) for (const code of r.app.warnings) warningCounts[code] = (warningCounts[code] ?? 0) + 1;
  lines.push(`\nApp-trace warnings: ${Object.entries(warningCounts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`);
  lines.push(`Time per plan: median ${(median(scored.map((r) => r.ms)) / 1000).toFixed(1)}s`);

  lines.push('\nWorst app traces by area:');
  for (const r of [...scored].sort((a, b) => Math.abs(b.app.areaErr) - Math.abs(a.app.areaErr)).slice(0, 15)) {
    lines.push(`   ${r.id.padEnd(34)} IoU ${pct(r.app.iou).padStart(6)}  area ${(r.app.areaErr >= 0 ? '+' : '') + pct(r.app.areaErr)}`
      + `  conf ${pct(r.app.confidence)}  floors ${r.app.floors}/${r.floorsTruth}  ${r.app.warnings.join(',')}`);
  }
  for (const r of errors.slice(0, 5)) lines.push(`   ERROR ${r.id}: ${r.error.split('\n')[0]}`);
  return lines;
};

// Plans scored in both runs, as [before, after].
const pairRuns = (results, baseline) => {
  const before = new Map(baseline.results.map((r) => [r.id, r]));
  return results
    .filter((r) => !r.skipped && !r.error)
    .map((r) => [before.get(r.id), r])
    .filter(([b]) => b && !b.skipped && !b.error);
};

// Plans whose app verdict moved, better first. Empty when the baseline
// predates verdicts.
const verdictChanges = (pairs) => pairs
  .filter(([b, a]) => b.app.verdict && b.app.verdict !== a.app.verdict)
  .map(([b, a]) => ({
    id: a.id,
    before: b.app.verdict,
    after: a.app.verdict,
    delta: VERDICTS.indexOf(a.app.verdict) - VERDICTS.indexOf(b.app.verdict),
    result: a,
  }))
  .sort((p, q) => p.delta - q.delta || p.id.localeCompare(q.id));

const compareRuns = (results, baseline, name) => {
  const lines = [`\n=== Against ${name} (${baseline.meta?.git ?? '?'}) ===`];
  const pairs = pairRuns(results, baseline);
  if (!pairs.length) return [...lines, '   no plans in common'];
  for (const run of ['bare', 'app']) {
    const deltas = pairs.map(([b, a]) => ({ id: a.id, d: a[run].iou - b[run].iou, b: b[run], a: a[run] }));
    const good = (s) => Math.abs(s.areaErr) <= GOOD_AREA;
    lines.push(`   ${run.padEnd(5)} ${pairs.length} plans | IoU mean ${(deltas.reduce((s, x) => s + x.d, 0) / deltas.length >= 0 ? '+' : '')}`
      + `${(100 * deltas.reduce((s, x) => s + x.d, 0) / deltas.length).toFixed(2)} pts`
      + ` | better ${deltas.filter((x) => x.d > 0.02).length}, worse ${deltas.filter((x) => x.d < -0.02).length}`
      + ` | area within 5%: ${deltas.filter((x) => good(x.b)).length} -> ${deltas.filter((x) => good(x.a)).length}`);
    if (pairs.every(([b]) => b[run].verdict)) {
      const tally = (side) => VERDICTS.map((v) => pairs.filter((p) => p[side][run].verdict === v).length).join('/');
      const moved = pairs.map(([b, a]) => VERDICTS.indexOf(a[run].verdict) - VERDICTS.indexOf(b[run].verdict));
      lines.push(`         perfect/near/wrong ${tally(0)} -> ${tally(1)}`
        + ` | verdict better ${moved.filter((d) => d < 0).length}, worse ${moved.filter((d) => d > 0).length}`);
    } else {
      lines.push('         the baseline has no verdicts: re-run it with this benchmark to compare them');
    }
    for (const x of deltas.filter((v) => v.d < -0.02).sort((p, q) => p.d - q.d).slice(0, 8)) {
      lines.push(`      worse ${x.id.padEnd(34)} IoU ${pct(x.b.iou)} -> ${pct(x.a.iou)}  area ${pct(x.b.areaErr)} -> ${pct(x.a.areaErr)}`
        + `${x.b.verdict ? `  ${x.b.verdict} -> ${x.a.verdict}` : ''}`);
    }
  }
  const scaleGood = (r) => r.scale.ppf && Math.abs(r.scale.err) <= 0.02;
  lines.push(`   scale within 2%: ${pairs.filter(([b]) => scaleGood(b)).length} -> ${pairs.filter(([, a]) => scaleGood(a)).length}`);
  return lines;
};

const strokeRing = (png, ring, [r, g, b]) => {
  for (let i = 0; i < ring.length; i += 1) {
    const [ax, ay] = ring[i];
    const [bx, by] = ring[(i + 1) % ring.length];
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay)));
    for (let s = 0; s <= steps; s += 1) {
      const x = Math.round(ax + ((bx - ax) * s) / steps);
      const y = Math.round(ay + ((by - ay) * s) / steps);
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= png.width || yy >= png.height) continue;
          const idx = (yy * png.width + xx) * 4;
          png.data[idx] = r;
          png.data[idx + 1] = g;
          png.data[idx + 2] = b;
          png.data[idx + 3] = 255;
        }
      }
    }
  }
};

// Over the crop the tracer saw: the app trace's error tinted by cause (non-GLA
// space kept blue, anything else taken in red, living space left out yellow),
// then truth green (its edge cells), app red, bare orange.
const ERROR_TINTS = { nonGla: [60, 110, 255], other: [255, 40, 40], missed: [255, 210, 0] };

const drawOverlay = (result, file) => {
  const plan = loadPlan(result.id);
  const truth = buildTruth(plan.model, plan.image);
  const image = cropImage(plan.image, truth.crop);
  const png = new PNG({ width: image.width, height: image.height });
  png.data = Buffer.from(image.data);
  const { width: gw, height: gh, cell } = truth.grid;
  const traced = new Uint8Array(gw * gh);
  for (const floor of result.app.rings) {
    fillPolygon(traced, gw, gh, floor.outer, { cell });
    for (const hole of floor.holes) fillPolygon(traced, gw, gh, hole, { cell, value: 0 });
  }
  for (let py = 0; py < png.height; py += 1) {
    const row = Math.min(gh - 1, Math.floor(py / cell)) * gw;
    for (let px = 0; px < png.width; px += 1) {
      const g = row + Math.min(gw - 1, Math.floor(px / cell));
      let tint = null;
      if (traced[g] && !truth.footprint[g]) tint = truth.nonGla[g] ? ERROR_TINTS.nonGla : ERROR_TINTS.other;
      else if (!traced[g] && truth.footprint[g]) tint = ERROR_TINTS.missed;
      if (!tint) continue;
      const idx = (py * png.width + px) * 4;
      for (let c = 0; c < 3; c += 1) png.data[idx + c] = Math.round(0.55 * png.data[idx + c] + 0.45 * tint[c]);
    }
  }
  const on = (x, y) => x >= 0 && y >= 0 && x < gw && y < gh && truth.footprint[y * gw + x];
  for (let y = 0; y < gh; y += 1) {
    for (let x = 0; x < gw; x += 1) {
      if (!on(x, y) || (on(x - 1, y) && on(x + 1, y) && on(x, y - 1) && on(x, y + 1))) continue;
      for (let py = y * cell; py < Math.min(png.height, (y + 1) * cell); py += 1) {
        for (let px = x * cell; px < Math.min(png.width, (x + 1) * cell); px += 1) {
          const idx = (py * png.width + px) * 4;
          png.data[idx] = 0;
          png.data[idx + 1] = 190;
          png.data[idx + 2] = 0;
        }
      }
    }
  }
  for (const floor of result.bare.rings) for (const ring of [floor.outer, ...floor.holes]) strokeRing(png, ring, [255, 150, 0]);
  for (const floor of result.app.rings) for (const ring of [floor.outer, ...floor.holes]) strokeRing(png, ring, [230, 0, 0]);
  fs.writeFileSync(file, PNG.sync.write(png));
};

// Runs usually live in the main checkout, outside a worktree's tree, where a
// relative path is a ladder of `..`.
const shown = (file) => {
  const rel = path.relative(ROOT, file);
  return rel.startsWith('..') ? file : rel;
};

const gitRevision = () => {
  try {
    const sha = execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim();
    const dirty = execSync('git status --porcelain -- src', { cwd: ROOT }).toString().trim();
    return dirty ? `${sha}+dirty` : sha;
  } catch {
    return null;
  }
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(CUBICASA_ROOT)) {
    console.error(`CubiCasa5K not found at ${CUBICASA_ROOT} — see datasets/README.md`);
    process.exitCode = 2;
    return;
  }
  let ids = args.ids ?? listPlans(args.split);
  if (args.category) ids = ids.filter((id) => id.startsWith(`${args.category}/`));
  ids = evenSpread(ids, args.limit);
  console.log(`CubiCasa5K: ${ids.length} plans, ${Math.min(args.workers, ids.length)} workers`);
  const results = (await runPool(ids, args.workers, args.boundary)).sort((a, b) => a.id.localeCompare(b.id));

  fs.mkdirSync(RUNS_DIR, { recursive: true });
  const outFile = path.join(RUNS_DIR, `${args.out}.json`);
  const meta = { date: new Date().toISOString(), git: gitRevision(), args };
  fs.writeFileSync(outFile, JSON.stringify({ meta, results }));
  for (const line of summarise(results)) console.log(line);
  let baseline = null;
  if (args.compare) {
    const baselineFile = path.join(RUNS_DIR, `${args.compare}.json`);
    if (fs.existsSync(baselineFile)) {
      baseline = JSON.parse(fs.readFileSync(baselineFile, 'utf8'));
      for (const line of compareRuns(results, baseline, args.compare)) console.log(line);
    } else console.log(`\nno results named ${args.compare} to compare against`);
  }
  if (args.drawChanged && baseline) {
    const dir = path.join(RUNS_DIR, args.out, 'changed');
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const changes = verdictChanges(pairRuns(results, baseline));
    for (const c of changes) {
      drawOverlay(c.result, path.join(dir, `${c.before}-to-${c.after}_${c.id.replace(/\//g, '_')}.png`));
    }
    console.log(`\n${changes.length} plans changed verdict, overlays in ${shown(dir)}`);
  }
  if (args.draw > 0) {
    const dir = path.join(RUNS_DIR, args.out);
    fs.mkdirSync(dir, { recursive: true });
    const worst = results
      .filter((r) => !r.skipped && !r.error)
      .sort((a, b) => Math.abs(b.app.areaErr) - Math.abs(a.app.areaErr))
      .slice(0, args.draw);
    for (const r of worst) drawOverlay(r, path.join(dir, `${r.id.replace(/\//g, '_')}.png`));
    console.log(`\n${worst.length} overlays in ${shown(dir)}`);
  }
  console.log(`results: ${shown(outFile)}`);
};

if (isMainThread) main();
