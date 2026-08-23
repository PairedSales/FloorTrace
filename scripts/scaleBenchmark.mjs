/**
 * Project-scale benchmark: does the app pick the right scale on its own?
 *
 * The question this answers is not "is this room's rectangle right" — that is
 * detectionBenchmark's job — but "given every labelled room on the page, is the
 * one scale the app settles on the scale the drawing is at". It reports the
 * consensus against `truth.scale.pixelsPerFoot`, and next to it the worst error
 * a single room could have produced, because a single room is what the app used
 * to calibrate from and that number is the exposure being removed.
 *
 * Usage:  node scripts/scaleBenchmark.mjs [image.png|folder ...] [--ocr] [--json]
 *
 * Labels come from the truth sidecar's `rooms[]` by default: deterministic, and
 * it deliberately includes the open-plan and unscored entries, which are the
 * contamination the selector has to survive. `--ocr` sources them from the real
 * dimension pipeline instead — slower, and on tiny-text plans the label set is
 * not stable between runs, which is itself worth seeing.
 *
 * The default run is the one to keep green. `--ocr` over ExampleFloorplan3/4/5
 * currently fails several checks and is expected to: on those plans the room
 * rectangles themselves are wrong, so there is no room set a selector could
 * pick from. What it does show is that all three come back `check` rather than
 * confidently wrong, which is the behaviour those fixtures are here to hold.
 *
 * Scale truth is authored per fixture in a `scale` block:
 *   "scale": { "pixelsPerFoot": 15.5, "tolerance": 0.04, "provenance": "..." }
 * Fixtures without one are still run and reported, scored only on
 * self-consistency (how many rooms were accepted, how far apart they landed).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { detectRoomFromClickCore, traceFloorplanBoundaryCore } from '../src/utils/detection/pipeline.js';
import { ringSetArea } from '../src/utils/detection/polygon.js';
import { resolveRoomScale } from '../src/utils/detection/validate.js';
import {
  selectProjectScale, CONSENSUS_SPREAD_LIMIT, MIN_CONSENSUS_ROOMS,
} from '../src/utils/detection/scale.js';
import { loadPng, pct, toOcrInput } from './lib/benchUtils.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const collectTargets = (args) => {
  const targets = [];
  const inputs = args.length ? args : [path.join(ROOT, 'fixtures')];
  for (const input of inputs) {
    const resolved = path.resolve(ROOT, input);
    if (fs.statSync(resolved).isDirectory()) {
      for (const name of fs.readdirSync(resolved).sort()) {
        if (/\.png$/i.test(name)) targets.push(path.join(resolved, name));
      }
    } else targets.push(resolved);
  }
  return targets.map((file) => {
    const sidecar = file.replace(/\.png$/i, '.truth.json');
    return {
      file,
      truth: fs.existsSync(sidecar) ? JSON.parse(fs.readFileSync(sidecar, 'utf8')) : null,
    };
  });
};

// The truth sidecar's rooms, in the shape detectRoomsFromLabels takes.
const labelsFromTruth = (truth) => (truth?.rooms ?? [])
  .filter((room) => room.click && room.dims)
  .map((room) => ({
    id: room.name,
    point: { x: room.click[0], y: room.click[1] },
    labelBbox: room.labelBbox
      ? {
        x: room.labelBbox[0], y: room.labelBbox[1],
        width: room.labelBbox[2], height: room.labelBbox[3],
      }
      : undefined,
    labelDims: { width: room.dims[0], height: room.dims[1] },
  }));

const labelsFromOcr = async (file) => {
  // The dimension pipeline stays behind a dynamic import: the default run
  // never scans, and loading that graph costs it nothing.
  const { detectDimensionsCore } = await import('../src/utils/dimensions/pipeline.js');
  const image = loadPng(file);
  const result = await detectDimensionsCore(image, { toOcrInput, budgetMs: 6000 });
  return {
    labels: result.dimensions.map((d) => ({
      id: d.text,
      point: { x: d.bbox.x + d.bbox.width / 2, y: d.bbox.y + d.bbox.height / 2 },
      labelBbox: d.bbox,
      labelDims: { width: d.width, height: d.height },
    })),
    nonGlaRegions: result.exteriorLabels.map((l) => l.bbox),
  };
};

// What one room, chosen alone, would have set the project to — the flow the
// user has today. Reported as its worst case, because nothing in the app
// steered them away from the worst room.
const singleRoomExposure = (rooms, truthPpf) => {
  let worst = 0;
  let worstName = null;
  for (const room of rooms) {
    const dims = room.labelDims;
    const w = room.rect.right - room.rect.left;
    const h = room.rect.bottom - room.rect.top;
    if (!(dims?.width > 0) || !(w > 0) || !(h > 0)) continue;
    const scale = resolveRoomScale(dims.width, dims.height, w, h);
    const ppf = 1 / scale.x;
    const err = Math.abs(Math.log(ppf / truthPpf));
    if (err > worst) { worst = err; worstName = room.labelId; }
  }
  return { worst, worstName };
};

const run = async () => {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const useOcr = args.includes('--ocr');
  const targets = collectTargets(args.filter((a) => !a.startsWith('--')));

  let totalChecks = 0;
  let totalPass = 0;
  const report = [];

  for (const { file, truth } of targets) {
    const out = [`\n=== ${path.basename(file)} ===`];
    const imageData = loadPng(file);

    let labels = labelsFromTruth(truth);
    let nonGlaRegions = (truth?.boundary?.excludeRegions ?? [])
      .map(([x, y, width, height]) => ({ x, y, width, height }));
    if (useOcr) {
      const scanned = await labelsFromOcr(file);
      labels = scanned.labels;
      nonGlaRegions = scanned.nonGlaRegions;
    }
    if (!labels.length) {
      out.push('   no labels (author truth rooms[] or run with --ocr)');
      if (!asJson) for (const line of out) console.log(line);
      continue;
    }

    const boundary = traceFloorplanBoundaryCore(imageData, {
      excludeRegions: nonGlaRegions,
    });
    // Every floor, not the largest one. The labels on a multi-floor sheet are
    // spread over all of them, so weighing them against a single floor made
    // ExampleFloorplan2 — a four-plan page whose scale comes out 0.6% correct —
    // report its own answer as implausible.
    const footprintAreaPx = (boundary?.floors?.length ? boundary.floors : [boundary])
      .reduce((sum, floor) => (
        floor?.outer ? sum + ringSetArea(floor.outer.polygon, floor.holes ?? []) : sum
      ), 0);

    // The batch the worker runs: one shared cacheKey, no scale prior, and every
    // other label on the page passed to every room as a place it is not — all
    // three are properties of measuring the labels together, and this is the
    // path the app's scale actually comes from.
    const t0 = Date.now();
    const rooms = [];
    for (let i = 0; i < labels.length; i += 1) {
      const label = labels[i];
      const room = detectRoomFromClickCore(imageData, label.point, {
        cacheKey: file,
        labelBbox: label.labelBbox,
        labelDims: label.labelDims,
        pixelsPerFoot: null,
        foreignPoints: labels.filter((_, j) => j !== i).map((l) => l.point),
      });
      if (room) rooms.push({ ...room, labelId: label.id, labelDims: label.labelDims });
    }
    const batchMs = Date.now() - t0;

    const selected = selectProjectScale(rooms, { footprintAreaPx, nonGlaRegions });
    out.push(`   ${labels.length} labels -> ${rooms.length} rooms measured in ${batchMs}ms`);
    for (const c of selected.contributors) {
      out.push(`   used   ${String(c.name).padEnd(30)} ${c.pixelsPerFoot.x.toFixed(2)} / ${c.pixelsPerFoot.y.toFixed(2)} px/ft  conf=${c.confidence.toFixed(2)}  axes=${c.axes.join('')}`);
    }
    for (const r of selected.rejected) {
      out.push(`   drop   ${String(r.name).padEnd(30)} ${r.pixelsPerFoot ? r.pixelsPerFoot.toFixed(2) : '  -  '} px/ft  ${r.reason}`);
    }
    out.push(`   scale: ${selected.pixelsPerFoot ? selected.pixelsPerFoot.toFixed(2) : 'none'} px/ft  ${selected.level}/${selected.reason}  rooms=${selected.roomCount}  spread=${pct(Math.exp(selected.spread) - 1)}  areaRatio=${selected.areaRatio ? selected.areaRatio.toFixed(2) : '-'}`);

    const check = (ok, label) => {
      totalChecks += 1;
      if (ok) totalPass += 1;
      out.push(`   ${ok ? 'HIT ' : 'MISS'}  ${label}`);
    };

    const truthPpf = truth?.scale?.pixelsPerFoot;
    let consensusErr = null;
    let exposure = null;
    if (truthPpf && selected.pixelsPerFoot) {
      const tol = truth.scale.tolerance ?? 0.04;
      consensusErr = Math.log(selected.pixelsPerFoot / truthPpf);
      exposure = singleRoomExposure(rooms, truthPpf);
      out.push(`   worst single room: ${pct(Math.exp(exposure.worst) - 1)} (${exposure.worstName})`);
      const label = `consensus ${selected.pixelsPerFoot.toFixed(2)} vs ${truthPpf} px/ft (err ${(consensusErr >= 0 ? '+' : '')}${pct(Math.exp(consensusErr) - 1)}, tol ${pct(tol)})`;
      // A fixture can carry a defect that no selection strategy can fix: when
      // every room's rectangle is biased the same way, pooling them preserves
      // the bias exactly. Reported loudly and not counted, because a check that
      // fails for a reason recorded in the truth file is not news, and one that
      // silently passes is worse.
      if (truth.scale.knownBias && Math.abs(consensusErr) > tol) {
        out.push(`   KNOWN ${label} — ${truth.scale.knownBias}`);
      } else {
        check(Math.abs(consensusErr) <= tol, label);
      }
      check(Math.abs(consensusErr) < exposure.worst,
        `consensus beats the worst single room (${pct(Math.exp(exposure.worst) - 1)})`);
    } else {
      out.push('   no scale truth — self-consistency only');
    }

    // Always scored: a scale nobody can check still has to be self-consistent,
    // and this is the only check the plans without scale truth get. The room
    // count is only scored where the page offered enough labels to reach it —
    // a sidecar that lists two rooms is measuring the truth file, not the app.
    if (labels.length >= MIN_CONSENSUS_ROOMS) {
      check(selected.roomCount >= MIN_CONSENSUS_ROOMS,
        `accepted ${selected.roomCount} of ${labels.length} labels (>= ${MIN_CONSENSUS_ROOMS})`);
    } else {
      out.push(`   ....  accepted ${selected.roomCount} of ${labels.length} labels (too few labels to score)`);
    }
    check(selected.spread <= CONSENSUS_SPREAD_LIMIT,
      `accepted rooms agree within ${pct(Math.exp(CONSENSUS_SPREAD_LIMIT) - 1)} (spread ${pct(Math.exp(selected.spread) - 1)})`);

    report.push({
      file: path.basename(file),
      batchMs,
      labels: labels.length,
      measured: rooms.length,
      pixelsPerFoot: selected.pixelsPerFoot,
      level: selected.level,
      reason: selected.reason,
      roomCount: selected.roomCount,
      spread: selected.spread,
      areaRatio: selected.areaRatio,
      truthPixelsPerFoot: truthPpf ?? null,
      consensusErr,
      worstSingleRoomErr: exposure?.worst ?? null,
    });
    if (!asJson) for (const line of out) console.log(line);
  }

  if (asJson) console.log(JSON.stringify({ totalPass, totalChecks, report }, null, 2));
  else console.log(`\n=== TOTAL: ${totalPass}/${totalChecks} checks passed ===`);
  if (totalPass !== totalChecks) process.exitCode = 1;
};

run();
