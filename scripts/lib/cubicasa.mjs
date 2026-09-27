// CubiCasa5K for the Node harnesses: which plans exist, what each model.svg
// says, and the ground truth scripts/cubicasaBenchmark.mjs scores against.
//
// Everything here rests on two measured facts. An SVG unit is one centimetre:
// every room's own printed size divides out to 100 units/m on 4,968 of the
// 5,000 plans. And SVG coordinates are F1_scaled.png pixels: walls land on ink
// 94% of the time mapped directly, 61% when stretched to the SVG canvas. So
// F1_scaled.png is drawn at 30.48 px/ft, and every plan has a known area.
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import {
  dilateRect, openRect, floodOutside, labelComponents,
} from '../../src/utils/detection/raster.js';
import { loadPng } from './benchUtils.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// datasets/ is git-ignored and gigabytes, so it is downloaded once, into the
// main checkout, while most work happens in worktrees under .claude/worktrees/
// whose datasets/ holds only the README. $FLOORTRACE_DATASETS wins; then this
// checkout's datasets/ if the corpus is there; then the main checkout's, found
// through git's common directory. Saved runs live beside the corpus, so a
// baseline outlives the worktree that measured it.
const resolveDatasetsDir = () => {
  if (process.env.FLOORTRACE_DATASETS) return path.resolve(process.env.FLOORTRACE_DATASETS);
  const own = path.join(REPO_ROOT, 'datasets');
  if (fs.existsSync(path.join(own, 'cubicasa5k'))) return own;
  try {
    const common = execSync('git rev-parse --git-common-dir', {
      cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();
    const main = path.join(path.dirname(path.resolve(REPO_ROOT, common)), 'datasets');
    if (fs.existsSync(path.join(main, 'cubicasa5k'))) return main;
  } catch {
    // Not a git checkout; this checkout's datasets/ is the only candidate.
  }
  return own;
};

export const DATASETS_DIR = resolveDatasetsDir();
export const CUBICASA_ROOT = path.join(DATASETS_DIR, 'cubicasa5k', 'cubicasa5k');
export const PX_PER_FOOT = 30.48;
// Which answer key a run was scored against. Bump it whenever buildTruth
// changes what counts, so runs scored under different keys are never compared.
// 1: living is everything but Outdoor, Garage and CarPort. 2: outdoor names,
// sheds and outbuildings are non-GLA; untyped space is not scored.
export const TRUTH_VERSION = 2;
const SPLITS = ['train', 'val', 'test'];

// A fixed slice of train for the edit-and-measure loop: about two minutes
// where all of train takes fifteen, and weighted toward the listing-style
// categories, which an even spread of train would hand ~40 plans of 400.
const DEV_SLICE = { colorful: 100, high_quality: 150, high_quality_architectural: 150 };

// Truth-mask resolution, in image px per cell (2 cm).
const CELL = 2;
// A wall this close to living space bounds it. Finnish external walls run to
// ~60 cm, so less than that clips the outer face off the footprint.
const WALL_REACH_PX = 70;
// Opening radius that trims the stubs reach leaves where a balcony's or a
// garage's side walls meet the house. Anything a room could be survives it.
const STUB_PX = 20;
// Voids under 2 m² are slop where hand-drawn polygons fail to meet.
const MIN_VOID_PX = 20000;
// A label must sit this deep inside its room to be clicked where it is.
const DEEP_PX = 20;
// Share of its bounding box a room must fill to count as a rectangle.
const RECTANGULAR = 0.95;

const readSplit = (name, root) => fs.readFileSync(path.join(root, `${name}.txt`), 'utf8')
  .split(/\r?\n/)
  .map((line) => line.trim().replace(/^\/+|\/+$/g, ''))
  .filter(Boolean);

// An even spread of `count` from `ids`, the same plans every time.
export const evenSpread = (ids, count) => {
  if (!(count > 0) || ids.length <= count) return ids;
  const step = ids.length / count;
  return Array.from({ length: count }, (_, i) => ids[Math.floor(i * step)]);
};

export const listPlans = (split = 'test', root = CUBICASA_ROOT) => {
  if (split === 'dev') {
    const train = readSplit('train', root);
    return Object.entries(DEV_SLICE).flatMap(([category, count]) => evenSpread(
      train.filter((id) => id.startsWith(`${category}/`)), count,
    ));
  }
  return (split === 'all' ? SPLITS : [split]).flatMap((name) => readSplit(name, root));
};

const IDENTITY = [1, 0, 0, 1, 0, 0];

const compose = (m, n) => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];

const numbersIn = (text) => text.split(/[\s,]+/).filter(Boolean).map(Number);

const transformOf = (attrs) => {
  const value = /\btransform="([^"]*)"/.exec(attrs)?.[1];
  if (!value) return null;
  const matrix = /matrix\(([^)]*)\)/.exec(value);
  if (matrix) {
    const v = numbersIn(matrix[1]);
    return v.length === 6 && v.every(Number.isFinite) ? v : null;
  }
  const translate = /translate\(([^)]*)\)/.exec(value);
  if (translate) {
    const [tx = 0, ty = 0] = numbersIn(translate[1]);
    return [1, 0, 0, 1, tx, ty];
  }
  return null;
};

const pointsOf = (attrs, m) => {
  const raw = /\bpoints="([^"]*)"/.exec(attrs)?.[1];
  if (!raw) return null;
  const v = numbersIn(raw);
  const out = [];
  for (let i = 0; i + 1 < v.length; i += 2) {
    const x = m[0] * v[i] + m[2] * v[i + 1] + m[4];
    const y = m[1] * v[i] + m[3] * v[i + 1] + m[5];
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    out.push([x, y]);
  }
  return out.length >= 3 ? out : null;
};

const FEET_INCHES = /(\d+)'\s*(\d+)"\s*x\s*(\d+)'\s*(\d+)"/;

// Rooms (`Space …`) and walls, each with the outline polygon that is the
// group's own child, plus each room's label anchor, name and printed size.
export const parseModelSvg = (svg) => {
  const spaces = [];
  const walls = [];
  let floorCount = 0;
  const stack = [{ m: IDENTITY, kind: null, owner: null, floor: 0, role: null }];
  const tagRe = /<(\/?)([A-Za-z][\w:-]*)([^>]*?)(\/?)>/g;
  let match;
  while ((match = tagRe.exec(svg))) {
    const [, closing, tag, attrs, selfClosing] = match;
    if (tag !== 'g' && tag !== 'polygon' && tag !== 'text') continue;
    if (closing) {
      if (tag === 'g' && stack.length > 1) stack.pop();
      continue;
    }
    const top = stack[stack.length - 1];
    const t = transformOf(attrs);
    const m = t ? compose(top.m, t) : top.m;
    if (tag === 'polygon') {
      // Deeper polygons are dimension marks, door leaves and window panes.
      if ((top.kind === 'space' || top.kind === 'wall') && !top.owner.polygon) {
        top.owner.polygon = pointsOf(attrs, m);
      }
      continue;
    }
    if (tag === 'text') {
      const space = top.owner?.isSpace ? top.owner : null;
      const text = svg.slice(tagRe.lastIndex, svg.indexOf('<', tagRe.lastIndex)).trim();
      if (!space || !text) continue;
      if (top.role === 'name') space.name = text;
      else if (top.role === 'measure') {
        const ft = FEET_INCHES.exec(text);
        if (ft) space.dimsFt = [Number(ft[1]) + Number(ft[2]) / 12, Number(ft[3]) + Number(ft[4]) / 12];
      }
      continue;
    }
    const cls = /\bclass="([^"]*)"/.exec(attrs)?.[1]?.trim() ?? '';
    const frame = { m, kind: null, owner: top.owner, floor: top.floor, role: top.role };
    if (/^Floorplan\b/.test(cls)) {
      frame.floor = floorCount;
      floorCount += 1;
    } else if (/^Space\b/.test(cls)) {
      const space = {
        isSpace: true,
        type: cls.slice(5).trim(),
        floor: frame.floor,
        polygon: null,
        anchor: null,
        name: null,
        dimsFt: null,
      };
      spaces.push(space);
      frame.kind = 'space';
      frame.owner = space;
    } else if (/^Wall\b/.test(cls)) {
      const wall = { external: /\bExternal\b/.test(cls), floor: frame.floor, polygon: null };
      walls.push(wall);
      frame.kind = 'wall';
      frame.owner = wall;
    } else if (cls === 'SpaceDimensionsLabel' && top.owner?.isSpace) {
      top.owner.anchor = [m[4], m[5]];
    } else if (/\bNameLabel\b/.test(cls)) {
      frame.role = 'name';
    } else if (/\bDimensionMeasureLabel\b/.test(cls)) {
      frame.role = 'measure';
    }
    if (!selfClosing) stack.push(frame);
  }
  return {
    spaces: spaces.filter((s) => s.polygon),
    walls: walls.filter((w) => w.polygon),
    floorCount: Math.max(1, floorCount),
  };
};

const pointOf = (p) => (Array.isArray(p) ? p : [p.x, p.y]);

// Nonzero scanline fill at cell centres. Nonzero rather than even-odd because
// CubiCasa outlines are hand-edited and some fold back over themselves.
export const fillPolygon = (mask, width, height, polygon, {
  cell = 1, ox = 0, oy = 0, value = 1,
} = {}) => {
  const n = polygon.length;
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i += 1) {
    const [px, py] = pointOf(polygon[i]);
    xs[i] = (px - ox) / cell;
    ys[i] = (py - oy) / cell;
    if (ys[i] < minY) minY = ys[i];
    if (ys[i] > maxY) maxY = ys[i];
  }
  const rowFrom = Math.max(0, Math.ceil(minY - 0.5));
  const rowTo = Math.min(height - 1, Math.floor(maxY - 0.5));
  const hits = [];
  for (let row = rowFrom; row <= rowTo; row += 1) {
    const cy = row + 0.5;
    hits.length = 0;
    for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
      const y0 = ys[j];
      const y1 = ys[i];
      if ((y0 <= cy) === (y1 <= cy)) continue;
      hits.push({ x: xs[j] + ((cy - y0) / (y1 - y0)) * (xs[i] - xs[j]), dir: y1 > y0 ? 1 : -1 });
    }
    hits.sort((a, b) => a.x - b.x);
    let winding = 0;
    for (let k = 0; k < hits.length - 1; k += 1) {
      winding += hits[k].dir;
      if (!winding) continue;
      const a = Math.max(0, Math.ceil(hits[k].x - 0.5));
      const b = Math.min(width - 1, Math.floor(hits[k + 1].x - 0.5));
      if (b >= a) mask.fill(value, row * width + a, row * width + b + 1);
    }
  }
};

const boundsOf = (polygons) => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const poly of polygons) {
    for (const [x, y] of poly) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return { minX, minY, maxX, maxY };
};

const shoelace = (poly) => {
  let sum = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    sum += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
  }
  return Math.abs(sum) / 2;
};

// Two-pass chamfer distance to the nearest cell outside the mask.
const chamfer = (mask, w, h) => {
  const d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i += 1) d[i] = mask[i] ? 1e9 : 0;
  const diag = Math.SQRT2;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x;
      if (!d[i]) continue;
      let v = d[i];
      if (x > 0) v = Math.min(v, d[i - 1] + 1);
      if (y > 0) {
        v = Math.min(v, d[i - w] + 1);
        if (x > 0) v = Math.min(v, d[i - w - 1] + diag);
        if (x < w - 1) v = Math.min(v, d[i - w + 1] + diag);
      }
      d[i] = v;
    }
  }
  for (let y = h - 1; y >= 0; y -= 1) {
    for (let x = w - 1; x >= 0; x -= 1) {
      const i = y * w + x;
      if (!d[i]) continue;
      let v = d[i];
      if (x < w - 1) v = Math.min(v, d[i + 1] + 1);
      if (y < h - 1) {
        v = Math.min(v, d[i + w] + 1);
        if (x < w - 1) v = Math.min(v, d[i + w + 1] + diag);
        if (x > 0) v = Math.min(v, d[i + w - 1] + diag);
      }
      d[i] = v;
    }
  }
  return d;
};

// Where a click on this room's label lands: the label when it sits well
// inside the room, else the room's deepest point — CubiCasa parks some labels
// outside small rooms, and a click on a wall measures nothing.
const interiorPoint = (poly, preferred) => {
  const b = boundsOf([poly]);
  const ox = b.minX - CELL;
  const oy = b.minY - CELL;
  const w = Math.ceil((b.maxX - b.minX) / CELL) + 3;
  const h = Math.ceil((b.maxY - b.minY) / CELL) + 3;
  const mask = new Uint8Array(w * h);
  fillPolygon(mask, w, h, poly, { cell: CELL, ox, oy });
  const dist = chamfer(mask, w, h);
  const depthAt = ([x, y]) => {
    const gx = Math.floor((x - ox) / CELL);
    const gy = Math.floor((y - oy) / CELL);
    return gx >= 0 && gy >= 0 && gx < w && gy < h ? dist[gy * w + gx] * CELL : 0;
  };
  if (preferred && depthAt(preferred) >= DEEP_PX) return preferred;
  let best = 0;
  for (let i = 0; i < dist.length; i += 1) if (dist[i] > best) best = dist[i];
  if (!(best > 0)) return null;
  // The middle of the ridge rather than its first cell, so a rectangle is
  // clicked at its centre; an L whose ridge centre falls in the notch takes
  // the ridge's first cell instead.
  let sx = 0;
  let sy = 0;
  let n = 0;
  let first = -1;
  for (let i = 0; i < dist.length; i += 1) {
    if (dist[i] < best - 1) continue;
    if (first < 0) first = i;
    sx += i % w;
    sy += Math.floor(i / w);
    n += 1;
  }
  const centre = [ox + (sx / n + 0.5) * CELL, oy + (sy / n + 0.5) * CELL];
  if (depthAt(centre) >= (best * CELL) / 2) return centre;
  return [ox + ((first % w) + 0.5) * CELL, oy + (Math.floor(first / w) + 0.5) * CELL];
};

// What the answer key says each space is: living area, non-GLA, or unknown.
//
// Outdoor space, garages and carports are drawn on the plan but are not
// living area. Two more kinds are not either, whatever the annotation typed
// them as:
// - a space named as outdoor space. PATIO/TERASSI typed UserDefined and a lawn
//   (NURMIPIHAA) typed as a room counted as living area, and the tracer that
//   left them out was scored as missing a room.
// - an outbuilding: a shed or woodstore, or a storage room or sauna with no
//   other room within a wall's reach — a VARASTO reached across the terrace.
//   A US appraiser does not count a detached structure as GLA.
// `Undefined` spaces are ones the annotator never typed: usually a room,
// sometimes a glazed terrace (colorful/2581 has both, and nothing else). They
// are scored neither way.
const NON_GLA_TYPE = /^(Outdoor|Garage|CarPort)\b/;
const OUTDOOR_NAME = /PARVEKE|TERASSI|KUISTI|KATOS|PIHA|PATIO|VERANTA|VILPOLA|PERGOLA|LASITETTU|ULKOTILA|AUTOTALLI|AUTOSUOJA|AUTOVAJA/i;
const SHED = /^Storage (Shed|Wood|Fuel)\b/;
const SHED_NAME = /VAJA|AITTA|LIITERI|HALKOV/i;
const OUTBUILDING_TYPE = /^(Storage|Sauna|TechnicalRoom|Garbage)\b/;

// The word an English plan would print on it, for the exclusion vocabulary
// (`utils/dimensions/exteriorLabels.js`); null when a US plan would print none
// the app reads, which a shed is.
const keywordFor = (type, name = '') => {
  if (/^Garage\b/.test(type) || /AUTOTALLI|AUTOVAJA/i.test(name)) return 'GARAGE';
  if (/^CarPort\b/.test(type) || /AUTOSUOJA|AUTOKATOS/i.test(name)) return 'CARPORT';
  if (/Balcony/.test(type) || /PARVEKE|LASITETTU/i.test(name)) return 'BALCONY';
  if (/Terrace/.test(type) || /TERASSI/i.test(name)) return 'TERRACE';
  if (/Porch|CoveredArea/.test(type) || /KUISTI|VILPOLA|KATOS/i.test(name)) return 'PORCH';
  if (/Veranda/.test(type) || /VERANTA/i.test(name)) return 'VERANDA';
  if (/Pergola/.test(type) || /PERGOLA/i.test(name)) return 'PERGOLA';
  if (/^Outdoor\b/.test(type) || OUTDOOR_NAME.test(name)) return 'PATIO';
  return null;
};

// Distance between two polygons' outlines, 0 when they overlap; Infinity once
// their boxes are further apart than `limit`.
const segmentGap = ([ax, ay], [bx, by], [cx, cy], [dx, dy]) => {
  const pointSeg = (px, py, x0, y0, x1, y1) => {
    const vx = x1 - x0;
    const vy = y1 - y0;
    const t = Math.max(0, Math.min(1, ((px - x0) * vx + (py - y0) * vy) / (vx * vx + vy * vy || 1)));
    return Math.hypot(px - x0 - t * vx, py - y0 - t * vy);
  };
  return Math.min(
    pointSeg(ax, ay, cx, cy, dx, dy), pointSeg(bx, by, cx, cy, dx, dy),
    pointSeg(cx, cy, ax, ay, bx, by), pointSeg(dx, dy, ax, ay, bx, by),
  );
};

const insidePolygon = ([px, py], poly) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

const polygonGap = (a, b, limit) => {
  const ba = boundsOf([a]);
  const bb = boundsOf([b]);
  if (ba.minX - bb.maxX > limit || bb.minX - ba.maxX > limit
    || ba.minY - bb.maxY > limit || bb.minY - ba.maxY > limit) return Infinity;
  if (insidePolygon(a[0], b) || insidePolygon(b[0], a)) return 0;
  let gap = Infinity;
  for (let i = 0; i < a.length; i += 1) {
    for (let j = 0; j < b.length; j += 1) {
      gap = Math.min(gap, segmentGap(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length]));
    }
  }
  return gap;
};

export const spaceRoles = (spaces) => {
  const base = spaces.map((s) => {
    if (NON_GLA_TYPE.test(s.type) || OUTDOOR_NAME.test(s.name ?? '')) return 'nonGla';
    if (SHED.test(s.type) || SHED_NAME.test(s.name ?? '')) return 'nonGla';
    return /^Undefined\b/.test(s.type) ? 'unknown' : 'living';
  });
  return base.map((role, i) => {
    const s = spaces[i];
    if (role !== 'living' || !OUTBUILDING_TYPE.test(s.type)) return role;
    const attached = spaces.some((o, j) => j !== i && base[j] !== 'nonGla'
      && polygonGap(s.polygon, o.polygon, WALL_REACH_PX) <= WALL_REACH_PX);
    return attached ? role : 'nonGla';
  });
};

// The label's centre, from CubiCasa's anchor at the baseline start of 33 px
// Verdana.
const labelCentre = (space) => (space.anchor
  ? [space.anchor[0] + 0.33 * 33 * (space.name?.length ?? 4), space.anchor[1] - 11]
  : null);

/**
 * The living-area footprint of one plan, in the frame of a crop around it.
 *
 * GLA runs to the outer face of the walls around living space, so the
 * footprint is every living room plus every wall within reach of one: the wall
 * a garage or a balcony shares with the house joins, the garage's far walls do
 * not. Several floors on one sheet are one mask, since the tracer returns them
 * as separate outlines of one image.
 */
export const buildTruth = (model, imageSize) => {
  const roles = spaceRoles(model.spaces);
  const living = model.spaces.filter((_, i) => roles[i] === 'living');
  const unknown = model.spaces.filter((_, i) => roles[i] === 'unknown');
  // A plan whose rooms are all untyped still gets a truth, so the benchmark
  // can say that is why it was skipped.
  if (!living.length && !unknown.length) return null;
  const ext = boundsOf([...model.spaces.map((s) => s.polygon), ...model.walls.map((w) => w.polygon)]);
  const margin = Math.max(60, Math.round(0.08 * Math.max(ext.maxX - ext.minX, ext.maxY - ext.minY)));
  const x0 = Math.max(0, Math.floor(ext.minX - margin));
  const y0 = Math.max(0, Math.floor(ext.minY - margin));
  const x1 = Math.min(imageSize.width, Math.ceil(ext.maxX + margin));
  const y1 = Math.min(imageSize.height, Math.ceil(ext.maxY + margin));
  if (x1 - x0 < 50 || y1 - y0 < 50) return null;
  const crop = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  const gw = Math.ceil(crop.width / CELL);
  const gh = Math.ceil(crop.height / CELL);
  const frame = { cell: CELL, ox: crop.x, oy: crop.y };

  const livingMask = new Uint8Array(gw * gh);
  for (const s of living) fillPolygon(livingMask, gw, gh, s.polygon, frame);
  // Where the non-GLA rooms are, so an outline's excess can be told apart:
  // a balcony left in is a failure to exclude, a neighbour's flat is a leak.
  const nonGla = new Uint8Array(gw * gh);
  model.spaces.forEach((s, i) => {
    if (roles[i] === 'nonGla') fillPolygon(nonGla, gw, gh, s.polygon, frame);
  });
  const unknownMask = new Uint8Array(gw * gh);
  for (const s of unknown) fillPolygon(unknownMask, gw, gh, s.polygon, frame);
  const wallMask = new Uint8Array(gw * gh);
  for (const w of model.walls) fillPolygon(wallMask, gw, gh, w.polygon, frame);

  const reach = Math.round(WALL_REACH_PX / CELL);
  const near = dilateRect(livingMask, gw, gh, reach);
  let footprint = new Uint8Array(gw * gh);
  for (let i = 0; i < footprint.length; i += 1) {
    footprint[i] = livingMask[i] || (wallMask[i] && near[i]) ? 1 : 0;
  }
  footprint = openRect(footprint, gw, gh, Math.round(STUB_PX / CELL));
  for (let i = 0; i < footprint.length; i += 1) if (livingMask[i]) footprint[i] = 1;

  // Unknown space and the walls only it reaches are not scored: an outline
  // may take them in or leave them out.
  const nearUnknown = dilateRect(unknownMask, gw, gh, reach);
  const ignore = new Uint8Array(gw * gh);
  let unknownCells = 0;
  let livingCells = 0;
  for (let i = 0; i < ignore.length; i += 1) {
    if (!footprint[i] && (unknownMask[i] || (wallMask[i] && nearUnknown[i]))) ignore[i] = 1;
    unknownCells += unknownMask[i];
    livingCells += livingMask[i];
  }

  const solid = new Uint8Array(gw * gh);
  for (let i = 0; i < solid.length; i += 1) solid[i] = footprint[i] || ignore[i] ? 1 : 0;
  const outside = floodOutside(solid, gw, gh);
  const voids = new Uint8Array(gw * gh);
  for (let i = 0; i < voids.length; i += 1) voids[i] = !solid[i] && !outside[i] ? 1 : 0;
  const { labels, components } = labelComponents(voids, gw, gh);
  const slop = new Set(components.filter((c) => c.size * CELL * CELL < MIN_VOID_PX).map((c) => c.id));
  for (let i = 0; i < labels.length; i += 1) {
    if (labels[i] >= 0 && slop.has(labels[i])) footprint[i] = 1;
  }
  let cells = 0;
  for (let i = 0; i < footprint.length; i += 1) cells += footprint[i];

  const local = (poly) => poly.map(([x, y]) => [x - crop.x, y - crop.y]);
  const rooms = model.spaces.map((s, i) => {
    const poly = local(s.polygon);
    const b = boundsOf([poly]);
    const boxArea = (b.maxX - b.minX) * (b.maxY - b.minY);
    const area = shoelace(poly);
    const excluded = roles[i] === 'nonGla';
    const preferred = labelCentre(s);
    return {
      type: s.type,
      name: s.name,
      role: roles[i],
      excluded,
      keyword: excluded ? keywordFor(s.type, s.name ?? '') : null,
      dims: s.dimsFt,
      rect: { left: b.minX, top: b.minY, right: b.maxX, bottom: b.maxY },
      rectangular: boxArea > 0 && area / boxArea >= RECTANGULAR,
      point: interiorPoint(poly, preferred && [preferred[0] - crop.x, preferred[1] - crop.y]),
    };
  });

  return {
    crop,
    grid: { width: gw, height: gh, cell: CELL },
    footprint,
    nonGla,
    ignore,
    // How much of the plan's rooms the annotation never typed.
    unknownShare: unknownCells / Math.max(1, unknownCells + livingCells),
    areaSqFt: (cells * CELL * CELL) / (PX_PER_FOOT * PX_PER_FOOT),
    voids: components.length - slop.size,
    floorCount: model.floorCount,
    rooms,
    walls: model.walls.map((w) => local(w.polygon)),
  };
};

export const cropImage = (image, crop) => {
  const data = new Uint8ClampedArray(crop.width * crop.height * 4);
  for (let y = 0; y < crop.height; y += 1) {
    const from = ((crop.y + y) * image.width + crop.x) * 4;
    data.set(image.data.subarray(from, from + crop.width * 4), y * crop.width * 4);
  }
  return { width: crop.width, height: crop.height, data };
};

// The share of walls that land on ink. A truth that does not line up with its
// own image would score the tracer on the annotator's mistake.
export const wallInkAgreement = (walls, image) => {
  const dark = (x, y) => {
    const px = Math.round(x);
    const py = Math.round(y);
    if (px < 0 || py < 0 || px >= image.width || py >= image.height) return false;
    const i = (py * image.width + px) * 4;
    return 0.299 * image.data[i] + 0.587 * image.data[i + 1] + 0.114 * image.data[i + 2] < 200;
  };
  let hit = 0;
  for (const poly of walls) {
    let cx = 0;
    let cy = 0;
    for (const [x, y] of poly) {
      cx += x / poly.length;
      cy += y / poly.length;
    }
    if (dark(cx, cy) || poly.some(([x, y]) => dark(cx + 0.7 * (x - cx), cy + 0.7 * (y - cy)))) hit += 1;
  }
  return walls.length ? hit / walls.length : 0;
};

export const loadPlan = (id, root = CUBICASA_ROOT) => {
  const dir = path.join(root, id);
  return {
    id,
    category: id.split('/')[0],
    model: parseModelSvg(fs.readFileSync(path.join(dir, 'model.svg'), 'utf8')),
    image: loadPng(path.join(dir, 'F1_scaled.png')),
  };
};
