// Plane geometry for the key tool's compare and check (scripts/realKeyTool.mjs),
// pure so the numbers that decide whether two keys agree are tested against
// shapes whose areas are worked out by hand.
//
// A ring is `[[x, y], …]` in image pixels, closed implicitly. Areas of unions
// and intersections are exact (`areasOf`), not counted on a raster: a raster's
// error is a fraction of a cell along every edge, which for a small house is
// enough to put an IoU on the wrong side of the 99% line. (bench:real's truth
// masks are rasters, so an IoU here can differ from a score's by the sub-pixel
// a mask rounds away: the agreement rule is about the shapes, not a mask.)

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

// ---- exact areas ---------------------------------------------------------------
//
// A scanline strip is the band between two consecutive "event" heights: the y of
// a vertex, or of a crossing of two edges. Inside a strip no edge starts, ends
// or crosses another, so which edges bound the shape, and in what order, never
// changes: the x-length the shape covers is a linear function of y, and the
// strip's area is exactly its height times that length at its middle.

// The x-spans a ring covers on the horizontal line `y` (non-zero winding, the
// fill `bench:real` uses), as sorted `[x0, x1]`.
const spansAt = (ring, y) => {
  const hits = [];
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[j];
    const b = ring[i];
    if ((a[1] <= y) === (b[1] <= y)) continue;
    hits.push({ x: a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]), dir: b[1] > a[1] ? 1 : -1 });
  }
  hits.sort((p, q) => p.x - q.x);
  const spans = [];
  let winding = 0;
  for (let k = 0; k < hits.length - 1; k += 1) {
    winding += hits[k].dir;
    if (winding) spans.push([hits[k].x, hits[k + 1].x]);
  }
  return spans;
};

const mergeSpans = (spans) => {
  spans.sort((p, q) => p[0] - q[0]);
  const out = [];
  for (const s of spans) {
    const last = out[out.length - 1];
    if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]);
    else out.push([s[0], s[1]]);
  }
  return out;
};

const unionSpans = (rings, y) => mergeSpans(rings.flatMap((ring) => spansAt(ring, y)));
const lengthOf = (spans) => spans.reduce((t, [a, b]) => t + (b - a), 0);
const intersectSpans = (p, q) => {
  const out = [];
  for (let i = 0, j = 0; i < p.length && j < q.length;) {
    const lo = Math.max(p[i][0], q[j][0]);
    const hi = Math.min(p[i][1], q[j][1]);
    if (hi > lo) out.push([lo, hi]);
    if (p[i][1] < q[j][1]) i += 1;
    else j += 1;
  }
  return out;
};

// Every height at which the set of edges across a scanline can change.
const eventHeights = (rings) => {
  const segs = segmentsOf(rings);
  const ys = new Set();
  for (const [, ay, , by] of segs) {
    ys.add(ay);
    ys.add(by);
  }
  for (let i = 0; i < segs.length; i += 1) {
    const [px, py, p2x, p2y] = segs[i];
    const rx = p2x - px;
    const ry = p2y - py;
    for (let j = i + 1; j < segs.length; j += 1) {
      const [qx, qy, q2x, q2y] = segs[j];
      if (Math.max(py, p2y) < Math.min(qy, q2y) || Math.max(qy, q2y) < Math.min(py, p2y)) continue;
      const sx = q2x - qx;
      const sy = q2y - qy;
      const denom = rx * sy - ry * sx;
      if (Math.abs(denom) < 1e-12) continue;
      const t = ((qx - px) * sy - (qy - py) * sx) / denom;
      const u = ((qx - px) * ry - (qy - py) * rx) / denom;
      if (t >= 0 && t <= 1 && u >= 0 && u <= 1) ys.add(py + t * ry);
    }
  }
  const sorted = [...ys].sort((p, q) => p - q);
  return sorted.filter((y, i) => i === 0 || y - sorted[i - 1] > 1e-9);
};

/**
 * The area of the union of `ringsA`, of `ringsB`, and of what they share, in
 * px², exactly; `union` is the area of both together. `iou` is 1 when both are
 * empty, 0 when only one is.
 */
export const areasOf = (ringsA, ringsB) => {
  let a = 0;
  let b = 0;
  let inter = 0;
  const ys = eventHeights([...ringsA, ...ringsB]);
  for (let k = 0; k + 1 < ys.length; k += 1) {
    const h = ys[k + 1] - ys[k];
    const mid = ys[k] + h / 2;
    const sa = unionSpans(ringsA, mid);
    const sb = unionSpans(ringsB, mid);
    a += h * lengthOf(sa);
    b += h * lengthOf(sb);
    inter += h * lengthOf(intersectSpans(sa, sb));
  }
  const union = a + b - inter;
  return { a, b, inter, union, iou: union > 0 ? inter / union : 1 };
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
