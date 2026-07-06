// Room-from-label detection. A rectangle grows outward from the label until
// each side reaches thick-wall evidence: a column/row where wall coverage
// across the current perpendicular span is high. Door gaps only dent the
// coverage, so growth cannot leak through them the way a flood fill does.
// Thin high-coverage lines (counters, window glass, closet fronts) are kept
// as alternative stop candidates instead of hard stops; when the parsed label
// dimensions are known, a small combinatorial search picks the per-side
// candidates whose rectangle best matches the label's aspect ratio.

import { satSum } from './raster.js';

const COV_STRONG = 0.6;
const COV_THIN = 0.8;
const THICK_MIN = 0.22;

const SIDES = [
  { key: 'left', axis: 'x', dir: -1 },
  { key: 'right', axis: 'x', dir: 1 },
  { key: 'top', axis: 'y', dir: -1 },
  { key: 'bottom', axis: 'y', dir: 1 },
];

export const growRoomRect = (analysis, footprintInfo, point, options = {}) => {
  const { width, height, band, wallThickness } = analysis;

  const px = Math.max(0, Math.min(width - 1, Math.round(point.x)));
  const py = Math.max(0, Math.min(height - 1, Math.round(point.y)));

  const footprint = footprintInfo?.footprintMask ?? null;
  const satFoot = footprintInfo?.satFootprint ?? null;
  if (footprint && !footprint[py * width + px]) return null;

  const lb = options.labelBbox;
  const rect = lb
    ? {
      left: Math.max(0, Math.round(lb.x + lb.width * 0.15)),
      right: Math.min(width - 1, Math.round(lb.x + lb.width * 0.85)),
      top: Math.max(0, Math.round(lb.y + lb.height * 0.15)),
      bottom: Math.min(height - 1, Math.round(lb.y + lb.height * 0.85)),
    }
    : {
      left: Math.max(0, px - 8), right: Math.min(width - 1, px + 8),
      top: Math.max(0, py - 8), bottom: Math.min(height - 1, py + 8),
    };
  if (rect.right <= rect.left) rect.right = Math.min(width - 1, rect.left + 4);
  if (rect.bottom <= rect.top) rect.bottom = Math.min(height - 1, rect.top + 4);

  const limitFor = (side) => (side.axis === 'x' ? width - 1 : height - 1);

  const lineCoverage = (side, pos) => {
    let span;
    let cov;
    let thick;
    if (side.axis === 'x') {
      span = rect.bottom - rect.top + 1;
      cov = satSum(analysis.satSmearH, width, height, pos, rect.top, pos, rect.bottom) / span;
      thick = satSum(analysis.satThickH, width, height, pos, rect.top, pos, rect.bottom) / span;
    } else {
      span = rect.right - rect.left + 1;
      cov = satSum(analysis.satSmearV, width, height, rect.left, pos, rect.right, pos) / span;
      thick = satSum(analysis.satThickV, width, height, rect.left, pos, rect.right, pos) / span;
    }
    return { cov, thick };
  };

  const insideFootprint = (side, pos) => {
    if (!satFoot) return true;
    let frac;
    if (side.axis === 'x') {
      const span = rect.bottom - rect.top + 1;
      frac = satSum(satFoot, width, height, pos, rect.top, pos, rect.bottom) / span;
    } else {
      const span = rect.right - rect.left + 1;
      frac = satSum(satFoot, width, height, rect.left, pos, rect.right, pos) / span;
    }
    return frac >= 0.45;
  };

  const isThick = (c) => c.cov >= COV_STRONG && c.thick >= THICK_MIN;
  const isThin = (c) => c.cov >= COV_THIN;
  // On thin-wall plans the thick mask carries no signal; coverage is all we have.
  const thinPlan = wallThickness <= 3;

  // The scan hits the smeared wall `band` px before its true face; pull the
  // edge back so it sits just inside the face.
  const edgeFromHit = (side, pos) =>
    Math.max(0, Math.min(limitFor(side), pos + side.dir * (band - 1)));

  // Phase A: grow all four sides in lockstep. Thick walls (or any wall on
  // thin plans) stop a side; thin lines are recorded and passed through.
  const step = Math.max(3, wallThickness);
  const state = {};
  for (const side of SIDES) {
    state[side.key] = {
      pos: rect[side.key],
      done: false,
      clamped: false,
      thinHits: [],
      lastThin: -Infinity,
    };
  }

  for (let iter = 0; iter < 600; iter += 1) {
    let active = false;
    for (const side of SIDES) {
      const s = state[side.key];
      if (s.done) continue;
      active = true;

      for (let d = 1; d <= step && !s.done; d += 1) {
        const pos = s.pos + side.dir * d;
        if (pos < 0 || pos > limitFor(side) || !insideFootprint(side, pos)) {
          s.pos = Math.max(0, Math.min(limitFor(side), pos - side.dir));
          s.done = true;
          s.clamped = true;
          break;
        }
        const c = lineCoverage(side, pos);
        if (isThick(c) || (thinPlan && isThin(c))) {
          s.pos = edgeFromHit(side, pos);
          s.hit = { pos, ...c };
          s.done = true;
        } else if (isThin(c) && pos > s.lastThin + band * 2 + 2 && s.thinHits.length < 4) {
          s.thinHits.push({ pos, ...c });
          s.lastThin = pos;
          s.pos = pos;
        } else {
          s.pos = pos;
        }
      }

      rect.left = state.left.pos;
      rect.right = state.right.pos;
      rect.top = state.top.pos;
      rect.bottom = state.bottom.pos;
    }
    if (!active) break;
  }

  // Phase B: candidate stop positions per side — thin lines passed on the
  // way, the thick wall each side converged at, and up to two further thick
  // walls beyond it (closet fronts sit before the room's true wall).
  const scanBeyond = (side, fromPos, count) => {
    const found = [];
    let pos = fromPos;
    const limit = limitFor(side);
    let guard = 0;
    while (found.length < count && guard < 4000) {
      // Skip the wall body we are currently touching.
      let inWall = true;
      while (inWall && guard < 4000) {
        guard += 1;
        pos += side.dir;
        if (pos < 0 || pos > limit || !insideFootprint(side, pos)) return found;
        inWall = lineCoverage(side, pos).cov >= 0.3;
      }
      // Free space: advance to the next thick hit.
      let hit = null;
      while (!hit && guard < 4000) {
        guard += 1;
        pos += side.dir;
        if (pos < 0 || pos > limit || !insideFootprint(side, pos)) return found;
        const c = lineCoverage(side, pos);
        if (isThick(c)) hit = { pos, ...c };
        else if (c.cov >= 0.3) break; // thin line: skip its body, keep looking
      }
      if (hit) found.push(hit);
    }
    return found;
  };

  const candidatesFor = (side) => {
    const s = state[side.key];
    const list = [];
    for (const t of s.thinHits) {
      list.push({ edge: edgeFromHit(side, t.pos), cov: t.cov, thick: t.thick, kind: 'thin' });
    }
    if (s.hit) {
      list.push({ edge: edgeFromHit(side, s.hit.pos), cov: s.hit.cov, thick: s.hit.thick, kind: 'thick' });
      for (const b of scanBeyond(side, s.hit.pos, 2)) {
        list.push({ edge: edgeFromHit(side, b.pos), cov: b.cov, thick: b.thick, kind: 'beyond' });
      }
    } else {
      list.push({ edge: s.pos, cov: 0, thick: 0, kind: 'clamp' });
    }
    // Default choice: the wall growth converged at, else the last thin line
    // before the clamp (window bands read as thin), else the clamp itself.
    let def = list.findIndex((c) => c.kind === 'thick');
    if (def < 0 && list.length > 1) def = list.length - 2;
    if (def < 0) def = 0;
    return { list, def };
  };

  const cands = {};
  for (const side of SIDES) cands[side.key] = candidatesFor(side);

  const pick = { left: cands.left.def, right: cands.right.def, top: cands.top.def, bottom: cands.bottom.def };

  // Phase C: with parsed label dimensions, search candidate combinations for
  // the rectangle whose aspect best matches the label, penalizing choices
  // that skip past walls (closets extend rooms; leaks should not).
  const labelDims = options.labelDims;
  if (labelDims?.width > 0 && labelDims?.height > 0) {
    const target = labelDims.width / labelDims.height;
    const comboCost = (p) => {
      const w = cands.right.list[p.right].edge - cands.left.list[p.left].edge;
      const h = cands.bottom.list[p.bottom].edge - cands.top.list[p.top].edge;
      if (w < 6 || h < 6) return Infinity;
      const aspect = w / h;
      const err = Math.min(
        Math.abs(Math.log(aspect / target)),
        Math.abs(Math.log(aspect * target)) + 0.15,
      );
      let penalty = 0;
      for (const side of SIDES) {
        const { list, def } = cands[side.key];
        const chosen = list[p[side.key]];
        if (chosen.kind === 'beyond') penalty += 0.12 * (p[side.key] - def);
        else if (chosen.kind === 'thin' && def !== p[side.key]) penalty += 0.05;
        else if (chosen.kind === 'clamp' && list.length > 1) penalty += 0.1;
      }
      if (footprintInfo?.footprintArea && w * h > 0.55 * footprintInfo.footprintArea) {
        penalty += 0.6;
      }
      return err + penalty;
    };

    let best = { ...pick };
    let bestCost = comboCost(pick);
    const indices = (key) => cands[key].list.map((_, i) => i);
    for (const li of indices('left')) {
      for (const ri of indices('right')) {
        for (const ti of indices('top')) {
          for (const bi of indices('bottom')) {
            const p = { left: li, right: ri, top: ti, bottom: bi };
            const cost = comboCost(p);
            if (cost < bestCost - 1e-9) {
              bestCost = cost;
              best = p;
            }
          }
        }
      }
    }
    Object.assign(pick, best);
  }

  const chosen = {};
  for (const side of SIDES) chosen[side.key] = cands[side.key].list[pick[side.key]];

  // Open-plan rescue: if the aspect is still far off, one axis usually has no
  // real wall (the room opens into another space). Trust the wall-confirmed
  // axis, derive the scale it implies from the label, and place the weak
  // side at the label's stated distance.
  if (labelDims?.width > 0 && labelDims?.height > 0) {
    const target = labelDims.width / labelDims.height;
    const w0 = chosen.right.edge - chosen.left.edge;
    const h0 = chosen.bottom.edge - chosen.top.edge;
    const err0 = w0 > 0 && h0 > 0 ? Math.abs(Math.log((w0 / h0) / target)) : Infinity;
    if (err0 > 0.35) {
      const evidence = (c) => (c.kind === 'thick' || c.kind === 'beyond'
        ? c.cov + c.thick
        : c.kind === 'thin' ? c.cov * 0.5 : 0);
      const xScore = Math.min(evidence(chosen.left), evidence(chosen.right));
      const yScore = Math.min(evidence(chosen.top), evidence(chosen.bottom));
      if (yScore >= xScore && yScore > 0.5 && h0 > 6) {
        const expected = (h0 / labelDims.height) * labelDims.width;
        if (evidence(chosen.left) >= evidence(chosen.right)) {
          chosen.right = { edge: Math.min(width - 1, Math.round(chosen.left.edge + expected)), cov: 0, thick: 0, kind: 'virtual' };
        } else {
          chosen.left = { edge: Math.max(0, Math.round(chosen.right.edge - expected)), cov: 0, thick: 0, kind: 'virtual' };
        }
      } else if (xScore > 0.5 && w0 > 6) {
        const expected = (w0 / labelDims.width) * labelDims.height;
        if (evidence(chosen.top) >= evidence(chosen.bottom)) {
          chosen.bottom = { edge: Math.min(height - 1, Math.round(chosen.top.edge + expected)), cov: 0, thick: 0, kind: 'virtual' };
        } else {
          chosen.top = { edge: Math.max(0, Math.round(chosen.bottom.edge - expected)), cov: 0, thick: 0, kind: 'virtual' };
        }
      }
    }
  }
  const finalRect = {
    left: Math.min(chosen.left.edge, chosen.right.edge),
    right: Math.max(chosen.left.edge, chosen.right.edge),
    top: Math.min(chosen.top.edge, chosen.bottom.edge),
    bottom: Math.max(chosen.top.edge, chosen.bottom.edge),
  };

  const w = finalRect.right - finalRect.left + 1;
  const h = finalRect.bottom - finalRect.top + 1;
  if (w < 6 || h < 6) return null;
  if (px < finalRect.left - 2 || px > finalRect.right + 2
    || py < finalRect.top - 2 || py > finalRect.bottom + 2) return null;

  // Re-measure wall evidence over the final spans for confidence scoring.
  rect.left = finalRect.left;
  rect.right = finalRect.right;
  rect.top = finalRect.top;
  rect.bottom = finalRect.bottom;
  const sideScores = SIDES.map((side) => {
    const c = chosen[side.key];
    if (c.kind === 'clamp') return 0.3;
    if (c.kind === 'virtual') return 0.4;
    let best = { cov: 0, thick: 0 };
    for (let d = 0; d <= band * 2 + 2; d += 1) {
      const pos = c.edge + side.dir * d;
      if (pos < 0 || pos > limitFor(side)) break;
      const m = lineCoverage(side, pos);
      if (m.cov > best.cov) best = m;
    }
    const covScore = Math.min(1, best.cov / 0.75);
    const thickScore = thinPlan ? 1 : 0.6 + 0.4 * Math.min(1, best.thick / 0.4);
    return covScore * thickScore;
  });

  let confidence = sideScores.reduce((a, b) => a + b, 0) / sideScores.length;
  const rectArea = w * h;
  if (footprintInfo?.footprintArea && rectArea > 0.6 * footprintInfo.footprintArea) {
    confidence *= 0.5;
  }
  if (lb && (w < lb.width * 1.05 || h < lb.height * 1.05)) confidence *= 0.6;
  if (labelDims?.width > 0 && labelDims?.height > 0) {
    const aspect = w / h;
    const target = labelDims.width / labelDims.height;
    const err = Math.min(
      Math.abs(Math.log(aspect / target)),
      Math.abs(Math.log(aspect * target)),
    );
    confidence *= err < 0.1 ? 1 : err < 0.25 ? 0.85 : err < 0.5 ? 0.6 : 0.35;
  }
  confidence = Math.max(0.05, Math.min(0.98, confidence));

  return {
    rect: finalRect,
    confidence,
    sides: {
      left: chosen.left, right: chosen.right, top: chosen.top, bottom: chosen.bottom,
    },
  };
};
