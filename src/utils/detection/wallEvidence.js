// Wall evidence: the intermediate representation the boundary stage reasons
// about. Ink alone cannot answer "is this edge a wall?", so the tracer used to
// approximate every such question morphologically. Here linework is vectorised
// into axis-aligned wall segments (both faces, extent, thickness, weight), and
// a graded evidence lookup answers, for any point on a candidate outline,
// whether a wall is actually drawn there.

import { keepLongRuns, labelComponents } from './raster.js';

// Merge collinear segments separated by gaps so a wall interrupted by a door,
// a window or a slider still reads as one line.
const mergeCollinear = (segments, bridgeGap) => {
  const sorted = [...segments].sort((a, b) => a.center - b.center || a.lo - b.lo);
  const merged = [];
  for (const seg of sorted) {
    const host = merged.find((m) =>
      Math.abs(m.center - seg.center) <= Math.max(3, (m.thick + seg.thick) / 2) &&
      seg.lo - m.hi <= bridgeGap &&
      m.lo - seg.hi <= bridgeGap
    );
    if (host) {
      const weight = host.weight + seg.weight;
      host.center = (host.center * host.weight + seg.center * seg.weight) / weight;
      host.faceLo = Math.min(host.faceLo, seg.faceLo);
      host.faceHi = Math.max(host.faceHi, seg.faceHi);
      host.lo = Math.min(host.lo, seg.lo);
      host.hi = Math.max(host.hi, seg.hi);
      host.thick = Math.max(host.thick, seg.thick);
      host.weight = weight;
      host.pieces = (host.pieces ?? 1) + 1;
      host.drawn += seg.drawn;
    } else {
      merged.push({ ...seg, pieces: 1 });
    }
  }
  return merged.sort((a, b) => a.center - b.center);
};

const segmentsForDirection = (ink, width, height, direction, opts) => {
  const strokes = keepLongRuns(ink, width, height, opts.minRun, direction);
  const { components } = labelComponents(strokes, width, height);
  const raw = [];
  for (const comp of components) {
    const { minX, minY, maxX, maxY } = comp.bbox;
    const len = direction === 'v' ? maxY - minY + 1 : maxX - minX + 1;
    const thick = direction === 'v' ? maxX - minX + 1 : maxY - minY + 1;
    // Wider than a wall line = filled region; shorter than 1.5x its own
    // thickness = blob, not a line.
    if (thick > opts.maxThickness) continue;
    if (len < Math.max(opts.minRun, thick * 1.5)) continue;
    raw.push({
      center: direction === 'v' ? (minX + maxX) / 2 : (minY + maxY) / 2,
      faceLo: direction === 'v' ? minX : minY,
      faceHi: direction === 'v' ? maxX : maxY,
      lo: direction === 'v' ? minY : minX,
      hi: direction === 'v' ? maxY : maxX,
      thick,
      weight: comp.size,
      drawn: len,
      direction,
    });
  }
  return mergeCollinear(raw, opts.bridgeGap);
};

/**
 * @param {Uint8Array} ink binary mask, 1 = ink
 * @returns {{ vertical: Array, horizontal: Array }} segments as
 *   { faceLo, faceHi, lo, hi } — faceLo/faceHi are the wall's two faces
 *   (first/last ink pixel across its thickness; x for vertical, y for
 *   horizontal), [lo, hi] its extent along the wall.
 */
export const extractWallSegments = (ink, width, height, options = {}) => {
  const maxDim = Math.max(width, height);
  const opts = {
    minRun: options.minRun ?? Math.max(16, Math.round(maxDim * 0.02)),
    maxThickness: options.maxThickness ?? Math.max(8, Math.round(maxDim * 0.017)),
    bridgeGap: options.bridgeGap ?? Math.round(maxDim * 0.08),
  };
  return {
    vertical: segmentsForDirection(ink, width, height, 'v', opts),
    horizontal: segmentsForDirection(ink, width, height, 'h', opts),
  };
};

// Paint each merged segment across its full extent. Openings a wall line spans
// — sliders, garage bays, a wall segment a poor scan dropped — are closed
// along the wall itself rather than by a square closing that also rounds every
// corner and fills every concavity of the same size.
export const segmentSpanMask = (segments, width, height) => {
  const mask = new Uint8Array(width * height);
  const paint = (seg, vertical) => {
    const lo = Math.max(0, Math.floor(seg.lo));
    const hi = Math.min((vertical ? height : width) - 1, Math.ceil(seg.hi));
    const fLo = Math.max(0, Math.floor(seg.faceLo));
    const fHi = Math.min((vertical ? width : height) - 1, Math.ceil(seg.faceHi));
    for (let a = lo; a <= hi; a += 1) {
      for (let b = fLo; b <= fHi; b += 1) {
        mask[vertical ? a * width + b : b * width + a] = 1;
      }
    }
  };
  for (const seg of segments.vertical) paint(seg, true);
  for (const seg of segments.horizontal) paint(seg, false);
  return mask;
};

// Total length of segment extent that was bridged rather than drawn. A large
// value means the outline leans on inferred wall rather than observed ink.
export const bridgedSpan = (segments) => {
  let total = 0;
  let longest = 0;
  for (const list of [segments.vertical, segments.horizontal]) {
    for (const seg of list) {
      const extent = seg.hi - seg.lo + 1;
      const gap = Math.max(0, extent - seg.drawn);
      total += gap;
      if (seg.pieces > 1) longest = Math.max(longest, gap / Math.max(1, seg.pieces - 1));
    }
  }
  return { total, longest };
};

// Graded per-point wall evidence. Structural ink (survives the thickness
// opening) is full evidence, any wall-mask stroke is partial, raw ink is weak,
// and nothing is zero — so a fabricated edge crossing empty paper is
// distinguishable from a real bay window drawn in hairlines.
const LEVEL_THICK = 1;
const LEVEL_WALL = 0.45;
const LEVEL_INK = 0.2;

const nearby = (mask, width, height, x, y, tol) => {
  const x0 = Math.max(0, x - tol);
  const x1 = Math.min(width - 1, x + tol);
  const y0 = Math.max(0, y - tol);
  const y1 = Math.min(height - 1, y + tol);
  for (let yy = y0; yy <= y1; yy += 1) {
    const row = yy * width;
    for (let xx = x0; xx <= x1; xx += 1) if (mask[row + xx]) return true;
  }
  return false;
};

/**
 * @param {Uint8Array} [assertedMask] draw mode's stroke ribbon: the user said a
 *   wall runs here. Rated as wall rather than as nothing, because an edge
 *   following a deliberate stroke over blank paper is not the same failure as
 *   one fabricated across blank paper by a closing radius.
 */
export const createEvidence = (analysis, netMask, assertedMask = null) => {
  const { width, height, thickMask, ink } = analysis;
  const wall = netMask ?? analysis.wallMask;
  return {
    width,
    height,
    levelAt: (x, y, tol) => {
      if (thickMask && nearby(thickMask, width, height, x, y, tol)) return LEVEL_THICK;
      if (nearby(wall, width, height, x, y, tol)) return LEVEL_WALL;
      // Ahead of raw ink: a deliberate stroke outranks whatever stray mark
      // happens to sit near the same pixel.
      if (assertedMask && nearby(assertedMask, width, height, x, y, tol)) return LEVEL_WALL;
      if (ink && nearby(ink, width, height, x, y, tol)) return LEVEL_INK;
      return 0;
    },
  };
};

/**
 * Wall support of a closed outline: the length-weighted mean evidence level
 * along its edges, plus the longest single unsupported run. The mean says how
 * much of this outline is drawn as wall; the run says whether the gap is one
 * fabricated wall or noise spread thin.
 */
export const contourSupport = (polygon, evidence, tol, step = 2) => {
  if (!polygon || polygon.length < 3) return { mean: 0, unsupportedFrac: 1, longestGap: 0, total: 0 };
  let total = 0;
  let weighted = 0;
  let unsupported = 0;
  let gap = 0;
  let longestGap = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-6) continue;
    const samples = Math.max(1, Math.round(len / step));
    for (let s = 0; s < samples; s += 1) {
      const t = (s + 0.5) / samples;
      const x = Math.round(a.x + (b.x - a.x) * t);
      const y = Math.round(a.y + (b.y - a.y) * t);
      const level = evidence.levelAt(x, y, tol);
      const seg = len / samples;
      total += seg;
      weighted += level * seg;
      if (level <= 0) {
        unsupported += seg;
        gap += seg;
        if (gap > longestGap) longestGap = gap;
      } else {
        gap = 0;
      }
    }
  }
  if (total <= 0) return { mean: 0, unsupportedFrac: 1, longestGap: 0, total: 0 };
  return {
    mean: weighted / total,
    unsupportedFrac: unsupported / total,
    longestGap,
    total,
  };
};
