// Second-chance tracing.
//
// The exterior stage already knew when it was doubtful. It scores every
// candidate against the rooms and dimension labels the rest of the app has
// located, and a footprint that excludes one of them is not merely suspicious
// — it is provably wrong, because those points are inside the building by
// construction. Until now that only lowered a number and wrote a warning: the
// app reported "2 labelled areas fall outside the traced outline" and handed
// over the outline anyway.
//
// Here that finding drives another search. The shape of the failure chooses
// which hypothesis to try next, the same scorer judges the result, and an
// attempt replaces the incumbent only when it holds more of what is known
// without trusting itself less. So remediation can improve an answer and
// cannot silently make one worse.
//
// Two passes, ordered by what the diagnosis says is wrong:
//
//  join      the missed constraint is not inside any wall network — the page
//            was partitioned into pieces of one building. Re-run the networks
//            that surround it as a single network. No closing radius can fix
//            this, which is why it is a pass and not a wider ladder.
//  escalate  the missed constraint is inside a network the closing search
//            failed to reach. Force every rescue hypothesis and widen the
//            closing ladder over the same partition.
//
// Draw mode is deliberately exempt. There the user's stroke declares both the
// partition and the intent, and a label outside a painted outline is usually a
// deliberate exclusion (scoring.js and validate.js both already soften for it);
// re-searching would talk the tracer out of the answer it was given.

import { bridgeRuns } from './raster.js';
import { netSelfSeals } from './candidates.js';
import { rectCoverage, warning } from './scoring.js';
import { constraintFactor } from './validate.js';

// Below this the trace is worth a second attempt on its own, with no constraint
// to point at. Matches boundaryQuality's QUALITY_GOOD: the same line that
// decides whether the user is shown a plain success or asked to check it.
export const REMEDIATION_CONFIDENCE = 0.75;

// A candidate hypothesis has to beat the incumbent by more than float noise.
const CONFIDENCE_EPSILON = 1e-3;

// Bounds on the second chance. Each pass is a full candidate generation over
// its networks, which is most of a trace, so the ceiling is what keeps a
// pathological page from turning one doubtful answer into five searches. Rounds
// exist because a join can strand a different label; passes cap the total.
const MAX_ROUNDS = 3;
const MAX_PASSES = 4;

// How much of a room rectangle must be enclosed to count as held. Same bar
// scoreConstraints uses, and deliberately the same number: the search and the
// adjudication must not disagree about whether a room is inside.
const ROOM_COVER = 0.9;

const bboxAreaOf = (bbox) => (bbox.maxX - bbox.minX + 1) * (bbox.maxY - bbox.minY + 1);

const pointInMask = (mask, width, height, x, y) => {
  const px = Math.round(x);
  const py = Math.round(y);
  if (px < 0 || py < 0 || px >= width || py >= height) return false;
  return Boolean(mask[py * width + px]);
};

/**
 * Which of the known-inside constraints this attempt actually holds.
 *
 * Measured on the floors' footprint masks — the geometry the app bills area
 * against — rather than on one winning candidate, because a constraint held by
 * any floor of a multi-floor sheet is held. Constraints sitting inside a region
 * the tracer deliberately carved out are exempt: a label in a garage is outside
 * the living area on purpose, and counting it as a miss would send remediation
 * hunting for a footprint that annexes the very thing the carve removed.
 */
export const measureHold = (floors, constraints, analysis) => {
  const { width, height, wallThickness } = analysis;
  const rooms = constraints?.rooms ?? [];
  const points = constraints?.interiorPoints ?? [];
  const total = rooms.length + points.length;
  if (!total) return { held: 0, total: 0, missed: [] };

  const carved = floors.flatMap((f) => f.excludedRegions ?? []).filter((r) => r.bbox);
  const exempt = (x, y) => carved.some((r) =>
    x >= r.bbox.minX - wallThickness && x <= r.bbox.maxX + wallThickness
    && y >= r.bbox.minY - wallThickness && y <= r.bbox.maxY + wallThickness);

  const missed = [];
  let held = 0;
  for (const room of rooms) {
    const rect = room.rect ?? room;
    const cx = (rect.left + rect.right) / 2;
    const cy = (rect.top + rect.bottom) / 2;
    const inside = floors.some(
      (f) => rectCoverage(f.footprintMask, width, height, rect) >= ROOM_COVER,
    );
    if (inside || exempt(cx, cy)) held += 1;
    else missed.push({ kind: 'room', x: cx, y: cy, name: room.name ?? null });
  }
  for (const point of points) {
    const inside = floors.some((f) => pointInMask(f.footprintMask, width, height, point.x, point.y));
    if (inside || exempt(point.x, point.y)) held += 1;
    else missed.push({ kind: 'point', x: point.x, y: point.y, name: point.name ?? null });
  }
  return { held, total, missed };
};

// How many of the four directions must find a wall before a point counts as
// enclosed by something. Three rather than four so one window-swallowed side
// does not disqualify a real room, and three rather than two so a stray label
// floating on the sheet — a title block, a north arrow misread as a dimension —
// cannot implicate anything.
const ENCLOSED_SIDES = 3;

/**
 * Which wall networks a point sits between.
 *
 * The point is walked outward along each axis until it meets wall; the four
 * stopping places are the extent of the room it is in, and every network
 * reaching into that extent is a network that has to be part of one building
 * for the point to be inside anything at all.
 *
 * Two details are load-bearing, and both were learned by getting them wrong:
 *
 *  - the ray steps off whatever the point is standing on before it starts
 *    looking. A constraint point is the centre of an OCR label, so it sits *on*
 *    ink by construction, and a ray that does not step off first reports the
 *    label's own glyphs as the nearest wall in all four directions — an extent
 *    the size of the label, implicating nothing.
 *  - it is over a *mask*, not over network membership. Walking network
 *    membership makes the ray blind to wall the partitioner dropped for being
 *    too small to be a network — which is precisely the ink whose loss broke
 *    the outline, so the ray goes blind exactly where the answer is.
 */
export const implicatedNets = (point, nets, probeMask, width, height, pad) => {
  const px = Math.round(point.x);
  const py = Math.round(point.y);
  const box = { minX: px, minY: py, maxX: px, maxY: py };
  const cast = (dx, dy) => {
    let x = px;
    let y = py;
    const outside = () => x < 0 || y < 0 || x >= width || y >= height;
    while (!outside() && probeMask[y * width + x]) { x += dx; y += dy; }
    while (!outside() && !probeMask[y * width + x]) { x += dx; y += dy; }
    if (outside()) return false;
    if (x < box.minX) box.minX = x;
    if (x > box.maxX) box.maxX = x;
    if (y < box.minY) box.minY = y;
    if (y > box.maxY) box.maxY = y;
    return true;
  };
  const sides = [cast(-1, 0), cast(1, 0), cast(0, -1), cast(0, 1)].filter(Boolean).length;
  if (sides < ENCLOSED_SIDES) return [];

  const found = [];
  for (let i = 0; i < nets.length; i += 1) {
    const b = nets[i].bbox;
    if (b.minX <= box.maxX + pad && box.minX <= b.maxX + pad
      && b.minY <= box.maxY + pad && box.minY <= b.maxY + pad) found.push(i);
  }
  return found;
};

// Which network owns each pixel, or -1. Ink the partitioner dropped as too
// small to be a network reads as -1, which is what lets `joinNets` pick it back
// up: the fragment of exterior wall left between two window openings is exactly
// the ink whose loss broke the outline in the first place.
export const netMembership = (nets, length) => {
  const membership = new Int32Array(length).fill(-1);
  for (let i = 0; i < nets.length; i += 1) {
    const mask = nets[i].mask;
    for (let k = 0; k < mask.length; k += 1) if (mask[k]) membership[k] = i;
  }
  return membership;
};

/**
 * One network from several: their wall pixels, plus any ink inside their
 * combined extent that belongs to no network at all.
 *
 * The second half is the point. A partition breaks because pieces of one
 * outline fell below the size at which a piece is worth calling a network, so
 * rejoining only the surviving pieces still leaves the outline holed. Ink
 * belonging to *another* kept network is deliberately not taken: that is the
 * case where the join would swallow a neighbouring plan.
 */
export const joinNets = (ids, nets, boundaryMask, membership, width, height, pad) => {
  const box = { minX: width, minY: height, maxX: -1, maxY: -1 };
  for (const id of ids) {
    const b = nets[id].bbox;
    if (b.minX < box.minX) box.minX = b.minX;
    if (b.minY < box.minY) box.minY = b.minY;
    if (b.maxX > box.maxX) box.maxX = b.maxX;
    if (b.maxY > box.maxY) box.maxY = b.maxY;
  }
  const x0 = Math.max(0, box.minX - pad);
  const y0 = Math.max(0, box.minY - pad);
  const x1 = Math.min(width - 1, box.maxX + pad);
  const y1 = Math.min(height - 1, box.maxY + pad);

  const mask = new Uint8Array(width * height);
  let wallSize = 0;
  const bbox = { minX: width, minY: height, maxX: -1, maxY: -1 };
  const take = (x, y, i) => {
    mask[i] = 1;
    wallSize += 1;
    if (x < bbox.minX) bbox.minX = x;
    if (x > bbox.maxX) bbox.maxX = x;
    if (y < bbox.minY) bbox.minY = y;
    if (y > bbox.maxY) bbox.maxY = y;
  };
  // This single sweep is the whole join, and it collects the wanted networks
  // too rather than unioning their masks separately: every network was labelled
  // out of this same `boundaryMask`, and the box is the union of their own
  // extents, so a wanted pixel outside this window does not exist.
  const wanted = new Set(ids);
  for (let y = y0; y <= y1; y += 1) {
    const row = y * width;
    for (let x = x0; x <= x1; x += 1) {
      const i = row + x;
      if (!boundaryMask[i]) continue;
      const owner = membership[i];
      if (owner >= 0 && !wanted.has(owner)) continue;
      take(x, y, i);
    }
  }
  if (bbox.maxX < 0) return null;
  return { mask, bbox, wallSize };
};

/**
 * The partition this attempt should have used, given what it missed.
 *
 * Returns null when no join is warranted, which is the common and correct
 * answer. A join is refused when two or more of the implicated networks each
 * enclose their own extent, because that is the definition the partitioner
 * already uses for "two drawings rather than one" — a sheet carrying four floor
 * plans must not become one building because a stray label sits between two of
 * them. What a constraint buys is the removal of the *bounding-box overlap*
 * precondition, not the removal of that rule.
 */
const planJoin = (missed, nets, analysis, boundaryMask) => {
  const { width, height, wallThickness } = analysis;
  if (nets.length < 2) return null;
  const membership = netMembership(nets, width * height);

  // What the rays are cast over: wall ink with its colinear gaps welded shut,
  // measured at page scale because this is a page-level question. Unwelded, a
  // ray leaving through a window opening finds nothing and the room reads as
  // unbounded on that side. Welding can only bring a hit *nearer*, never
  // further, so it makes the implicated extent smaller everywhere except where
  // it turns a miss into a hit — which is the whole reason for it.
  const probeMask = bridgeRuns(
    analysis.wallMask ?? boundaryMask, width, height,
    Math.max(24, wallThickness * 12, Math.round(Math.max(width, height) * 0.3)),
    Math.max(8, wallThickness * 2),
  );

  const pad = Math.max(8, wallThickness * 2);
  const extentOf = (ids) => [...ids].reduce((box, id) => {
    const b = nets[id].bbox;
    return {
      minX: Math.min(box.minX, b.minX),
      minY: Math.min(box.minY, b.minY),
      maxX: Math.max(box.maxX, b.maxX),
      maxY: Math.max(box.maxY, b.maxY),
    };
  }, { minX: width, minY: height, maxX: -1, maxY: -1 });

  let groups = [];
  for (const miss of missed) {
    const ids = implicatedNets(miss, nets, probeMask, width, height, pad);
    if (ids.length < 2) continue;
    groups.push(new Set(ids));
  }
  if (!groups.length) return null;

  // Two labels in one dismembered building must produce one join, not two
  // overlapping ones. Sharing a network is the obvious sign of that, but not a
  // sufficient one: on a plan broken into four corner fragments the two labels
  // implicate disjoint sets of them, and joining separately leaves each half
  // still missing the other's rooms. Overlapping extents settle it, and keep
  // two genuinely separate plans — whose extents do not overlap — apart.
  for (let merged = true; merged;) {
    merged = false;
    outer: for (let i = 0; i < groups.length; i += 1) {
      for (let j = i + 1; j < groups.length; j += 1) {
        const a = extentOf(groups[i]);
        const b = extentOf(groups[j]);
        if (a.minX > b.maxX + pad || b.minX > a.maxX + pad
          || a.minY > b.maxY + pad || b.minY > a.maxY + pad) continue;
        for (const id of groups[j]) groups[i].add(id);
        groups.splice(j, 1);
        merged = true;
        break outer;
      }
    }
  }
  groups = groups.filter((g) => g.size >= 2);
  if (!groups.length) return null;

  const selfSeals = new Map();
  const sealsAlone = (id) => {
    if (!selfSeals.has(id)) {
      const net = nets[id];
      selfSeals.set(id, netSelfSeals(net.mask, width, height, net.bbox, wallThickness));
    }
    return selfSeals.get(id);
  };

  const joined = [];
  const consumed = new Set();
  for (const group of groups) {
    const ids = [...group];
    if (ids.filter(sealsAlone).length >= 2) continue;
    const net = joinNets(ids, nets, boundaryMask, membership, width, height, pad);
    if (!net) continue;
    joined.push(net);
    for (const id of ids) consumed.add(id);
  }
  if (!joined.length) return null;

  // Joined networks first, then whatever was left untouched, largest first —
  // the order `partitionWallNetworks` hands over and the order the floor
  // budget is spent in.
  const rest = nets.filter((_, i) => !consumed.has(i));
  return [...joined, ...rest].sort((a, b) => bboxAreaOf(b.bbox) - bboxAreaOf(a.bbox));
};

/**
 * Is this attempt worth another? Cheap, and deliberately generous: the passes
 * themselves cost the search, and every one of them is adjudicated, so a
 * needless attempt wastes time and cannot corrupt the answer.
 */
export const shouldRemediate = (result, analysis, options = {}) => {
  if (options.brush || options.remediate === false) return false;
  // No boundary at all is the worst confidence there is, and the case a second
  // attempt has most room to improve — the first search returning nothing is
  // exactly when it must not be the last word.
  if (!result) return true;
  const constraints = options.constraints ?? null;
  const hold = measureHold(result.floors ?? [], constraints, analysis);
  if (hold.missed.length) return true;
  const threshold = options.remediationConfidence ?? REMEDIATION_CONFIDENCE;
  return result.confidence < threshold;
};

// The confidence this attempt would actually be shown at: the detector's own
// number discounted by the known-inside constraints it fails, exactly as
// validate.js discounts it at the page level.
//
// The discount cannot be left to the detector's own confidence, because inside
// the network that caused the miss the miss is invisible: `detectFloorNet`
// scopes constraints to the network being searched, so a label stranded in a
// dismembered neighbouring fragment is filtered out before scoring sees it.
// That is why the base attempt below reports 0.93 while the app shows 0.47.
const effectiveConfidence = (attempt) => (attempt?.result
  ? attempt.result.confidence * constraintFactor(attempt.hold.missed.length, attempt.hold.total)
  : 0);

// Strictly better: no less of what is known held, and more self-trust once the
// misses are charged for. Both halves are load-bearing. Effective confidence
// alone would let a footprint that annexes the page win by having nothing left
// to miss; hold alone would let one that swallows two plans win for holding
// both their labels.
const isBetter = (next, prev) => {
  if (!next?.result) return false;
  if (next.hold.held < prev.hold.held) return false;
  return effectiveConfidence(next) > effectiveConfidence(prev) + CONFIDENCE_EPSILON;
};

const summarise = (attempt) => (attempt?.result
  ? {
    confidence: Number(attempt.result.confidence.toFixed(3)),
    effective: Number(effectiveConfidence(attempt).toFixed(3)),
    held: attempt.hold.held,
    of: attempt.hold.total,
    floors: attempt.result.floors.length,
  }
  : {
    confidence: null, effective: 0, held: 0, of: attempt?.hold?.total ?? 0, floors: 0,
  });

/**
 * Run the remediation passes and return whichever attempt won.
 *
 * `attempt(nets, options, passKey)` is `assembleFloors` bound to this trace, so
 * a pass is expressed purely as "these networks, these options" and is scored,
 * validated and aggregated by exactly the code that produced the first answer.
 */
export const remediateTrace = ({ analysis, options, nets, base, attempt }) => {
  const constraints = options.constraints ?? null;
  const boundaryMask = options.mask ?? analysis.boundaryMask;
  const holdOf = (result) => measureHold(result?.floors ?? [], constraints, analysis);

  const baseHold = holdOf(base);
  let incumbent = { id: 'base', result: base, hold: baseHold, nets };
  const before = summarise(incumbent);
  const tried = [];
  const spent = new Set();

  const maxRadius = options.maxCloseRadius
    ?? Math.max(32, Math.round(Math.max(analysis.width, analysis.height) * 0.045));
  const widerLadder = (opts) => ({
    ...opts,
    forceRescues: true,
    // Twice the ladder the base attempt climbed. A wider closing is invented
    // geometry, so it is charged for by `economy` and reported by
    // `heavy-closing`; it wins only if it is worth that.
    maxCloseRadius: maxRadius * 2,
  });

  // Is a wider ladder even capable of changing the answer?
  //
  // The ladder is climbed from r=2 upward and every rung is scored, so a winner
  // that sealed well below the ceiling already beat all the wider rungs that
  // existed. Raising the ceiling only appends rungs above those — strictly more
  // invented geometry, scoring strictly worse on `economy`. Escalating there is
  // a full candidate regeneration per network that cannot win.
  //
  // It is worth trying when the ceiling was actually reached (same 0.6 the
  // `heavy-closing` warning uses, for the same reason), when nothing closed at
  // all, or when something known-inside was left out — in the last case the
  // first answer is provably wrong and anything is worth a try.
  //
  // Without this gate, ExampleFloorplan4 (71% confidence, sealed at r=17 of 42)
  // paid for a second full search on every trace and never once accepted it,
  // which is most of a 55% slowdown in the search-memo suite.
  const ladderWasBinding = (result) =>
    (result?.floors ?? []).some((floor) => floor.sealRadius >= 0.6 * maxRadius);
  const escalationCouldHelp = !base || base.usedFallback
    || baseHold.missed.length > 0 || ladderWasBinding(base);

  // Diagnose, attempt, adjudicate, diagnose again. Re-planning against the
  // partition that actually won matters: joining the networks around one
  // stranded label can leave a second label stranded among networks the first
  // join did not touch, and only a fresh diagnosis sees that.
  for (let round = 0; round < MAX_ROUNDS && tried.length < MAX_PASSES; round += 1) {
    const passes = [];
    // Ordered by what the diagnosis says. A missed constraint that implicates
    // several networks is a partition failure, and no amount of extra closing
    // over the same partition addresses it.
    if (incumbent.hold.missed.length) {
      const joinedNets = planJoin(incumbent.hold.missed, incumbent.nets, analysis, boundaryMask);
      if (joinedNets) {
        passes.push({
          id: `join${round ? `-${round + 1}` : ''}`,
          nets: joinedNets,
          options: { ...options, forceRescues: true },
        });
      }
    }
    if (!spent.has('escalate') && escalationCouldHelp) {
      passes.push({ id: 'escalate', nets: incumbent.nets, options: widerLadder(options) });
    }
    if (!passes.length) break;

    let advanced = false;
    for (const pass of passes) {
      if (tried.length >= MAX_PASSES) break;
      spent.add(pass.id === 'escalate' ? 'escalate' : 'join');
      const result = attempt(pass.nets, pass.options, pass.id);
      const candidate = { id: pass.id, result, hold: holdOf(result), nets: pass.nets };
      const accepted = isBetter(candidate, incumbent);
      tried.push({ pass: pass.id, ...summarise(candidate), accepted });
      if (!accepted) continue;
      incumbent = candidate;
      advanced = true;
      break;
    }
    // Nothing improved, or the answer now holds everything and trusts itself:
    // another round would only be a chance to tie.
    if (!advanced) break;
    if (!incumbent.hold.missed.length && incumbent.result.confidence >= REMEDIATION_CONFIDENCE) break;
  }

  // Nothing was worth trying: the trace was doubtful, but every pass this
  // stage has was ruled out as incapable of changing the answer. Report it as
  // the untouched first attempt rather than as a retry that found nothing —
  // "we searched again and failed" and "there was nothing to search" are
  // different facts, and only one of them is true here.
  if (!tried.length) return base;

  const after = summarise(incumbent);
  const remediation = {
    ran: true,
    passes: tried,
    accepted: incumbent.id === 'base' ? null : incumbent.id,
    before,
    after,
  };

  if (incumbent.id === 'base') return base ? { ...base, remediation } : null;

  // Said out loud, at info severity: the outline on screen is not the one the
  // first search produced, and the reason it was replaced is a fact about the
  // drawing the user can check. Anchored on the rooms the second pass brought
  // inside — that is both the evidence for the swap and the thing worth
  // looking at, and these are working px, which mapWarningAnchors converts.
  const stillMissed = new Set(incumbent.hold.missed.map((m) => `${m.x},${m.y}`));
  const recovered = baseHold.missed
    .filter((m) => !stillMissed.has(`${m.x},${m.y}`))
    .map(({ x, y }) => ({ x, y }));
  const warnings = [
    ...incumbent.result.warnings,
    warning('remediated', {
      pass: incumbent.id,
      heldBefore: before.held,
      heldAfter: after.held,
      of: after.of,
    }, 'info', recovered.length ? { kind: 'point', points: recovered } : null),
  ];
  return { ...incumbent.result, warnings, remediation };
};
