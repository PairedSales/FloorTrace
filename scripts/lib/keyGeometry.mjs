// Plane geometry for the key tool's compare and check (scripts/realKeyTool.mjs),
// pure so the numbers that decide whether two keys agree are tested against
// shapes whose areas are worked out by hand.
//
// A ring is `[[x, y], …]` in image pixels, closed implicitly. Areas of unions
// are counted on a raster of cell centres, filled with `fillPolygon` from
// lib/cubicasa.mjs: the very fill bench:real uses for the truth mask, so an
// IoU here means what the score means by it. At 0.5 px a cell's error is far
// inside the ±0.2% the protocol needs.
import { fillPolygon } from './cubicasa.mjs';

const EPS = 1e-6;

export const signedArea = (v) => {
  let a = 0;
  for (let i = 0; i < v.length; i += 1) {
    const [x0, y0] = v[i];
    const [x1, y1] = v[(i + 1) % v.length];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
};
export const areaOf = (v) => Math.abs(signedArea(v));

export const bboxOf = (rings) => {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const ring of rings) {
    for (const [x, y] of ring) {
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  }
  return [x0, y0, x1, y1];
};

export const ringLength = (v) => {
  let len = 0;
  for (let i = 0; i < v.length; i += 1) {
    const [x0, y0] = v[i];
    const [x1, y1] = v[(i + 1) % v.length];
    len += Math.hypot(x1 - x0, y1 - y0);
  }
  return len;
};

// Signed distance of p from the line through a and b (positive on the left of
// a→b in y-down coordinates does not matter here: only near-zero does).
const lineDistance = (a, b, p) => {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  return ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) / len;
};

const withinSegment = (a, b, p) => (
  Math.min(a[0], b[0]) - EPS <= p[0] && p[0] <= Math.max(a[0], b[0]) + EPS
  && Math.min(a[1], b[1]) - EPS <= p[1] && p[1] <= Math.max(a[1], b[1]) + EPS
);

// How two segments meet: 'cross' (properly), 'touch' (an end of one lies on the
// other, or they overlap), or null.
export const segmentContact = (p1, p2, p3, p4) => {
  const d1 = lineDistance(p3, p4, p1);
  const d2 = lineDistance(p3, p4, p2);
  const d3 = lineDistance(p1, p2, p3);
  const d4 = lineDistance(p1, p2, p4);
  const s = (d) => (Math.abs(d) < EPS ? 0 : Math.sign(d));
  if (s(d1) * s(d2) < 0 && s(d3) * s(d4) < 0) return 'cross';
  if (s(d1) === 0 && withinSegment(p3, p4, p1)) return 'touch';
  if (s(d2) === 0 && withinSegment(p3, p4, p2)) return 'touch';
  if (s(d3) === 0 && withinSegment(p1, p2, p3)) return 'touch';
  if (s(d4) === 0 && withinSegment(p1, p2, p4)) return 'touch';
  return null;
};

/**
 * What is wrong with a ring as an outline, or null when it is a simple polygon:
 * `{kind, edges, text}`, kind 'few' (under 3 distinct vertices), 'duplicate'
 * (a zero-length edge), 'spike' (an edge that doubles back on the one before
 * it), 'cross' (two edges cross) or 'touch' (two edges that are not neighbours
 * meet), 'flat' (no area).
 */
export const ringProblem = (v) => {
  const n = v.length;
  const distinct = new Set(v.map(([x, y]) => `${x.toFixed(3)},${y.toFixed(3)}`));
  if (n < 3 || distinct.size < 3) return { kind: 'few', edges: [], text: `only ${distinct.size} distinct vertices` };
  for (let i = 0; i < n; i += 1) {
    const a = v[i];
    const b = v[(i + 1) % n];
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < EPS) {
      return { kind: 'duplicate', edges: [i], text: `edge ${i} has zero length (vertices ${i} and ${(i + 1) % n} coincide)` };
    }
  }
  for (let i = 0; i < n; i += 1) {
    const a = v[i];
    const b = v[(i + 1) % n];
    const c = v[(i + 2) % n];
    const dot = (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]);
    if (Math.abs(lineDistance(a, b, c)) < EPS && dot < 0) {
      return { kind: 'spike', edges: [i, (i + 1) % n], text: `edges ${i} and ${(i + 1) % n} double back on each other` };
    }
  }
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 2; j < n; j += 1) {
      if (i === 0 && j === n - 1) continue;
      const kind = segmentContact(v[i], v[(i + 1) % n], v[j], v[(j + 1) % n]);
      if (kind) {
        return { kind, edges: [i, j], text: `edge ${i} ${kind === 'cross' ? 'crosses' : 'touches'} edge ${j}` };
      }
    }
  }
  if (areaOf(v) < 1) return { kind: 'flat', edges: [], text: 'the outline has no area' };
  return null;
};

/** Whether `pt` lies inside the ring (non-zero winding; the boundary counts). */
export const pointInRing = (pt, v) => {
  const [px, py] = pt;
  let winding = 0;
  for (let i = 0; i < v.length; i += 1) {
    const a = v[i];
    const b = v[(i + 1) % v.length];
    if (Math.abs(lineDistance(a, b, pt)) < EPS && withinSegment(a, b, pt)) return true;
    if ((a[1] <= py) !== (b[1] <= py)) {
      const x = a[0] + ((py - a[1]) / (b[1] - a[1])) * (b[0] - a[0]);
      if (x > px) winding += b[1] > a[1] ? 1 : -1;
    }
  }
  return winding !== 0;
};

/** Points along a ring's boundary about every `step` px, vertices included. */
export const sampleRing = (v, step = 1) => {
  const out = [];
  for (let i = 0; i < v.length; i += 1) {
    const a = v[i];
    const b = v[(i + 1) % v.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.round(len / step));
    for (let k = 0; k < n; k += 1) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
};

/** Every edge of every ring, as `[ax, ay, bx, by]`. */
export const segmentsOf = (rings) => {
  const out = [];
  for (const v of rings) {
    for (let i = 0; i < v.length; i += 1) {
      const a = v[i];
      const b = v[(i + 1) % v.length];
      out.push([a[0], a[1], b[0], b[1]]);
    }
  }
  return out;
};

/** The distance from `pt` to the nearest of `segments` (Infinity for none). */
export const distanceToSegments = (pt, segments) => {
  let best = Infinity;
  for (const [ax, ay, bx, by] of segments) {
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((pt[0] - ax) * dx + (pt[1] - ay) * dy) / len2));
    const d = Math.hypot(pt[0] - (ax + dx * t), pt[1] - (ay + dy * t));
    if (d < best) best = d;
  }
  return best;
};

// The raster's cell: 0.5 px, coarser only when the box would need more than
// ~30 million cells.
const MAX_CELLS = 3e7;
export const cellFor = (box, cell = 0.5) => {
  let c = cell;
  while (((box[2] - box[0]) / c) * ((box[3] - box[1]) / c) > MAX_CELLS) c *= 2;
  return c;
};

/** `{mask, width, height, cell, box}`: the union of `rings`, painted on cell centres inside `box`. */
export const rasterise = (rings, box, cell) => {
  const width = Math.max(1, Math.ceil((box[2] - box[0]) / cell));
  const height = Math.max(1, Math.ceil((box[3] - box[1]) / cell));
  const mask = new Uint8Array(width * height);
  for (const ring of rings) fillPolygon(mask, width, height, ring, { cell, ox: box[0], oy: box[1] });
  return { mask, width, height, cell, box };
};

const countOf = (mask) => {
  let n = 0;
  for (let i = 0; i < mask.length; i += 1) n += mask[i];
  return n;
};

/**
 * The area of the union of `ringsA`, of `ringsB`, of both together and of what
 * they share, in px². `iou` is 1 when both are empty, 0 when only one is.
 */
export const areasOf = (ringsA, ringsB, cell = 0.5) => {
  const all = [...ringsA, ...ringsB];
  if (!all.length) return { a: 0, b: 0, inter: 0, union: 0, iou: 1 };
  const [x0, y0, x1, y1] = bboxOf(all);
  const box = [Math.floor(x0) - 1, Math.floor(y0) - 1, Math.ceil(x1) + 1, Math.ceil(y1) + 1];
  const c = cellFor(box, cell);
  const A = rasterise(ringsA, box, c);
  const B = rasterise(ringsB, box, c);
  let a = 0;
  let b = 0;
  let inter = 0;
  for (let i = 0; i < A.mask.length; i += 1) {
    a += A.mask[i];
    b += B.mask[i];
    inter += A.mask[i] & B.mask[i];
  }
  const cellArea = c * c;
  const union = a + b - inter;
  return {
    a: a * cellArea,
    b: b * cellArea,
    inter: inter * cellArea,
    union: union * cellArea,
    iou: union === 0 ? 1 : inter / union,
  };
};

export const unionArea = (rings, cell = 0.5) => {
  if (!rings.length) return 0;
  const [x0, y0, x1, y1] = bboxOf(rings);
  const box = [Math.floor(x0) - 1, Math.floor(y0) - 1, Math.ceil(x1) + 1, Math.ceil(y1) + 1];
  const c = cellFor(box, cell);
  return countOf(rasterise(rings, box, c).mask) * c * c;
};

/**
 * The length of `ringsA`'s boundary that lies within `tolerance` px of
 * `ringsB`'s: how much boundary two outlines share.
 */
export const sharedBoundaryLength = (ringsA, ringsB, tolerance = 1.5) => {
  const segs = segmentsOf(ringsB);
  if (!segs.length) return 0;
  let shared = 0;
  for (const ring of ringsA) {
    for (const p of sampleRing(ring, 1)) if (distanceToSegments(p, segs) <= tolerance) shared += 1;
  }
  return shared;
};
