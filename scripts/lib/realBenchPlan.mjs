// One plan through `bench:real`: load it, replay the app's trace, score it,
// draw its overlay. The same code runs in the main process (`--jobs 1`) and in
// a worker (`--worker`), so a plan scores the same either way. Everything a
// plan yields is plain JSON, so it survives the trip from a worker unchanged.
import fs from 'fs';
import path from 'path';
import { PNG } from 'pngjs';
import { traceFloorplanBoundaryCore } from '../../src/utils/detection/pipeline.js';
import { boundaryConstraints, nonGlaExcludeRegions } from '../../src/utils/traceInputs.js';
import { loadPng } from './benchUtils.mjs';
import { keyCheck } from './manifest.mjs';
import { keyOf } from './realKeys.mjs';
import {
  BUILDING, answerKey, decodeDataUrl, scoreTrace,
} from './realScore.mjs';

// Google Drive backs the folders these write to up, and holds a file it is
// reading: on EBUSY or EPERM wait and try again.
export const writeFileRetry = (file, data, tries = 10) => {
  for (let attempt = 1; ; attempt += 1) {
    try {
      fs.writeFileSync(file, data);
      return;
    } catch (err) {
      if (attempt >= tries || !['EBUSY', 'EPERM', 'EACCES'].includes(err.code)) throw err;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250 * attempt);
    }
  }
};

const drawOverlay = (image, truth, result, file) => {
  const png = new PNG({ width: image.width, height: image.height });
  png.data = Buffer.from(image.data);
  const stroke = (ring, [r, g, b]) => {
    for (let i = 0; i < ring.length; i += 1) {
      const a = ring[i];
      const z = ring[(i + 1) % ring.length];
      const [ax, ay] = Array.isArray(a) ? a : [a.x, a.y];
      const [bx, by] = Array.isArray(z) ? z : [z.x, z.y];
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
  for (const outline of truth.outlines) stroke(outline.vertices, BUILDING.has(outline.type) ? [0, 170, 0] : [60, 110, 255]);
  for (const ring of result.bare.rings) stroke(ring, [255, 150, 0]);
  for (const ring of result.app.rings) stroke(ring, [230, 0, 0]);
  writeFileRetry(file, PNG.sync.write(png));
};

// A saved project: its image, its corrected outlines, and the inputs the app
// gave the tracer after the scan. `expectKey` is the manifest's fingerprint of
// the plan's key: a key that is not the one frozen is not scored, and it is
// checked before anything else so that a key which has gone reads as a change,
// not as a plan waiting for one.
const loadProject = async (file, expectKey = null) => {
  const project = JSON.parse(fs.readFileSync(file, 'utf8'));
  const state = project.floors?.[0]?.state;
  const key = state ? keyOf(state) : null;
  const changed = keyCheck(expectKey, key);
  if (changed) throw new Error(changed);
  if (!state) return { skipped: 'no plan in the file' };
  if (!key) return { skipped: "no answer key yet: the outlines are the app's own trace" };
  return {
    image: await decodeDataUrl(project.images?.[state.imageRef]),
    outlines: (state.perimeterTraces ?? []).filter((t) => t.closed && t.vertices?.length >= 3),
    bareInputs: {},
    appInputs: { excludeRegions: nonGlaExcludeRegions(state), constraints: boundaryConstraints(state) },
    about: {
      labels: (state.detectedDimensions ?? []).length,
      nonGlaLabels: (state.exteriorLabels ?? []).length,
      scaleSource: state.calibration?.quality?.source ?? (state.calibration?.calibrated ? 'unknown' : null),
    },
  };
};

// A fixture with a polygon truth, traced as bench:detection traces it: its
// porch/patio label boxes excluded in both runs, and its room clicks as known
// rooms in the app run.
const loadFixture = (truthFile) => {
  const truth = JSON.parse(fs.readFileSync(truthFile, 'utf8'));
  const polygons = truth.boundary?.floorPolygons
    ?? (truth.boundary?.outerPolygon ? [truth.boundary.outerPolygon] : []);
  if (!polygons.length) return { skipped: 'no polygon truth' };
  // A floor without one would score its own trace as excess.
  if (!polygons.every(Array.isArray)) return { skipped: 'a floor has no polygon truth' };
  const excludeRegions = (truth.boundary.excludeRegions ?? [])
    .map(([x, y, w, h]) => ({ x, y, width: w, height: h }));
  const interiorPoints = (truth.rooms ?? []).filter((r) => Array.isArray(r.click))
    .map((r) => ({ x: r.click[0], y: r.click[1], name: r.name ?? null }));
  return {
    image: loadPng(truthFile.replace(/\.truth\.json$/, '.png')),
    outlines: polygons.map((poly) => ({ type: 'gla', vertices: poly.map(([x, y]) => ({ x, y })) })),
    bareInputs: excludeRegions.length ? { excludeRegions } : {},
    appInputs: { excludeRegions, constraints: { rooms: [], interiorPoints } },
    about: { labels: interiorPoints.length, nonGlaLabels: excludeRegions.length, scaleSource: 'truth' },
  };
};

// `drawDir`: where the overlay goes, or null for none.
const evaluate = (name, plan, drawDir) => {
  if (plan.skipped) return { name, skipped: plan.skipped };
  const { image } = plan;
  const truth = answerKey(plan.outlines, image);
  if (!truth.cells) return { name, skipped: 'no GLA outline to hold the trace against' };
  let t = Date.now();
  const bare = scoreTrace(traceFloorplanBoundaryCore(image, plan.bareInputs), truth, Date.now() - t);
  t = Date.now();
  const app = scoreTrace(traceFloorplanBoundaryCore(image, plan.appInputs), truth, Date.now() - t);
  const result = {
    name,
    size: [image.width, image.height],
    outlines: truth.outlines.map((o) => o.type),
    ...plan.about,
    bare,
    app,
  };
  if (drawDir) {
    fs.mkdirSync(drawDir, { recursive: true });
    drawOverlay(image, truth, result, path.join(drawDir, `${name}.png`));
  }
  return result;
};

/**
 * A job: `{name, kind: 'project'|'fixture', file, expectKey?, drawDir?}`.
 * Never throws: a plan that cannot be scored is `{name, error}`, and the run
 * goes on. The result is JSON-normalised, so a serial run and a worker's
 * report read the same (a value JSON cannot hold is dropped or nulled in both).
 */
export const runPlan = async (job) => {
  try {
    const plan = job.kind === 'fixture' ? loadFixture(job.file) : await loadProject(job.file, job.expectKey ?? null);
    return JSON.parse(JSON.stringify(evaluate(job.name, plan, job.drawDir ?? null)));
  } catch (err) {
    return { name: job.name, error: String(err?.message ?? err) };
  }
};
