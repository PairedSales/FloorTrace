/**
 * Real listing plans: the tracer against outlines a person has checked.
 *
 * Each `.floorplan` in the folder is one plan. To make one: open the plan in
 * FloorTrace and let it scan and trace; correct every outline to the exterior
 * face of the walls, set each outline's type (GLA, garage, porch/patio…), and
 * save the project. The saved image is the input and the corrected outlines
 * are the answer key. The labels the scan read are what the app handed the
 * tracer, so the app's own trace is replayed exactly — `utils/traceInputs.js`
 * builds its inputs here as in the app — and is judged by the same verdict as
 * CubiCasa5K (`lib/verdict.mjs`). CubiCasa is Finnish drawings; this is the
 * scoreboard on the plans FloorTrace is for.
 *
 * Usage:  npm run bench:real -- [options]
 *   --dir PATH       the .floorplan files (default datasets/real/, beside CubiCasa)
 *   --fixtures       also the plans in fixtures/ with a polygon truth, traced
 *                    the way bench:detection's constrained run traces them
 *   --out NAME       results file (default latest), under datasets/real_runs/
 *   --compare NAME   per-plan verdict moves against an earlier results file
 *   --draw           an overlay per plan: truth green, app red, bare orange
 *
 * Answer key: GLA and below-grade outlines are the building (a basement is
 * still traced; its type decides the total, not the tracer), garage and
 * porch/patio outlines are non-GLA, unfinished outlines are not scored. A hole
 * is subtracted unless it is stale.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PNG } from 'pngjs';
import { traceFloorplanBoundaryCore } from '../src/utils/detection/pipeline.js';
import { boundaryConstraints, nonGlaExcludeRegions } from '../src/utils/traceInputs.js';
import { decodeImage, loadPng } from './lib/benchUtils.mjs';
import { DATASETS_DIR, fillPolygon } from './lib/cubicasa.mjs';
import {
  VERDICTS, pct, scoreMask, scoreboardLines,
} from './lib/verdict.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUNS_DIR = path.join(DATASETS_DIR, 'real_runs');
const CELL = 2;
const BUILDING = new Set(['gla', 'below-grade']);
const NON_GLA = new Set(['garage', 'porch']);
const UNSCORED = new Set(['unfinished']);

const parseArgs = (argv) => {
  const args = { dir: path.join(DATASETS_DIR, 'real'), out: 'latest' };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i].replace(/^--/, '');
    if (['dir', 'out', 'compare'].includes(key)) {
      args[key] = argv[i + 1];
      i += 1;
    } else if (key === 'draw') args.draw = true;
    else if (key === 'fixtures') args.fixtures = true;
  }
  return args;
};

// The saved image as `{width, height, data}`.
const decodeDataUrl = (dataUrl) => {
  const match = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(dataUrl ?? '');
  if (!match) throw new Error('the project holds no image');
  return decodeImage(Buffer.from(match[3], match[2] ? 'base64' : 'utf8'), match[1]);
};

const holeRing = (hole) => (Array.isArray(hole) ? hole : hole?.ring);

const answerKey = (traces, image) => {
  const width = Math.ceil(image.width / CELL);
  const height = Math.ceil(image.height / CELL);
  const footprint = new Uint8Array(width * height);
  const nonGla = new Uint8Array(width * height);
  const ignore = new Uint8Array(width * height);
  const paint = (mask, trace) => {
    fillPolygon(mask, width, height, trace.vertices, { cell: CELL });
    for (const hole of trace.holes ?? []) {
      if (hole?.stale || !(holeRing(hole)?.length >= 3)) continue;
      fillPolygon(mask, width, height, holeRing(hole), { cell: CELL, value: 0 });
    }
  };
  for (const trace of traces) {
    const type = trace.type ?? 'gla';
    if (BUILDING.has(type)) paint(footprint, trace);
    else if (NON_GLA.has(type)) paint(nonGla, trace);
    else if (UNSCORED.has(type)) paint(ignore, trace);
  }
  let cells = 0;
  for (let i = 0; i < footprint.length; i += 1) cells += footprint[i];
  return {
    grid: { width, height, cell: CELL },
    footprint,
    nonGla,
    ignore,
    cells,
    outlines: traces.map((t) => ({ type: t.type ?? 'gla', vertices: t.vertices })),
  };
};

const tracedMask = (result, truth) => {
  const { width, height, cell } = truth.grid;
  const mask = new Uint8Array(width * height);
  const floors = result?.floors?.length
    ? result.floors.filter((f) => f.outer).map((f) => ({ outer: f.outer.polygon, holes: f.holes ?? [] }))
    : (result?.outer ? [{ outer: result.outer.polygon, holes: result.holes ?? [] }] : []);
  for (const floor of floors) {
    fillPolygon(mask, width, height, floor.outer, { cell });
    for (const hole of floor.holes) fillPolygon(mask, width, height, hole, { cell, value: 0 });
  }
  return { mask, floors };
};

const scoreTrace = (result, truth, ms) => {
  const { mask, floors } = tracedMask(result, truth);
  return {
    ...scoreMask(mask, truth),
    floors: floors.length,
    confidence: Number((result?.quality?.confidence ?? 0).toFixed(3)),
    warnings: [...new Set((result?.quality?.warnings ?? [])
      .filter((w) => w.severity !== 'info')
      .map((w) => w.code))],
    ms,
    rings: floors.map((f) => f.outer.map((p) => [Math.round(p.x), Math.round(p.y)])),
  };
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
  fs.writeFileSync(file, PNG.sync.write(png));
};

// A saved project: its image, its corrected outlines, and the inputs the app
// gave the tracer after the scan.
const loadProject = async (file) => {
  const project = JSON.parse(fs.readFileSync(file, 'utf8'));
  const state = project.floors?.[0]?.state;
  if (!state) return { skipped: 'no plan in the file' };
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

const evaluate = (name, plan, args) => {
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
  if (args.draw) {
    const dir = path.join(RUNS_DIR, args.out);
    fs.mkdirSync(dir, { recursive: true });
    drawOverlay(image, truth, result, path.join(dir, `${name}.png`));
  }
  return result;
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const files = fs.existsSync(args.dir)
    ? fs.readdirSync(args.dir).filter((f) => f.endsWith('.floorplan')).sort().map((f) => path.join(args.dir, f))
    : [];
  const fixtureDir = path.join(ROOT, 'fixtures');
  const fixtures = args.fixtures
    ? fs.readdirSync(fixtureDir).filter((f) => f.endsWith('.truth.json')).sort()
      .map((f) => path.join(fixtureDir, f))
    : [];
  if (!files.length && !fixtures.length) {
    console.error(`No .floorplan files in ${args.dir}. Open a plan in FloorTrace, correct its outlines,`
      + ' set their types and save the project there — see datasets/README.md. --fixtures scores fixtures/.');
    process.exitCode = 2;
    return;
  }
  const results = [];
  const run = async (name, load) => {
    try {
      results.push(evaluate(name, await load(), args));
    } catch (err) {
      results.push({ name, error: String(err?.message ?? err) });
    }
  };
  for (const file of files) await run(path.basename(file, '.floorplan'), () => loadProject(file));
  for (const file of fixtures) await run(`fixture:${path.basename(file, '.truth.json')}`, () => loadFixture(file));
  const scored = results.filter((r) => !r.skipped && !r.error);
  const lines = [`\n=== Real plans: ${scored.length} scored of ${results.length} ===`];
  if (scored.length) {
    lines.push(...scoreboardLines(scored, 'real plans'));
    lines.push(`   bare near-perfect ${pct(scored.filter((r) => r.bare.verdict !== 'wrong').length / scored.length)}`);
    lines.push('\nPer plan (app trace):');
    for (const r of scored) {
      lines.push(`   ${r.name.padEnd(32)} ${r.app.verdict.padEnd(7)} IoU ${pct(r.app.iou).padStart(6)}`
        + `  area ${(r.app.areaErr >= 0 ? '+' : '') + pct(r.app.areaErr)}  conf ${pct(r.app.confidence)}`
        + `  ${r.app.regions.map((g) => `${g.cause} ${pct(g.share)}`).join(', ')}`);
    }
  }
  for (const r of results.filter((x) => x.skipped || x.error)) lines.push(`   ${r.name}: ${r.skipped ?? `ERROR ${r.error}`}`);
  if (args.compare) {
    const baselineFile = path.join(RUNS_DIR, `${args.compare}.json`);
    if (fs.existsSync(baselineFile)) {
      const before = new Map(JSON.parse(fs.readFileSync(baselineFile, 'utf8')).results.map((r) => [r.name, r]));
      lines.push(`\n=== Against ${args.compare} ===`);
      for (const r of scored) {
        const b = before.get(r.name);
        if (!b?.app || b.app.verdict === r.app.verdict) continue;
        const moved = VERDICTS.indexOf(r.app.verdict) < VERDICTS.indexOf(b.app.verdict) ? 'better' : 'worse';
        lines.push(`   ${moved.padEnd(6)} ${r.name}: ${b.app.verdict} -> ${r.app.verdict}  IoU ${pct(b.app.iou)} -> ${pct(r.app.iou)}`);
      }
    } else lines.push(`\nno results named ${args.compare} to compare against`);
  }
  for (const line of lines) console.log(line);
  fs.mkdirSync(RUNS_DIR, { recursive: true });
  const outFile = path.join(RUNS_DIR, `${args.out}.json`);
  fs.writeFileSync(outFile, JSON.stringify({ meta: { date: new Date().toISOString(), dir: args.dir }, results }));
  console.log(`results: ${path.relative(ROOT, outFile).startsWith('..') ? outFile : path.relative(ROOT, outFile)}`);
};

main();
