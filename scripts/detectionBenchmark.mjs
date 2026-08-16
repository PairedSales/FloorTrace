/**
 * Detection benchmark harness (sibling of ocrBenchmark.mjs).
 *
 * Runs the room + boundary detection cores against floorplan PNGs with known
 * ground truth and reports per-image pass/fail and timings.
 *
 * Usage:  node scripts/detectionBenchmark.mjs [image.png|folder ...]
 *         node scripts/detectionBenchmark.mjs --json      (machine-readable)
 *
 * A bounding box cannot see shape: a tracer that discards the outline and
 * returns each building's bounding rectangle used to pass most of these
 * checks, and a footprint 92% too small scored a 99.2% box IoU against the
 * same truth. Boundary truth is therefore scored on polygon IoU where an
 * `outerPolygon`/`innerPolygon` is authored, with the box kept as a reported
 * smoke check, and on square feet where the plan states its own scale.
 *
 * Ground truth: a "<image>.truth.json" sidecar next to each PNG:
 * {
 *   "pixelsPerFoot": 39.6,                      // optional; enables sq-ft checks
 *   "boundary": {                               // any subset of these
 *     "outerBbox": [x1, y1, x2, y2],            // px, original image space
 *     "outerPolygon": [[x, y], ...],            // px; scored by mask IoU
 *     "innerPolygon": [[x, y], ...],            // px; interior wall faces
 *     "minOuterIou": 0.95,                      // optional override
 *     "minInnerIou": 0.9,                       // optional override
 *     "outerAreaSqFt": 1234,
 *     "innerAreaSqFt": 1100,
 *     "minConfidence": 0.7,                     // optional; quality gate
 *     "floors": [[x1, y1, x2, y2], ...],        // per-floor outer bboxes in
 *                                               // reading order (multi-floor)
 *     "floorPolygons": [[[x, y], ...], ...],    // per-floor outlines
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
import {
  detectRoomFromClickCore,
  traceFloorplanBoundaryCore,
} from '../src/utils/detection/pipeline.js';
import { polygonArea, ringSetArea } from '../src/utils/detection/polygon.js';
import { robustScale } from '../src/utils/detection/validate.js';
import { loadPng, bboxOf, bboxIou, polygonIou, pct } from './lib/benchUtils.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const DEFAULT_OUTER_IOU = 0.95;
const DEFAULT_INNER_IOU = 0.9;

const scoreBoundary = (result, truth, ppf) => {
  const lines = [];
  const checks = [];
  const check = (ok, label) => {
    checks.push(ok);
    lines.push(`   ${ok ? 'HIT ' : 'MISS'}  ${label}`);
  };
  if (!result?.outer) {
    return { checks: [false], lines: ['   BOUNDARY MISS: no outer polygon'] };
  }
  const holes = result.floors?.[0]?.holes ?? [];
  const outerAreaPx = ringSetArea(result.outer.polygon, result.holes ?? []);
  lines.push(`   outer: ${result.outer.polygon.length} vertices, bbox=[${bboxOf(result.outer.overlay).map((v) => v.toFixed(0)).join(', ')}]${holes.length ? `, ${holes.length} void(s)` : ''}`);
  const quality = result.quality;
  if (quality) {
    lines.push(`   quality: ${(quality.confidence * 100).toFixed(0)}%${quality.warnings.length ? ` [${quality.warnings.map((w) => w.code).join(', ')}]` : ''}`);
  }
  if (ppf) lines.push(`   outer area: ${(outerAreaPx / (ppf * ppf)).toFixed(1)} sq ft`);

  if (truth?.outerBbox) {
    const iou = bboxIou(bboxOf(result.outer.overlay), truth.outerBbox);
    // Reported, not scored: it cannot see shape, and everything below can.
    lines.push(`   ....  outer bbox IoU=${pct(iou)}`);
    if (!truth.outerPolygon) check(iou >= 0.9, `outer bbox IoU=${pct(iou)} (no polygon truth)`);
  }
  if (truth?.outerPolygon) {
    const iou = polygonIou(result.outer.polygon, truth.outerPolygon);
    check(iou >= (truth.minOuterIou ?? DEFAULT_OUTER_IOU), `outer polygon IoU=${pct(iou)}`);
  }
  if (truth?.innerPolygon) {
    if (!result.inner) check(false, 'inner: not produced');
    else {
      const iou = polygonIou(result.inner.polygon, truth.innerPolygon);
      check(iou >= (truth.minInnerIou ?? DEFAULT_INNER_IOU), `inner polygon IoU=${pct(iou)}`);
    }
  }
  if (truth?.floors) {
    const floors = result.floors ?? [];
    check(floors.length === truth.floors.length,
      `floor count ${floors.length} vs ${truth.floors.length}`);
    for (let i = 0; i < truth.floors.length; i += 1) {
      const outer = floors[i]?.outer;
      if (!outer) {
        check(false, `floor ${i}: no outer polygon`);
        continue;
      }
      // A null entry falls back to the box: some outlines on a sheet are too
      // intricate to author by hand, and a box check is better than none.
      const poly = truth.floorPolygons?.[i];
      if (poly) {
        const iou = polygonIou(outer.polygon, poly);
        check(iou >= (truth.minOuterIou ?? DEFAULT_OUTER_IOU), `floor ${i} polygon IoU=${pct(iou)}`);
      } else {
        const iou = bboxIou(bboxOf(outer.overlay), truth.floors[i]);
        check(iou >= 0.9, `floor ${i} bbox IoU=${pct(iou)}`);
      }
    }
  }
  if (truth?.outerAreaSqFt && ppf) {
    const area = outerAreaPx / (ppf * ppf);
    const err = Math.abs(area - truth.outerAreaSqFt) / truth.outerAreaSqFt;
    check(err <= (truth.areaTolerance ?? 0.05),
      `outer area ${area.toFixed(1)} vs ${truth.outerAreaSqFt} sq ft (err ${pct(err)})`);
  }
  if (truth?.innerAreaSqFt && ppf) {
    if (!result.inner) check(false, 'inner: not produced');
    else {
      const area = ringSetArea(result.inner.polygon, result.innerHoles ?? []) / (ppf * ppf);
      const err = Math.abs(area - truth.innerAreaSqFt) / truth.innerAreaSqFt;
      check(err <= (truth.areaTolerance ?? 0.05),
        `inner area ${area.toFixed(1)} vs ${truth.innerAreaSqFt} sq ft (err ${pct(err)})`);
    }
  }
  if (truth?.minConfidence !== undefined) {
    const confidence = result.quality?.confidence ?? 0;
    check(confidence >= truth.minConfidence,
      `confidence ${(confidence * 100).toFixed(0)}% >= ${(truth.minConfidence * 100).toFixed(0)}%`);
  }
  return { checks, lines };
};

const scoreRoom = (result, room, ppf) => {
  if (!result) return { pass: false, scored: true, line: `   MISS  ${room.name}: no result` };
  const det = bboxOf(result.overlay);
  const detStr = `bbox=[${det.map((v) => v.toFixed(0)).join(', ')}] conf=${result.confidence.toFixed(2)}`;
  if (room.rect) {
    const iou = bboxIou(det, room.rect);
    const ok = iou >= (room.minIou ?? 0.75);
    return { pass: ok, scored: true, line: `   ${ok ? 'HIT ' : 'MISS'}  ${room.name}: IoU=${pct(iou)} ${detStr}` };
  }
  if (room.areaSqFt && ppf) {
    const area = (det[2] - det[0]) * (det[3] - det[1]) / (ppf * ppf);
    const err = Math.abs(area - room.areaSqFt) / room.areaSqFt;
    const ok = err <= 0.1;
    return { pass: ok, scored: true, line: `   ${ok ? 'HIT ' : 'MISS'}  ${room.name}: area ${area.toFixed(1)} vs ${room.areaSqFt} (err ${pct(err)}) ${detStr}` };
  }
  // Unscored rooms are reported, never counted: an auto-passing check is
  // indistinguishable from a real one in the total.
  return { pass: true, scored: false, line: `   ----  ${room.name}: ${detStr} (no truth to score)` };
};

const collectTargets = (args) => {
  const files = [];
  const targets = args.length ? args : [path.join(ROOT, 'fixtures')];
  for (const arg of targets) {
    const resolved = path.resolve(arg);
    const stat = fs.statSync(resolved);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(resolved).sort()) {
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
  const args = process.argv.slice(2).filter((a) => a !== '--json');
  const asJson = process.argv.includes('--json');
  const targets = collectTargets(args);
  let totalPass = 0;
  let totalChecks = 0;
  const report = [];

  for (const { file, truth } of targets) {
    const out = [];
    out.push(`\n=== ${path.basename(file)} ===`);
    const imageData = loadPng(file);
    out.push(`   ${imageData.width}x${imageData.height}px`);
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
    out.push(`   boundary: ${boundaryMs}ms  ${boundary?.outer ? `sealRadius=${boundary.debug.sealRadius} wallThickness=${boundary.debug.wallThickness} extThickness=${boundary.debug.exteriorThickness} excluded=${boundary.excludedRegions}${boundary.debug.usedFallback ? ' (fallback)' : ''}` : 'FAILED'}`);
    const bScore = scoreBoundary(boundary, truth?.boundary, ppf);
    out.push(...bScore.lines);
    if (truth?.boundary?.note) out.push(`   note: ${truth.boundary.note}`);
    if (truth?.boundary) {
      for (const ok of bScore.checks) {
        totalChecks += 1;
        if (ok) totalPass += 1;
      }
    }

    // The same trace as the app actually runs it: after a scan the store holds
    // every parsed dimension label, and every one of them is handed to the
    // tracer as a point known to be inside the building. That changes which
    // candidate wins, and it is what arms second-chance tracing (remediate.js),
    // so a benchmark that never supplies them was not measuring the app's path.
    // Scored against the same truth, and reported separately, so a difference
    // between the two runs is visible rather than averaged away.
    const labelPoints = (truth?.rooms ?? [])
      .filter((room) => Array.isArray(room.click))
      .map((room) => ({ x: room.click[0], y: room.click[1], name: room.name ?? null }));
    if (truth?.boundary && labelPoints.length) {
      const c0 = Date.now();
      const constrained = traceFloorplanBoundaryCore(imageData, {
        ...boundaryOpts,
        constraints: { rooms: [], interiorPoints: labelPoints },
      });
      const remediation = constrained?.quality?.remediation;
      out.push(`   constrained (${labelPoints.length} known rooms): ${Date.now() - c0}ms`
        + (remediation
          ? `  retried [${remediation.passes.map((p) => p.pass).join(', ')}] -> `
            + `${remediation.accepted ?? 'kept first'} `
            + `(held ${remediation.before.held}->${remediation.after.held}/${remediation.after.of})`
          : '  no retry needed'));
      const cScore = scoreBoundary(constrained, truth.boundary, ppf);
      out.push(...cScore.lines.map((l) => l.replace(/^   /, '   c ')));
      for (const ok of cScore.checks) {
        totalChecks += 1;
        if (ok) totalPass += 1;
      }
    }

    // Rooms are placed in order and each one feeds the next, exactly as the
    // app does it (App.jsx roomScaleHint): scoring every room against a blank
    // project measured a flow the user never has after the first click.
    const roomResults = [];
    const scaleSamples = [];
    for (const room of truth?.rooms ?? []) {
      const robust = scaleSamples.length >= 4 ? robustScale(scaleSamples) : null;
      const hint = robust && robust.spread <= 2 ? { x: robust.value, y: robust.value } : null;
      const opts = {
        labelBbox: room.labelBbox
          ? { x: room.labelBbox[0], y: room.labelBbox[1], width: room.labelBbox[2], height: room.labelBbox[3] }
          : undefined,
        labelDims: room.dims ? { width: room.dims[0], height: room.dims[1] } : undefined,
        pixelsPerFoot: hint,
      };
      const t1 = Date.now();
      const result = detectRoomFromClickCore(imageData, { x: room.click[0], y: room.click[1] }, opts);
      const ms = Date.now() - t1;
      if (result?.pixelsPerFoot) scaleSamples.push(result.pixelsPerFoot.x, result.pixelsPerFoot.y);
      const score = scoreRoom(result, room, ppf);
      out.push(`${score.line}  (${ms}ms)`);
      roomResults.push({ name: room.name, pass: score.pass, scored: score.scored });
      if (score.scored) {
        totalChecks += 1;
        if (score.pass) totalPass += 1;
      }
    }

    report.push({
      file: path.basename(file),
      boundaryMs,
      confidence: boundary?.quality?.confidence ?? 0,
      warnings: (boundary?.quality?.warnings ?? []).map((w) => w.code),
      boundaryChecks: bScore.checks,
      rooms: roomResults,
      outerAreaPx: boundary?.outer ? polygonArea(boundary.outer.polygon) : 0,
    });
    if (!asJson) for (const line of out) console.log(line);
  }

  if (asJson) {
    console.log(JSON.stringify({ totalPass, totalChecks, report }, null, 2));
  } else {
    console.log(`\n=== TOTAL: ${totalPass}/${totalChecks} checks passed ===`);
  }
  if (totalChecks > 0 && totalPass < totalChecks) process.exitCode = 1;
};

run();
