// Post-hoc validation of a traced result, in original image pixels. The
// geometry the app renders and bills square footage against was never checked
// against anything; here every floor is tested for the failures that produce a
// plausible-looking but wrong number.

import { hasSelfIntersection } from '../geometryValidation.js';
import { polygonArea, pointInPolygon, ringSetArea } from './polygon.js';
import { warning } from './scoring.js';

const boundsOf = (polygon) => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of polygon) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
};

const boxesOverlap = (a, b) =>
  a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;

// Shared area of two polygons, sampled on a grid over their common box.
const sampledOverlap = (a, b) => {
  const ab = boundsOf(a);
  const bb = boundsOf(b);
  const x0 = Math.max(ab.minX, bb.minX);
  const x1 = Math.min(ab.maxX, bb.maxX);
  const y0 = Math.max(ab.minY, bb.minY);
  const y1 = Math.min(ab.maxY, bb.maxY);
  if (x1 <= x0 || y1 <= y0) return 0;
  const steps = 96;
  const dx = (x1 - x0) / steps;
  const dy = (y1 - y0) / steps;
  let hits = 0;
  for (let iy = 0; iy < steps; iy += 1) {
    for (let ix = 0; ix < steps; ix += 1) {
      const p = { x: x0 + (ix + 0.5) * dx, y: y0 + (iy + 0.5) * dy };
      if (pointInPolygon(p, a) && pointInPolygon(p, b)) hits += 1;
    }
  }
  return (hits / (steps * steps)) * (x1 - x0) * (y1 - y0);
};

/**
 * @param {object} result mapped boundary result (original px)
 * @param {object} context { imageWidth, imageHeight, labels: [{x,y,keyword}] }
 * @returns {{ warnings: Array, confidence: number }} confidence is a multiplier
 *   applied to the detector's own confidence.
 */
export const validateBoundaryResult = (result, context = {}) => {
  const warnings = [];
  let factor = 1;
  if (!result?.floors?.length) {
    return { warnings: [warning('no-boundary', null, 'error')], factor: 0 };
  }

  const imageArea = (context.imageWidth ?? 0) * (context.imageHeight ?? 0);

  for (let i = 0; i < result.floors.length; i += 1) {
    const floor = result.floors[i];
    const outer = floor.outer?.polygon;
    if (!outer || outer.length < 3) {
      warnings.push(warning('floor-empty', { floor: i }, 'error'));
      factor *= 0.5;
      continue;
    }
    if (hasSelfIntersection(outer, true)) {
      warnings.push(warning('self-intersecting', { floor: i }, 'error'));
      factor *= 0.5;
    }
    const area = ringSetArea(outer, floor.holes ?? []);
    if (imageArea && area > 0.92 * imageArea) {
      warnings.push(warning('covers-page', { floor: i }, 'error'));
      factor *= 0.4;
    }
    if (imageArea && area < 0.005 * imageArea) {
      warnings.push(warning('tiny-floor', { floor: i }));
      factor *= 0.7;
    }
    const inner = floor.inner?.polygon;
    if (inner && inner.length >= 3) {
      const innerArea = ringSetArea(inner, floor.innerHoles ?? []);
      if (innerArea >= area) {
        warnings.push(warning('inner-not-nested', { floor: i }, 'error'));
        factor *= 0.6;
      } else if (innerArea < 0.45 * area) {
        warnings.push(warning('inner-over-inset', { floor: i, ratio: Number((innerArea / area).toFixed(2)) }));
        factor *= 0.85;
      }
    } else {
      warnings.push(warning('no-inner', { floor: i }));
      factor *= 0.9;
    }
  }

  // Floors must not overlap: two outlines covering the same area means one
  // network was split or one polygon annexed its neighbour. Measured on the
  // polygons, not their boxes — an L-shaped floor and a plan drawn in its
  // notch have heavily overlapping boxes and no shared area at all.
  for (let i = 0; i < result.floors.length; i += 1) {
    for (let j = i + 1; j < result.floors.length; j += 1) {
      const a = result.floors[i].outer?.polygon;
      const b = result.floors[j].outer?.polygon;
      if (!a || !b) continue;
      const smaller = Math.min(polygonArea(a), polygonArea(b));
      if (smaller <= 0) continue;
      if (!boxesOverlap(boundsOf(a), boundsOf(b))) continue;
      if (sampledOverlap(a, b) > 0.4 * smaller) {
        warnings.push(warning('floors-overlap', { floors: [i, j] }, 'error'));
        factor *= 0.6;
      }
    }
  }

  // A room label the OCR pass located and parsed is, by definition, inside the
  // building. A footprint that excludes one omitted a labelled region.
  const labels = context.labels ?? [];
  if (labels.length) {
    const exempt = context.exemptRegions ?? [];
    const nearExcluded = (label) => exempt.some((r) => {
      const pad = Math.max(r.width, r.height) * 2;
      return label.x >= r.x - pad && label.x <= r.x + r.width + pad
        && label.y >= r.y - pad && label.y <= r.y + r.height + pad;
    });
    const outside = labels.filter((label) => !nearExcluded(label) && !result.floors.some((floor) =>
      floor.outer?.polygon
      && pointInPolygon(label, floor.outer.polygon, floor.holes ?? [])));
    if (outside.length) {
      // A label outside a *drawn* outline is usually a deliberate exclusion —
      // the user painted around the garage. Still said out loud, because it is
      // also how a mis-drawn outline shows itself, but it no longer condemns
      // the trace the way it does when the detector chose the boundary alone.
      const drawn = Boolean(context.userDrawn);
      warnings.push(warning('label-outside', {
        count: outside.length,
        of: labels.length,
        names: outside.slice(0, 4).map((l) => l.name ?? null).filter(Boolean),
      }, drawn ? 'warn' : 'error'));
      factor *= drawn
        ? Math.max(0.85, 1 - 0.3 * (outside.length / labels.length))
        : Math.max(0.35, 1 - outside.length / labels.length);
    }
  }

  return { warnings, factor: Math.max(0, Math.min(1, factor)) };
};

// Isotropy of a room calibration: two scalars derived from one room must
// agree, or the room rectangle does not match the label it was measured from.
// This is the cheapest correctness check available to the app and needs no new
// state — sx and sy are both already in hand wherever a scale is set.
export const scaleIsotropy = (scaleX, scaleY, tolerance = 0.05) => {
  if (!(scaleX > 0) || !(scaleY > 0)) return { ok: false, ratio: NaN, logDistance: Infinity };
  const ratio = scaleX / scaleY;
  const logDistance = Math.abs(Math.log(ratio));
  return { ok: logDistance <= tolerance, ratio, logDistance };
};

// Robust global scale from many per-room estimates: the median rejects the
// individual rooms whose rectangle or label went wrong, which a single-room
// calibration cannot do.
export const robustScale = (estimates) => {
  const values = estimates.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (!values.length) return null;
  const median = values[(values.length / 2) | 0];
  const spread = values.length > 1 ? values[values.length - 1] / values[0] : 1;
  const kept = values.filter((v) => Math.abs(Math.log(v / median)) <= 0.25);
  const refined = kept.length ? kept[(kept.length / 2) | 0] : median;
  return { value: refined, median, spread, samples: values.length, kept: kept.length };
};
