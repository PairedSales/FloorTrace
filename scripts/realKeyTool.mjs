/**
 * Drawing and reviewing the real set's answer keys (datasets/README.md).
 *
 * A key is drawn by looking at crops of the plan at full zoom, writing each
 * outline's corners roughly, and letting `snap` move every edge to the outer
 * face of the wall band the ink shows (lib/keySnap.mjs says how). Draw from
 * the ink, not from the app's draft trace: compare with the draft only after
 * the key is drawn, with `view --poly`.
 *
 * Usage:  node scripts/realKeyTool.mjs COMMAND ...
 *   view NAME|IMAGE [--crop X0,Y0,X1,Y1] [--grid STEP] [--poly FILE] [--bare]
 *       A PNG of the plan (or of the crop, scaled to about 1,400 px on its
 *       long side) under datasets/zz-scratch/views/, with a grid in image
 *       pixels every STEP px (default 100), the plan's keys (solid, coloured
 *       by type, a dot on each vertex), the app's draft trace (dashed red),
 *       and any outlines in FILE (dotted black). IMAGE is an image file, so a
 *       crop can be chosen before a plan is drafted. --bare leaves out the
 *       keys and the draft trace: the ink alone, for drawing a key without
 *       the app's answer in front of you.
 *   snap NAME [--dry]
 *       Reads <set>/keys-wip/NAME.json, snaps it, prints each edge's move and
 *       writes NAME.snapped.json beside it. Without --dry it writes the key
 *       into the plan, with the record `{by: "Claude (draft for review)", at,
 *       notes}`. A key the user has checked is never replaced.
 *         {"notes": "…", "outlines": [{"type": "gla", "v": [[x, y], …],
 *           "fix": [edge…], "in": [edge…], "R": 14, "tilt": false}]}
 *       Edge i runs from v[i] to v[i+1]. `fix` edges stay as drawn, `in`
 *       edges take the band's inner face (a garage or porch edge along the
 *       house wall), `tilt` follows a scan-tilted wall, and a vertex written
 *       ["ref", k, i] is vertex i of outline k after it has snapped.
 *   sheet NAME... --out FILE [--per N]
 *       Review sheets for the user: each plan whole, with its key, its name,
 *       a legend of the types and its notes, N plans to an image (default 4).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { traceFloorplanBoundaryCore } from '../src/utils/detection/pipeline.js';
import { boundaryConstraints, nonGlaExcludeRegions } from '../src/utils/traceInputs.js';
import { DATASETS_DIR } from './lib/cubicasa.mjs';
import { applyPlan, keyOf } from './lib/realKeys.mjs';
import { snapOutlines } from './lib/keySnap.mjs';
import { decodeImage } from './lib/benchUtils.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SET_DIR = path.join(DATASETS_DIR, 'real');
const VIEWS_DIR = path.join(ROOT, 'datasets', 'zz-scratch', 'views');
const TYPE_COLORS = {
  gla: '#00a000',
  'below-grade': '#0a8f8f',
  garage: '#e08a00',
  porch: '#3b6eff',
  unfinished: '#8a8a8a',
};
const TYPE_LABELS = {
  gla: 'GLA',
  'below-grade': 'Below grade',
  garage: 'Garage',
  porch: 'Porch/patio',
  unfinished: 'Unfinished (not scored)',
};
const DRAFTER = 'Claude (draft for review)';

const parseArgs = (argv) => {
  const args = { command: argv[0], names: [], grid: 100, per: 4 };
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    if (['crop', 'grid', 'poly', 'out', 'per'].includes(arg.replace(/^--/, '')) && arg.startsWith('--')) {
      args[arg.slice(2)] = argv[i + 1];
      i += 1;
    } else if (arg === '--dry') args.dry = true;
    else if (arg === '--bare') args.bare = true;
    else args.names.push(arg);
  }
  args.grid = Number(args.grid);
  args.per = Number(args.per);
  if (args.crop) args.crop = args.crop.split(',').map(Number);
  return args;
};

const planFile = (name) => path.join(SET_DIR, `${name}.floorplan`);
const readPlan = (name) => JSON.parse(fs.readFileSync(planFile(name), 'utf8'));

const imageOf = async (project) => {
  const state = project.floors[0].state;
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(project.images?.[state.imageRef] ?? '');
  if (!match) throw new Error('the plan holds no image');
  return { image: await decodeImage(Buffer.from(match[2], 'base64'), match[1]), bytes: Buffer.from(match[2], 'base64') };
};

// The keys a plan holds, as `{type, v}`; none while its outlines are still the
// app's untouched trace.
const keysOf = (project) => (keyOf(project.floors[0].state) ?? []).map((o) => ({
  type: o.type,
  v: o.points,
  holes: o.holes,
}));

// The tracer as the app ran it after the scan: the draft under review.
const draftRings = (project, image) => {
  const state = project.floors[0].state;
  const result = traceFloorplanBoundaryCore(image, {
    excludeRegions: nonGlaExcludeRegions(state),
    constraints: boundaryConstraints(state),
  });
  const floors = result?.floors?.length
    ? result.floors.filter((f) => f.outer).map((f) => f.outer.polygon)
    : (result?.outer ? [result.outer.polygon] : []);
  return floors.map((ring) => ring.map((p) => [p.x, p.y]));
};

const trace = (g, ring, map, { close = true } = {}) => {
  g.beginPath();
  ring.forEach((p, i) => {
    const [x, y] = map(p);
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  });
  if (close) g.closePath();
};

const drawGrid = (g, box, scale, step) => {
  g.font = '12px sans-serif';
  const [x0, y0, x1, y1] = box;
  for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) {
    const major = x % (step * 5) === 0;
    g.strokeStyle = major ? 'rgba(200,0,0,0.5)' : 'rgba(0,80,200,0.35)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo((x - x0) * scale, 0);
    g.lineTo((x - x0) * scale, (y1 - y0) * scale);
    g.stroke();
    g.fillStyle = '#b00';
    g.fillText(String(x), (x - x0) * scale + 2, 11);
    g.fillText(String(x), (x - x0) * scale + 2, (y1 - y0) * scale - 3);
  }
  for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) {
    const major = y % (step * 5) === 0;
    g.strokeStyle = major ? 'rgba(200,0,0,0.5)' : 'rgba(0,80,200,0.35)';
    g.beginPath();
    g.moveTo(0, (y - y0) * scale);
    g.lineTo((x1 - x0) * scale, (y - y0) * scale);
    g.stroke();
    g.fillStyle = '#b00';
    g.fillText(String(y), 2, (y - y0) * scale - 2);
    g.fillText(String(y), (x1 - x0) * scale - 36, (y - y0) * scale - 2);
  }
};

const view = async (args) => {
  const [target] = args.names;
  let bytes;
  let keys = [];
  let draft = [];
  let label = path.basename(target).replace(/\.[^.]+$/, '');
  if (fs.existsSync(target)) {
    bytes = fs.readFileSync(target);
  } else {
    const project = readPlan(target);
    const { image, bytes: b } = await imageOf(project);
    bytes = b;
    if (!args.bare) {
      keys = keysOf(project);
      draft = draftRings(project, image);
    }
  }
  const img = await loadImage(bytes);
  const box = args.crop ?? [0, 0, img.width, img.height];
  const [x0, y0, x1, y1] = [Math.max(0, box[0]), Math.max(0, box[1]), Math.min(img.width, box[2]), Math.min(img.height, box[3])];
  const scale = 1400 / Math.max(x1 - x0, y1 - y0);
  const canvas = createCanvas(Math.ceil((x1 - x0) * scale), Math.ceil((y1 - y0) * scale));
  const g = canvas.getContext('2d');
  g.drawImage(img, x0, y0, x1 - x0, y1 - y0, 0, 0, canvas.width, canvas.height);
  drawGrid(g, [x0, y0, x1, y1], scale, args.grid);
  const map = ([x, y]) => [(x - x0) * scale, (y - y0) * scale];
  for (const ring of draft) {
    g.strokeStyle = '#e00000';
    g.lineWidth = 2;
    g.setLineDash([9, 6]);
    trace(g, ring, map);
    g.stroke();
  }
  g.setLineDash([]);
  for (const key of keys) {
    g.strokeStyle = TYPE_COLORS[key.type] ?? '#000';
    g.lineWidth = 2;
    trace(g, key.v, map);
    g.stroke();
    g.fillStyle = TYPE_COLORS[key.type] ?? '#000';
    for (const p of key.v) {
      const [x, y] = map(p);
      g.beginPath();
      g.arc(x, y, 3.5, 0, Math.PI * 2);
      g.fill();
    }
  }
  if (args.poly) {
    const file = JSON.parse(fs.readFileSync(args.poly, 'utf8'));
    for (const o of file.outlines ?? file) {
      const ring = (o.v ?? o.points).filter((p) => typeof p[0] === 'number');
      g.strokeStyle = '#000';
      g.lineWidth = 2;
      g.setLineDash([2, 4]);
      trace(g, ring, map);
      g.stroke();
    }
    g.setLineDash([]);
  }
  fs.mkdirSync(VIEWS_DIR, { recursive: true });
  const suffix = (args.bare ? '-bare' : '') + (args.crop ? `-${x0}_${y0}_${x1}_${y1}` : '');
  const out = path.join(VIEWS_DIR, `${label}${suffix}.png`);
  fs.writeFileSync(out, canvas.toBuffer('image/png'));
  console.log(out);
};

const wipFile = (name, ext = '.json') => path.join(SET_DIR, 'keys-wip', `${name}${ext}`);

// True while a plan's key is one of Claude's, unchecked: the only key `snap`
// may replace. A key with no record was saved from the app by the user, and
// one with `checked` was approved on a review sheet.
const replaceable = (project) => {
  if (!keyOf(project.floors[0].state)) return true;
  const record = project.answerKey;
  return Boolean(record) && String(record.by ?? '').startsWith('Claude') && !record.checked;
};

const snap = async (args) => {
  const [name] = args.names;
  const wip = JSON.parse(fs.readFileSync(wipFile(name), 'utf8'));
  const project = readPlan(name);
  const { image } = await imageOf(project);
  const snapped = snapOutlines(image, wip.outlines);
  let flagged = 0;
  snapped.forEach((o, k) => {
    console.log(`outline ${k} (${o.type}):`);
    for (const e of o.edges) {
      const note = e.fixed ? 'fixed' : `${e.moved >= 0 ? '+' : ''}${e.moved.toFixed(1)} px`;
      if (e.flag) flagged += 1;
      console.log(`  edge ${e.edge}: ${note}${e.flag ? `   <-- ${e.flag}: look at this edge at full zoom` : ''}`);
    }
    console.log(`  vertices: ${o.v.map((p) => `[${p[0].toFixed(1)},${p[1].toFixed(1)}]`).join(' ')}`);
  });
  const outlines = snapped.map((o) => ({ type: o.type, v: o.v.map((p) => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]) }));
  fs.writeFileSync(wipFile(name, '.snapped.json'), JSON.stringify({ outlines }));
  console.log(`${flagged} flagged edge(s); snapped outlines -> ${wipFile(name, '.snapped.json')}`);
  if (args.dry) return;
  if (!replaceable(project)) {
    throw new Error(`${name}'s key was checked by the user; it is not replaced. Fix it in the app, or ask the user.`);
  }
  const about = { by: DRAFTER, at: new Date().toISOString(), notes: wip.notes ?? '' };
  const result = applyPlan(project, outlines.map((o) => ({ type: o.type, points: o.v })), about, { force: true });
  project.metadata = { ...project.metadata, updatedAt: about.at };
  fs.writeFileSync(planFile(name), JSON.stringify(project));
  console.log(`${name}: ${result.outcome}. Run \`node scripts/realKeys.mjs export\` to refresh answer-keys.json.`);
};

const wrap = (g, text, width) => {
  const lines = [];
  let line = '';
  for (const word of String(text).split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (g.measureText(next).width > width && line) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
};

const sheet = async (args) => {
  if (!args.out || !args.names.length) throw new Error('usage: sheet NAME... --out FILE [--per N]');
  const CELL_W = 960;
  const IMG_H = 760;
  const NOTES_H = 190;
  const CELL_H = IMG_H + NOTES_H;
  const pages = [];
  for (let i = 0; i < args.names.length; i += args.per) pages.push(args.names.slice(i, i + args.per));
  const written = [];
  for (const [p, names] of pages.entries()) {
    const cols = names.length > 1 ? 2 : 1;
    const rows = Math.ceil(names.length / cols);
    const LEGEND_H = 44;
    const canvas = createCanvas(cols * CELL_W, LEGEND_H + rows * CELL_H);
    const g = canvas.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.font = 'bold 20px sans-serif';
    let lx = 14;
    for (const [type, color] of Object.entries(TYPE_COLORS)) {
      g.fillStyle = color;
      g.fillRect(lx, 12, 22, 18);
      g.fillStyle = '#000';
      g.fillText(TYPE_LABELS[type], lx + 30, 28);
      lx += 30 + g.measureText(TYPE_LABELS[type]).width + 26;
    }
    for (const [k, name] of names.entries()) {
      const ox = (k % cols) * CELL_W;
      const oy = LEGEND_H + Math.floor(k / cols) * CELL_H;
      const project = readPlan(name);
      const { bytes } = await imageOf(project);
      const img = await loadImage(bytes);
      const s = Math.min((CELL_W - 20) / img.width, (IMG_H - 50) / img.height);
      const dx = ox + (CELL_W - img.width * s) / 2;
      const dy = oy + 40;
      g.drawImage(img, dx, dy, img.width * s, img.height * s);
      const map = ([x, y]) => [dx + x * s, dy + y * s];
      for (const key of keysOf(project)) {
        const color = TYPE_COLORS[key.type] ?? '#000';
        trace(g, key.v, map);
        g.globalAlpha = 0.14;
        g.fillStyle = color;
        g.fill();
        g.globalAlpha = 1;
        g.strokeStyle = color;
        g.lineWidth = 3;
        g.stroke();
      }
      g.fillStyle = '#000';
      g.font = 'bold 26px sans-serif';
      g.fillText(name, ox + 12, oy + 30);
      const record = project.answerKey;
      g.font = '17px sans-serif';
      g.fillStyle = '#222';
      const notes = record?.notes ? record.notes : '(no notes)';
      wrap(g, notes, CELL_W - 28).slice(0, 8).forEach((line, i) => g.fillText(line, ox + 14, oy + IMG_H + 6 + i * 22));
      g.strokeStyle = '#999';
      g.lineWidth = 1;
      g.strokeRect(ox + 1, oy + 1, CELL_W - 2, CELL_H - 2);
    }
    const base = args.out.replace(/\.png$/i, '');
    const file = pages.length > 1 ? `${base}-${p + 1}.png` : `${base}.png`;
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    fs.writeFileSync(file, canvas.toBuffer('image/png'));
    written.push(file);
  }
  for (const file of written) console.log(file);
};

const COMMANDS = { view, snap, sheet };
const args = parseArgs(process.argv.slice(2));
if (!COMMANDS[args.command]) {
  console.error('usage: node scripts/realKeyTool.mjs view|snap|sheet ... (see the header of this file)');
  process.exitCode = 2;
} else {
  COMMANDS[args.command](args).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
