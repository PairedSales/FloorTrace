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

// How far apart one room's two scales may be before the room, not the drawing,
// is what is wrong.
export const ISOTROPY_TOLERANCE = 0.05;

// Which way round a label's two numbers go. A label states a room's two sides
// but not which one runs across the page: vertical labels are rotated, and
// "12 x 14" is written the way it reads, not the way it is drawn. Binding the
// first number to x regardless is what makes one room imply two different
// scales. The rectangle already knows the answer — its longer side is the
// room's longer measurement — so pair them that way. Equivalent to picking the
// pairing with the smaller x/y scale disagreement, which is why it never makes
// the calibration less isotropic than the direct reading.
export const orientDimsToBox = (dimWidth, dimHeight, boxWidth, boxHeight) => {
  const asWritten = { width: dimWidth, height: dimHeight, swapped: false };
  if (!(dimWidth > 0) || !(dimHeight > 0) || !(boxWidth > 0) || !(boxHeight > 0)) return asWritten;
  const label = Math.log(dimWidth / dimHeight);
  const box = Math.log(boxWidth / boxHeight);
  // How far apart the two scales end up under each reading. Preferring the
  // smaller is the same rule as "longest side to longest measurement", but it
  // is only applied once the direct reading is off by more than a calibration
  // is allowed to be: on a near-square room both readings pass, and the sign
  // of a sub-pixel difference must not decide which axis carries which scale.
  const direct = Math.abs(label - box);
  const swapped = Math.abs(label + box);
  if (direct <= ISOTROPY_TOLERANCE || swapped >= direct) return asWritten;
  return { width: dimHeight, height: dimWidth, swapped: true };
};

// Isotropy of a room calibration: two scalars derived from one room must
// agree, or the room rectangle does not match the label it was measured from.
// This is the cheapest correctness check available to the app and needs no new
// state — sx and sy are both already in hand wherever a scale is set.
export const scaleIsotropy = (scaleX, scaleY, tolerance = ISOTROPY_TOLERANCE) => {
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

// The feet per pixel one room implies: the label oriented to the rectangle,
// and, where the two axes still disagree, one scalar instead of two — a plan
// is drawn at one scale, so a disagreement is measurement error and not
// anisotropic pixels. `samples` are the feet per pixel of the rooms measured
// so far; their median survives one bad rectangle, which this room's own pair
// cannot. Falls back to the geometric mean, the isotropic scale that preserves
// the area the room's label states.
// One function because two callers must never answer differently: the numbers
// the canvas shows while a room corner is being dragged are the calibration
// that same drag commits on release.
export const resolveRoomScale = (dimWidth, dimHeight, boxWidth, boxHeight, samples = []) => {
  const dim = orientDimsToBox(dimWidth, dimHeight, boxWidth, boxHeight);
  const x = dim.width / boxWidth;
  const y = dim.height / boxHeight;
  const isotropy = scaleIsotropy(x, y);
  if (isotropy.ok) return { x, y, isotropy, resolved: false };
  const robust = samples.length >= 4 ? robustScale(samples) : null;
  const value = robust && robust.spread <= 2 ? robust.value : Math.sqrt(x * y);
  return { x: value, y: value, isotropy, resolved: true };
};

// How far apart two rooms on one real plan may legitimately land. Printed
// dimensions are nominal and are not all measured to the same face, so one
// drawing's labels imply scales spanning ~15% room to room (ExampleFloorplan6:
// 13.97 to 16.36 px/ft). Beyond this a room has not been measured differently,
// it has been measured wrong. Same reasoning and value as room.js's own
// SCALE_TOLERANCE, kept separate so neither is tuned by accident.
export const PLAN_SPREAD_TOLERANCE = 0.22;

// The scale the whole project should use once this room has been measured, and
// how much to trust it. Two independent things can be wrong, and the app can
// only resolve one of them on its own:
//
//   - the room against itself: its label and its rectangle imply different
//     scales. Resolvable (one scalar), but the disagreement is evidence that
//     one of the two is wrong, and the area moves with it.
//   - the room against the rooms already measured: nothing inside one room can
//     detect this, and it is the case where both of a room's numbers are wrong
//     together — a label read from the neighbouring room, an outline a whole
//     bay out. Two rooms outvote one, so an outlier no longer rescales the
//     project; it is reported instead.
export const decideProjectScale = ({
  dimWidth, dimHeight, boxWidth, boxHeight, otherSamples = [],
}) => {
  const room = resolveRoomScale(dimWidth, dimHeight, boxWidth, boxHeight, otherSamples);
  const roomScale = room.x;
  const others = otherSamples.length >= 2 ? robustScale(otherSamples) : null;
  const authoritative = !!others && otherSamples.length >= 4 && others.spread <= 2;
  const gap = others ? Math.abs(Math.log(roomScale / others.value)) : 0;

  if (others && gap > PLAN_SPREAD_TOLERANCE) {
    return authoritative
      ? {
        scale: { x: others.value, y: others.value },
        adopted: false,
        level: 'check',
        reason: 'room-vs-project',
        disagreement: gap,
        roomScale,
        projectScale: others.value,
        roomCount: Math.floor(otherSamples.length / 2),
      }
      : {
        // A single earlier room is a second opinion, not a majority: take the
        // new measurement, but say that the two do not agree.
        scale: { x: roomScale, y: room.y },
        adopted: true,
        level: 'check',
        reason: 'room-vs-project',
        disagreement: gap,
        roomScale,
        projectScale: others.value,
        roomCount: Math.floor(otherSamples.length / 2),
      };
  }

  // Graded, because the size of the disagreement is the size of the doubt: a
  // few percent is a printed dimension being nominal and is worth stating but
  // not worrying about; a third is a rectangle or a label that is simply wrong.
  const d = room.isotropy.logDistance;
  return {
    scale: { x: room.x, y: room.y },
    adopted: true,
    level: room.isotropy.ok ? 'ok' : d > 0.25 ? 'check' : 'note',
    reason: room.isotropy.ok ? null : 'room-internal',
    disagreement: room.isotropy.ok ? 0 : d,
    roomScale,
    projectScale: others ? others.value : null,
    roomCount: Math.floor(otherSamples.length / 2),
  };
};
