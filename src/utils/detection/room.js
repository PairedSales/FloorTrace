// Room-from-label detection. A rectangle grows outward from the label until
// each side reaches thick-wall evidence: a column/row where wall coverage
// across the current perpendicular span is high. Door gaps only dent the
// coverage, so growth cannot leak through them the way a flood fill does.
// Thin high-coverage lines (counters, window glass, closet fronts) are kept
// as alternative stop candidates instead of hard stops; when the parsed label
// dimensions are known, a small combinatorial search picks the per-side
// candidates whose rectangle best matches the label's aspect ratio. The chosen
// edges are then seated on the wall faces they were only predicting.

import { satSum } from './raster.js';
import { coverageSats } from './analyze.js';
import { orientDimsToBox } from './validate.js';

const COV_STRONG = 0.6;
const COV_THIN = 0.8;
// Floor for a wall that a doorway has broken. Below this a side is genuinely
// open (a cased opening into the next room, an open-plan boundary) and the
// evidence is too weak to offer even as an alternative.
const COV_PARTIAL = 0.4;
// How far the default rectangle's aspect must sit from the label before its
// sides are reconsidered at all. Below this the drawing and the label agree and
// there is nothing to repair.
const ASPECT_SUSPECT = 0.15;
// An essentially unbroken wall across the whole span: a side this well drawn
// is a real side, and no label reading may invent one inside it.
const COV_SOLID = 0.9;
// Ink this faint is the space between two walls, not part of either: the floor
// a scan steps down through to know it has left the wall it was standing on.
const COV_BETWEEN = 0.3;
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

  // Built on first use and memoised per analysis: a trace that never places a
  // room never pays for them.
  const sats = coverageSats(analysis);

  const lineCoverage = (side, pos) => {
    let span;
    let cov;
    let thick;
    if (side.axis === 'x') {
      span = rect.bottom - rect.top + 1;
      cov = satSum(sats.smearH, width, height, pos, rect.top, pos, rect.bottom) / span;
      thick = satSum(sats.thickH, width, height, pos, rect.top, pos, rect.bottom) / span;
    } else {
      span = rect.right - rect.left + 1;
      cov = satSum(sats.smearV, width, height, rect.left, pos, rect.right, pos) / span;
      thick = satSum(sats.thickV, width, height, rect.left, pos, rect.right, pos) / span;
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
  // A real wall with a wide opening in it: thick where it is drawn, but covering
  // too little of the span to stop growth and too little to read as a thin line
  // either, since COV_THIN is *higher* than COV_STRONG. Such a wall was invisible
  // to both tests and simply passed through — a kitchen whose west wall is broken
  // by a 3'-3" doorway covers 58% of the side against COV_STRONG's 60%, so the
  // rectangle ran on through the doorway and stopped at the far wall of the next
  // room, 39% too wide. Recorded here as an option for the label-driven search;
  // never as a stop, and never as a default.
  const isPartial = (c) => c.cov >= COV_PARTIAL && c.cov < COV_STRONG && c.thick >= THICK_MIN;
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
        // Spacing test must be direction-agnostic: left/top grow toward
        // decreasing coordinates, so a `pos > lastThin + gap` test let those
        // sides record at most one thin candidate while right/bottom recorded
        // four, halving the search space asymmetrically.
        } else if (isThin(c) && Math.abs(pos - s.lastThin) > band * 2 + 2 && s.thinHits.length < 4) {
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
        inWall = lineCoverage(side, pos).cov >= COV_BETWEEN;
      }
      // Free space: advance to the next thick hit.
      let hit = null;
      while (!hit && guard < 4000) {
        guard += 1;
        pos += side.dir;
        if (pos < 0 || pos > limit || !insideFootprint(side, pos)) return found;
        const c = lineCoverage(side, pos);
        if (isThick(c)) hit = { pos, ...c };
        else if (c.cov >= COV_BETWEEN) break; // thin line: skip its body, keep looking
      }
      if (hit) found.push(hit);
    }
    return found;
  };

  // Phase A judges every side against whatever span the perpendicular sides
  // have reached so far, and its inner loop accelerates — one pass can carry a
  // side ~150 px while that span is still the label's own box. A wall broken by
  // a doorway at the label's height therefore reads as completely empty on the
  // way past: the kitchen's west wall covers 65% of the finished side but 0% of
  // the 13 px strip the scan actually judged it against, so the rectangle ran
  // through the doorway and stopped at the next room's far wall, 39% too wide.
  //
  // Re-walk each side once the rectangle has settled, when the span is the real
  // one, and collect the walls that were passed. Offered to the label-driven
  // search only; a side's default stop is never changed by what turns up here.
  const rescanSide = (side) => {
    const horizontal = side.key === 'left' || side.key === 'right';
    const from = horizontal ? px : py;
    const to = state[side.key].pos;
    const found = [];
    let last = -Infinity;
    let walls = 0;
    let inWall = false;
    for (let pos = from; side.dir < 0 ? pos > to : pos < to; pos += side.dir) {
      if (pos < 0 || pos > limitFor(side)) break;
      const c = lineCoverage(side, pos);
      // Out the far side of a wall, by the test scanBeyond already uses to step
      // over the one it is standing on.
      if (c.cov < COV_BETWEEN) {
        inWall = false;
        continue;
      }
      if (!isThick(c) && !isPartial(c)) continue;
      if (Math.abs(pos - last) <= band * 2 + 2) continue;
      // The budget is three WALLS, not three samples of one. A hatched or
      // double-drawn run is wider than the `band * 2 + 3` sample spacing, so
      // counting samples spent the whole budget inside the first two runs and
      // never reached the room's own wall — ExampleFloorplan6's LIVING ROOM,
      // whose left wall is the third run out, lost 11px off that edge.
      if (!inWall) {
        if (walls >= 3) break;
        walls += 1;
        inWall = true;
      }
      last = pos;
      found.push({ pos, ...c });
      // Phase C searches these four lists as a product, so a pathologically wide
      // run must not grow one without bound. Never reached on the fixtures; the
      // widest side offers 5.
      if (found.length >= 12) break;
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

  // Labels this room is not: every other parsed dimension label on the page,
  // in working px, minus any that already sit inside the rectangle growth
  // settled on — that one is an open plan sharing a space, or two labels for
  // one room, and neither is evidence of a leak.
  const foreign = (options.foreignPoints ?? []).filter((p) => !(
    p.x > rect.left && p.x < rect.right && p.y > rect.top && p.y < rect.bottom
  ));

  // Offer the walls Phase A passed over — but only once the ordinary search has
  // been tried and still cannot produce a rectangle the label agrees with.
  //
  // Gating on the DEFAULT rectangle is not enough: the default is frequently a
  // leaked rectangle that the ordinary search already repairs, so a
  // default-based gate opens this path on rooms that were about to come out
  // right and lets a marginally better-aspected candidate pull a correct edge
  // off its wall (measured: ExampleFloorplan6's LIVING ROOM moved 11px inward
  // off a wall at x=166-175, 99.2% -> 93.2% IoU). Gating on the search's own
  // best answer keeps this strictly a repair of last resort.
  const addRescanCandidates = () => {
    let added = false;
    for (const side of SIDES) {
      const { list } = cands[side.key];
      for (const p of rescanSide(side)) {
        const edge = edgeFromHit(side, p.pos);
        // The rescan re-finds the wall the side stopped at, and the thin lines
        // it recorded on the way; only new positions are worth adding.
        if (list.some((c) => Math.abs(c.edge - edge) <= band)) continue;
        list.push({ edge, cov: p.cov, thick: p.thick, kind: 'partial' });
        added = true;
      }
    }
    return added;
  };

  const pick = { left: cands.left.def, right: cands.right.def, top: cands.top.def, bottom: cands.bottom.def };

  // Phase C: with parsed label dimensions, search candidate combinations for
  // the rectangle whose aspect best matches the label, penalizing choices
  // that skip past walls (closets extend rooms; leaks should not).
  const labelDims = options.labelDims;

  // Aspect alone is invariant to both translation and scale: a rectangle of
  // exactly the right shape assembled from the wrong pair of walls scores
  // perfectly. Where the project already has a scale — from the rooms placed
  // before this one, or an explicit calibration — the label states the room's
  // size in pixels outright, which is the one piece of evidence that can tell
  // those apart. Supplied in working-scale px per foot, or null on the first
  // room, where behaviour is unchanged.
  // The tolerance is not conservatism for its own sake: printed dimensions are
  // nominal and are not all measured to the same face, so the labels on one
  // real plan imply scales spanning ~15% between rooms (ExampleFloorplan6:
  // 13.97 to 16.36 px/ft). Anything inside that band is the drawing being
  // normal, and a prior that argues with it moves correct edges. Beyond it,
  // a room has leaked through a doorway or stopped a bay short.
  const SCALE_TOLERANCE = 0.22;
  const ppf = options.pixelsPerFoot;
  const scaled = ppf?.x > 0 && ppf?.y > 0 && labelDims?.width > 0 && labelDims?.height > 0
    ? (w, h) => {
      const off = (actual, expected) =>
        Math.max(0, Math.abs(Math.log(actual / expected)) - SCALE_TOLERANCE);
      // The label may state the room the other way round, exactly as the
      // aspect test already allows for; the swapped reading pays for itself.
      const direct = off(w, labelDims.width * ppf.x) + off(h, labelDims.height * ppf.y);
      const swapped = off(w, labelDims.height * ppf.x)
        + off(h, labelDims.width * ppf.y) + 0.3;
      return Math.min(direct, swapped) / 2;
    }
    : null;

  if (labelDims?.width > 0 && labelDims?.height > 0) {
    const target = labelDims.width / labelDims.height;
    const comboCost = (p) => {
      const left = cands.left.list[p.left].edge;
      const right = cands.right.list[p.right].edge;
      const top = cands.top.list[p.top].edge;
      const bottom = cands.bottom.list[p.bottom].edge;
      const w = right - left;
      const h = bottom - top;
      if (w < 6 || h < 6) return Infinity;
      // The room must still contain the click — a nicely-aspected rectangle
      // between other candidates (counters, a neighbouring room) is not it.
      if (px < left - 2 || px > right + 2 || py < top - 2 || py > bottom + 2) {
        return Infinity;
      }
      // And it must not contain somebody else's. A room is not named twice, so
      // a rectangle holding another label's dimensions is one that grew through
      // a wall — the shape the label wants, assembled out of two rooms. Only
      // the batch supplies these: a single click knows of no other label, and
      // behaves exactly as it did.
      for (const other of foreign) {
        if (other.x > left + 2 && other.x < right - 2
          && other.y > top + 2 && other.y < bottom - 2) {
          return Infinity;
        }
      }
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
        // Weaker evidence than a thin line — the wall is there but a door is
        // missing from it — so it costs more, and only a label the geometry
        // genuinely fits will buy it. The fixtures are insensitive to the exact
        // figure (0.08, 0.15 and 0.25 all give identical results across the set),
        // so it is set on the conservative side of that range.
        else if (chosen.kind === 'partial') penalty += 0.15;
        else if (chosen.kind === 'clamp' && list.length > 1) penalty += 0.1;
      }
      if (footprintInfo?.footprintArea && w * h > 0.55 * footprintInfo.footprintArea) {
        penalty += 0.6;
      }
      // Added to the aspect term rather than replacing it, so a scale that is
      // itself a little off can break ties without overruling the drawing.
      if (scaled) penalty += 0.6 * scaled(w, h);
      return err + penalty;
    };

    let best = { ...pick };
    let bestCost = comboCost(pick);
    const indices = (key) => cands[key].list.map((_, i) => i);
    const search = () => {
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
    };
    search();

    // Still the wrong shape after considering every ordinary candidate: the
    // side the label wants is a wall Phase A never recorded, because it judged
    // it against a span that was still only the label's own box. Re-walk the
    // sides now that the rectangle has settled and search again over the
    // widened set. `best`/`bestCost` carry over, so this can only improve on
    // the answer the ordinary search reached.
    const shapeOf = (p) => {
      const w = cands.right.list[p.right].edge - cands.left.list[p.left].edge;
      const h = cands.bottom.list[p.bottom].edge - cands.top.list[p.top].edge;
      return w > 0 && h > 0
        ? Math.min(Math.abs(Math.log((w / h) / target)), Math.abs(Math.log((w / h) * target)))
        : Infinity;
    };
    if (shapeOf(best) > ASPECT_SUSPECT && addRescanCandidates()) search();

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
    // A label written the other way round is not an open plan. If the
    // transposed reading explains this rectangle almost exactly there is
    // nothing to rescue, and rescuing anyway invented a side across a room
    // that was fully drawn — the guard below cannot catch it, because any wall
    // with a door in it reads well short of solid.
    // Only near-exact, deliberately: a rectangle that is merely closer one way
    // round than the other is how a room that stopped a bay short looks, and
    // that one does need the rescue.
    const errSwapped = w0 > 0 && h0 > 0 ? Math.abs(Math.log((w0 / h0) * target)) : Infinity;
    if (err0 > 0.35 && errSwapped > 0.1) {
      const evidence = (c) => (c.kind === 'thick' || c.kind === 'beyond'
        ? c.cov + c.thick
        : c.kind === 'thin' ? c.cov * 0.5 : 0);
      const xScore = Math.min(evidence(chosen.left), evidence(chosen.right));
      const yScore = Math.min(evidence(chosen.top), evidence(chosen.bottom));
      // Best wall coverage within a band of an invented edge: is anything
      // actually drawn where the label says the room ends?
      const inkAt = (axis, edge) => {
        let best = 0;
        for (let d = -band; d <= band; d += 1) {
          const pos = edge + d;
          if (pos < 0 || pos > limitFor({ axis })) continue;
          best = Math.max(best, lineCoverage({ axis }, pos).cov);
        }
        return best;
      };
      // A label states two lengths but not which one runs across the page, so
      // both readings are candidates and the ink at the edge each one implies
      // decides between them. Ties keep the label as written.
      const bestEdge = (axis, lengths, place) => {
        let best = null;
        for (const len of lengths) {
          const edge = place(Math.round(len));
          if (edge === null) continue;
          const cov = inkAt(axis, edge);
          if (!best || cov > best.cov + 1e-9) best = { edge, cov };
        }
        return best;
      };
      // The rescue invents a side, so the drawing has to justify it: either
      // there is wall ink where it lands, or the side it replaces was never a
      // solid wall. Without this, a rectangle closed on all four sides was cut
      // down to the aspect of a label that merely read the other way round —
      // silently, since the room then agreed with its own label perfectly.
      const justified = (current, best) => best
        && (best.cov >= 0.3
          || !((current.kind === 'thick' || current.kind === 'beyond') && current.cov >= COV_SOLID));
      // A virtual side may only pull the rect inward: pushing past the
      // wall-confirmed (or footprint-clamped) edge would leave the room, and
      // it must not cut the clicked point out of the rect.
      // Measured against this room's own wall-confirmed axis, deliberately,
      // and not against the project scale: the label's stated feet and the
      // drawing's px/ft disagree by up to 15% room to room, and the confirmed
      // axis carries this room's own version of that error, so the ratio
      // cancels it. Substituting the project median here moved a correct
      // open-plan edge by 21px.
      if (yScore >= xScore && yScore > 0.5 && h0 > 6) {
        const lengths = [
          (h0 / labelDims.height) * labelDims.width,
          (h0 / labelDims.width) * labelDims.height,
        ];
        if (evidence(chosen.left) >= evidence(chosen.right)) {
          const best = bestEdge('x', lengths, (len) => {
            const edge = chosen.left.edge + len;
            return edge < chosen.right.edge && edge >= px - 2 ? edge : null;
          });
          if (justified(chosen.right, best)) {
            chosen.right = { edge: best.edge, cov: 0, thick: 0, kind: 'virtual' };
          }
        } else {
          const best = bestEdge('x', lengths, (len) => {
            const edge = chosen.right.edge - len;
            return edge > chosen.left.edge && edge <= px + 2 ? edge : null;
          });
          if (justified(chosen.left, best)) {
            chosen.left = { edge: best.edge, cov: 0, thick: 0, kind: 'virtual' };
          }
        }
      } else if (xScore > 0.5 && w0 > 6) {
        const lengths = [
          (w0 / labelDims.width) * labelDims.height,
          (w0 / labelDims.height) * labelDims.width,
        ];
        if (evidence(chosen.top) >= evidence(chosen.bottom)) {
          const best = bestEdge('y', lengths, (len) => {
            const edge = chosen.top.edge + len;
            return edge < chosen.bottom.edge && edge >= py - 2 ? edge : null;
          });
          if (justified(chosen.bottom, best)) {
            chosen.bottom = { edge: best.edge, cov: 0, thick: 0, kind: 'virtual' };
          }
        } else {
          const best = bestEdge('y', lengths, (len) => {
            const edge = chosen.bottom.edge - len;
            return edge > chosen.top.edge && edge <= py + 2 ? edge : null;
          });
          if (justified(chosen.top, best)) {
            chosen.top = { edge: best.edge, cov: 0, thick: 0, kind: 'virtual' };
          }
        }
      }
    }
  }

  // Phase D: seat each edge on the wall's interior face. `edgeFromHit` puts it
  // `band - 1` px past the trigger, which assumes the smear trips exactly a
  // band early — but it trips only once coverage across the *current* span
  // crosses, and that span is still partial during lockstep growth, so a side
  // dented by a door trips late and the edge lands inside the wall body. Every
  // room came out a little large and every room-derived scale a little high.
  // The final span is known here, so measure the face rather than predict it.
  // All four sides measure against the same box, so the result cannot depend
  // on the order they are seated in.
  const box = {
    left: Math.min(chosen.left.edge, chosen.right.edge),
    right: Math.max(chosen.left.edge, chosen.right.edge),
    top: Math.min(chosen.top.edge, chosen.bottom.edge),
    bottom: Math.max(chosen.top.edge, chosen.bottom.edge),
  };
  Object.assign(rect, box);

  // Unsmeared, so the reading is the wall itself and not its ±band halo. The
  // floor is low deliberately: a wall with a door in it is well short of solid.
  const RAW_COV = 0.35;
  const coverageIn = (mask) => (side, pos) => {
    let n = 0;
    if (side.axis === 'x') {
      if (pos < 0 || pos >= width) return 0;
      for (let y = rect.top; y <= rect.bottom; y += 1) n += mask[y * width + pos];
      return n / (rect.bottom - rect.top + 1);
    }
    if (pos < 0 || pos >= height) return 0;
    const row = pos * width;
    for (let x = rect.left; x <= rect.right; x += 1) n += mask[row + x];
    return n / (rect.right - rect.left + 1);
  };
  const rawCoverage = coverageIn(analysis.wallMask);
  const inkCoverage = coverageIn(analysis.cleaned);

  // The edge can sit short of the face, inside the body, or clear of the wall
  // altogether, so look both ways. The run is judged against the strongest
  // reading in that window rather than a flat threshold: a closet partition or
  // door frame butted against a wall covers part of the same span, and a flat
  // threshold walked straight through it into the room.
  const seekFace = (side, edge, click) => {
    const out = band + 2;
    const back = wallThickness + band;
    const at = (d) => rawCoverage(side, edge + side.dir * d);
    let floor = 0;
    for (let d = -back; d <= out; d += 1) floor = Math.max(floor, at(d));
    if (floor < RAW_COV) return edge;
    floor = Math.max(RAW_COV, floor * 0.6);

    // Nearest qualifying line to the edge, not the strongest in the window:
    // the wall growth stopped at is the one being seated.
    let found = null;
    for (let r = 0; r <= Math.max(out, back) && found === null; r += 1) {
      if (r <= out && at(r) >= floor) found = r;
      else if (r > 0 && r <= back && at(-r) >= floor) found = -r;
    }
    if (found === null) return edge;
    let pos = edge + side.dir * found;

    // Hatched and double-drawn walls dip inside their own body, so a dip is
    // only the end of the run if the run does not pick up again within a
    // wall's thickness.
    const gap = Math.max(2, wallThickness);
    const maxBack = Math.max(4, wallThickness * 2 + band);
    for (let moved = 0; moved < maxBack;) {
      let step = 0;
      for (let g = 1; g <= gap && moved + g <= maxBack; g += 1) {
        if (rawCoverage(side, pos - side.dir * g) >= floor) {
          step = g;
          break;
        }
      }
      if (!step) break;
      pos -= side.dir * step;
      moved += step;
    }

    // `wallMask` carries a one-pixel halo — the tolerant dilate long-run
    // extraction needs — so its inner face sits a pixel inside the drawn wall.
    // Give that pixel back where the ink agrees it is blank: shrinking a room
    // by a pixel on every side is ~1% of a 200px room, and it is systematic.
    let face = pos - side.dir;
    if (inkCoverage(side, face + side.dir) < floor) face += side.dir;
    if (side.dir > 0 ? face < click : face > click) return edge;
    return Math.max(0, Math.min(limitFor(side), face));
  };

  for (const side of SIDES) {
    const c = chosen[side.key];
    // A clamp is the footprint edge and a virtual side is the label's, not a
    // wall face; neither came through `edgeFromHit` and neither has ink to seek.
    if (c.kind === 'clamp' || c.kind === 'virtual') continue;
    const edge = seekFace(side, c.edge, side.axis === 'x' ? px : py);
    if (edge !== c.edge) chosen[side.key] = { ...c, edge };
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
  // Agreeing with its own label proves only that the rectangle has the right
  // shape — a room measured one bay off agrees with itself perfectly. The
  // rooms already placed are the second opinion on its size, and the scale
  // this one is about to set for the whole project depends on it.
  if (scaled) {
    const sizeErr = scaled(w, h);
    confidence *= sizeErr <= 0 ? 1 : sizeErr < 0.15 ? 0.8 : sizeErr < 0.35 ? 0.55 : 0.3;
  }
  confidence = Math.max(0.05, Math.min(0.98, confidence));

  // Is this side on the outside of the building? Walking outward from the wall
  // face past the wall band leaves the footprint for an exterior wall and
  // stays inside it for a partition. The test was already being performed at
  // every growth step by `insideFootprint`; only the answer was never kept —
  // and it is the interior/exterior wall distinction the boundary stage has
  // no other way to make.
  const exteriorSide = (side, edge) => {
    if (!footprint) return null;
    const depth = Math.max(6, wallThickness * 4);
    for (let d = 1; d <= depth; d += 1) {
      const pos = edge + side.dir * d;
      if (pos < 0 || pos > limitFor(side)) return true;
      const probe = side.axis === 'x'
        ? { x: pos, y: (finalRect.top + finalRect.bottom) >> 1 }
        : { x: (finalRect.left + finalRect.right) >> 1, y: pos };
      if (!footprint[probe.y * width + probe.x]) return true;
    }
    return false;
  };
  for (const side of SIDES) {
    chosen[side.key] = { ...chosen[side.key], exterior: exteriorSide(side, chosen[side.key].edge) };
  }

  // The scale this one room implies. A per-room px/ft is what makes a robust
  // multi-room calibration (and any cross-check between rooms) possible.
  // Oriented to the rectangle: every scoring term above already accepts the
  // label the other way round, so dividing by the unswapped pair here is what
  // turned a transposed label into a room that implies two different scales.
  const oriented = labelDims?.width > 0 && labelDims?.height > 0
    ? orientDimsToBox(labelDims.width, labelDims.height, w, h)
    : null;
  const pixelsPerFoot = oriented
    ? { x: w / oriented.width, y: h / oriented.height }
    : null;

  return {
    rect: finalRect,
    confidence,
    pixelsPerFoot,
    sides: {
      left: chosen.left, right: chosen.right, top: chosen.top, bottom: chosen.bottom,
    },
  };
};
