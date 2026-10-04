// Exterior boundary detection.
//
// The stage is a hypothesise-and-score search, the same shape as room
// detection and OCR: partition the page into wall networks, generate several
// candidate footprints per network under different connectivity and evidence
// policies (candidates.js), score each against wall evidence and any
// constraints the rest of the app has already established (scoring.js), and
// return the winner together with its confidence and the reasons it might be
// wrong. Producing one polygon from one sealing heuristic gave a wrong answer
// no second-best and no way to be recognised as wrong.

import { bboxAreaOf, dilateRect, labelComponents, openRect } from './raster.js';
import { pointInPolygon } from './polygon.js';
import { createEvidence, contourSupport } from './wallEvidence.js';
import {
  generateCandidates, footprintEntry, inkCount, measureFootprint, netSelfSeals, netEnclosure, INDEPENDENT_SEAL,
} from './candidates.js';
import { scoreCandidate, pickCandidate, candidateConfidence, warning, bboxRing } from './scoring.js';
import { buildFloor } from './footprint.js';
import { brushNetworks, strokeRegion } from './brush.js';
import { remediateTrace, shouldRemediate } from './remediate.js';

const contains = (outer, inner, margin) =>
  outer.minX - margin <= inner.minX && outer.maxX + margin >= inner.maxX
  && outer.minY - margin <= inner.minY && outer.maxY + margin >= inner.maxY;

const overlaps = (a, b, margin) =>
  a.minX <= b.maxX + margin && b.minX <= a.maxX + margin
  && a.minY <= b.maxY + margin && b.minY <= a.maxY + margin;

// Why a piece of the drawing never reached the answer. Seven branches between
// the wall mask and the floors discarded one with a bare `continue`, and a
// skipped network is a missing wing until somebody has looked at it — so each
// one names itself and the count is reported as `outlines-dropped`.
const DROP = {
  thinInk: 'too little wall ink to be a building',
  limit: 'more outlines on the page than the floor limit',
  nested: 'inside an outline already traced',
  noCandidate: 'no closed outline could be found for it',
  noPolygon: 'no usable polygon came back',
};

// Six regions is what a highlight can point at; these are the six worth
// spending. A network that produced no outline is a wing that is missing, and
// the size filter's are usually a title block.
const DROP_PRIORITY = [DROP.noCandidate, DROP.noPolygon, DROP.nested, DROP.limit, DROP.thinInk];

const dropNet = (dropped, reason, bbox) => {
  dropped.reasons.add(reason);
  dropped.regions.push({ reason, bbox: bbox ?? null });
};

// A network whose centre lands inside a floor already traced: interior detail
// (stair block, island, courtyard ring), not another outline. Tested against
// the outline rather than the carved footprint mask, or a courtyard that has
// just been carved into a hole reads as "not inside" and comes back as a
// phantom floor.
const nestedIn = (bbox, floors) => {
  const p = { x: (bbox.minX + bbox.maxX) >> 1, y: (bbox.minY + bbox.maxY) >> 1 };
  return floors.some((f) => pointInPolygon(p, f.outerPolygon));
};

// Two drawings on one sheet — a floor beside the floor above it, a house
// beside its garage — share one wall network whenever they sit closer than the
// grouping radius or a dimension string reaches across the gap, and the weld
// and the closing then fuse them, gap and all, into one outline: on CubiCasa5K
// 159 of the 190 listing sheets with several floors were traced as fewer
// outlines than drawings. So a network is cut where a straight band of page
// crosses it that no thick stroke crosses, and the cut is kept only when it
// separates two drawings rather than two halves of one:
// - each side encloses itself, by the reading `netSelfSeals` takes;
// - each side encloses a tenth of what the whole did — a drawing, not a title
//   box;
// - the cut costs nothing the whole enclosed but the band: a band through a
//   row of aligned windows and doors loses the rooms either side of it;
// - each side faces the band with thick wall of its own: a band running along
//   a thin interior wall has rooms beside it, not exterior walls;
// - what the whole encloses in the band is open page the weld or the closing
//   reached across, not a space drawn closed: a patio or a courtyard with a
//   door onto it from each side makes the sides wings of one building, and
//   the carve (with its guard against cutting off a wing) is what answers it.
// On the 870 listing plans of CubiCasa5K's train split, the five together
// split 92 of the 190 sheets with several floors, and one of the 680 with one:
// a sheet that draws two buildings.
const CUT_MIN_SIDE = 0.1;
const CUT_SLACK = 0.03;
// Share of the band's enclosed area that, drawn closed without weld or
// closing, makes it a space rather than a gap.
const CUT_DRAWN = 0.5;
// Share of the span both sides cover that each faces with thick wall. A cut
// between two drawings measured 0.38 and up, a slice along a thin interior
// wall 0.2 and below: windows and a shorter neighbour keep the first from 1.
const CUT_FACE = 0.3;
// How far from the band that wall may stand, in wall thicknesses: the band
// stops at the first thick stroke, which in a gap can be a porch or a stair
// drawn in it rather than the next drawing's wall.
const CUT_FACE_REACH = 3;
// The widest bands tried per network; a plan's gaps are among its widest.
const CUT_TRIES = 6;

// One pass over a network: the lines a thick stroke of it crosses, and where
// its ink starts and ends along every row and column (relative to its box).
// Everything a band has to pass before its sides are worth enclosing is read
// off this, so a band through one building costs no split and no enclosure.
const scanNet = (net, thick, width) => {
  const { mask, bbox } = net;
  const w = bbox.maxX - bbox.minX + 1;
  const h = bbox.maxY - bbox.minY + 1;
  const scan = {
    colBlocked: new Uint8Array(w),
    rowBlocked: new Uint8Array(h),
    rowFirst: new Int32Array(h).fill(-1),
    rowLast: new Int32Array(h).fill(-1),
    colFirst: new Int32Array(w).fill(-1),
    colLast: new Int32Array(w).fill(-1),
  };
  for (let y = bbox.minY; y <= bbox.maxY; y += 1) {
    const row = y * width;
    const ry = y - bbox.minY;
    for (let x = bbox.minX; x <= bbox.maxX; x += 1) {
      const i = row + x;
      if (!mask[i]) continue;
      const rx = x - bbox.minX;
      if (scan.rowFirst[ry] < 0) scan.rowFirst[ry] = rx;
      scan.rowLast[ry] = rx;
      if (scan.colFirst[rx] < 0) scan.colFirst[rx] = ry;
      scan.colLast[rx] = ry;
      if (thick[i]) {
        scan.colBlocked[rx] = 1;
        scan.rowBlocked[ry] = 1;
      }
    }
  }
  return scan;
};

// Bands across a network's extent — columns for axis 'x', rows for 'y' — that
// no thick stroke of it crosses, widest first. A band touching the extent's
// edge is not between two things.
const clearBands = (scan, bbox, minWidth) => {
  const bands = [];
  const collect = (blocked, axis, origin) => {
    let start = -1;
    for (let k = 0; k < blocked.length; k += 1) {
      if (!blocked[k]) {
        if (start < 0) start = k;
        continue;
      }
      if (start > 0 && k - start >= minWidth) bands.push({ axis, from: origin + start, to: origin + k - 1 });
      start = -1;
    }
  };
  collect(scan.colBlocked, 'x', bbox.minX);
  collect(scan.rowBlocked, 'y', bbox.minY);
  return bands.sort((a, b) => (b.to - b.from) - (a.to - a.from));
};

// How far each side of a cut at `at` runs along the band — rows for a band of
// columns, columns for a band of rows — or null when a side has no ink.
const sideSpans = (scan, bbox, band, at) => {
  const alongX = band.axis === 'y';
  const first = alongX ? scan.colFirst : scan.rowFirst;
  const last = alongX ? scan.colLast : scan.rowLast;
  const across = alongX ? bbox.minY : bbox.minX;
  const along = alongX ? bbox.minX : bbox.minY;
  const spans = [[Infinity, -1], [Infinity, -1]];
  for (let k = 0; k < first.length; k += 1) {
    if (first[k] < 0) continue;
    const line = along + k;
    if (first[k] + across < at) {
      if (line < spans[0][0]) spans[0][0] = line;
      spans[0][1] = line;
    }
    if (last[k] + across >= at) {
      if (line < spans[1][0]) spans[1][0] = line;
      spans[1][1] = line;
    }
  }
  return spans[0][1] < 0 || spans[1][1] < 0 ? null : spans;
};

// Over the span both sides cover along the band, the share of lines on which
// each has a thick stroke within `reach` of the band's edge. Everything before
// the band's first line is the first side's and everything past its last the
// second's, so the network's own mask answers for both.
const faceShares = (net, thick, band, spans, width, height, reach) => {
  const lo = Math.max(spans[0][0], spans[1][0]);
  const hi = Math.min(spans[0][1], spans[1][1]);
  if (hi < lo) return [0, 0];
  const alongX = band.axis === 'y';
  const limit = alongX ? height : width;
  const faces = (edge, step) => {
    let hits = 0;
    for (let q = lo; q <= hi; q += 1) {
      for (let k = 1; k <= reach; k += 1) {
        const p = edge + step * k;
        if (p < 0 || p >= limit) break;
        const i = alongX ? p * width + q : q * width + p;
        if (net.mask[i] && thick[i]) {
          hits += 1;
          break;
        }
      }
    }
    return hits / (hi - lo + 1);
  };
  return [faces(band.from, -1), faces(band.to, 1)];
};

// The network's ink either side of the line at `at`. Each side keeps the weld
// reach of the network it came from (see `generateCandidates`).
const splitNet = (net, width, axis, at) => {
  const sides = [0, 1].map(() => ({
    mask: new Uint8Array(net.mask.length),
    bbox: { minX: Infinity, minY: Infinity, maxX: -1, maxY: -1 },
    wallSize: 0,
    reach: net.reach ?? net.bbox,
  }));
  const { bbox } = net;
  for (let y = bbox.minY; y <= bbox.maxY; y += 1) {
    const row = y * width;
    for (let x = bbox.minX; x <= bbox.maxX; x += 1) {
      if (!net.mask[row + x]) continue;
      const side = sides[(axis === 'x' ? x : y) < at ? 0 : 1];
      side.mask[row + x] = 1;
      side.wallSize += 1;
      if (x < side.bbox.minX) side.bbox.minX = x;
      if (x > side.bbox.maxX) side.bbox.maxX = x;
      if (y < side.bbox.minY) side.bbox.minY = y;
      if (y > side.bbox.maxY) side.bbox.maxY = y;
    }
  }
  return sides;
};

// What a group encloses on its own: the pieces of its footprint worth
// counting (the ladder's two percent), their area, its seal, and a membership
// test in page coordinates.
const enclosed = (mask, width, height, bbox, wallThickness, reach) => {
  const enclosure = netEnclosure(mask, width, height, bbox, wallThickness, reach);
  if (!enclosure) return null;
  const { labels, frame, components, largest } = enclosure.measured;
  const counted = new Set();
  let area = 0;
  for (const c of components) {
    if (c.size < 0.02 * largest.size) continue;
    counted.add(c.id);
    area += c.size;
  }
  const inside = frame
    ? (x, y) => {
      const fx = x - frame.x0;
      const fy = y - frame.y0;
      return fx >= 0 && fy >= 0 && fx < frame.w && fy < frame.h && counted.has(labels[fy * frame.w + fx]);
    }
    : (x, y) => counted.has(labels[y * width + x]);
  return { area, seal: enclosure.seal, inside };
};

// Is (x, y) inside a footprint `measureFootprint` returned?
const enclosedAt = (measured, width, x, y) => {
  const { labels, frame } = measured;
  if (!frame) return labels[y * width + x] >= 0;
  const fx = x - frame.x0;
  const fy = y - frame.y0;
  return fx >= 0 && fy >= 0 && fx < frame.w && fy < frame.h && labels[fy * frame.w + fx] >= 0;
};

// One network as the drawings it holds (see above). Recursive: a sheet of
// three drawings is cut twice. `rootArea` is what the original network
// enclosed, so that a deep cut cannot shave off a sliver of it as a drawing.
// The tests run cheapest first; each enclosure is a closing at wall radius.
const cutDrawings = (net, width, height, wallThickness, thick, rootArea = null) => {
  const scan = scanNet(net, thick, width);
  const bands = clearBands(scan, net.bbox, Math.max(4, Math.round(wallThickness * 0.5)));
  if (!bands.length) return [net];
  const reach = Math.max(3, Math.round(wallThickness * CUT_FACE_REACH));
  const reachOf = net.reach ?? net.bbox;
  let whole;
  let drawn;
  for (const band of bands.slice(0, CUT_TRIES)) {
    const at = (band.from + band.to + 1) >> 1;
    const spans = sideSpans(scan, net.bbox, band, at);
    if (!spans) continue;
    const [faceA, faceB] = faceShares(net, thick, band, spans, width, height, reach);
    if (Math.min(faceA, faceB) < CUT_FACE) continue;
    const sides = splitNet(net, width, band.axis, at);
    const ea = enclosed(sides[0].mask, width, height, sides[0].bbox, wallThickness, reachOf);
    if (!ea || ea.seal < INDEPENDENT_SEAL) continue;
    const eb = enclosed(sides[1].mask, width, height, sides[1].bbox, wallThickness, reachOf);
    if (!eb || eb.seal < INDEPENDENT_SEAL) continue;
    if (whole === undefined) whole = enclosed(net.mask, width, height, net.bbox, wallThickness, reachOf);
    if (!whole) return [net];
    const root = rootArea ?? whole.area;
    if (Math.min(ea.area, eb.area) < CUT_MIN_SIDE * root) continue;
    let inBand = 0;
    const alongX = band.axis === 'y';
    const q0 = alongX ? net.bbox.minX : net.bbox.minY;
    const q1 = alongX ? net.bbox.maxX : net.bbox.maxY;
    for (let p = band.from; p <= band.to; p += 1) {
      for (let q = q0; q <= q1; q += 1) {
        if (alongX ? whole.inside(q, p) : whole.inside(p, q)) inBand += 1;
      }
    }
    if (whole.area - ea.area - eb.area > inBand + CUT_SLACK * whole.area) continue;
    if (drawn === undefined) drawn = measureFootprint(net.mask, width, height, 2, net.bbox);
    let drawnInBand = 0;
    for (let p = band.from; p <= band.to && drawn; p += 1) {
      for (let q = q0; q <= q1; q += 1) {
        const x = alongX ? q : p;
        const y = alongX ? p : q;
        if (whole.inside(x, y) && enclosedAt(drawn, width, x, y)) drawnInBand += 1;
      }
    }
    if (inBand > 0 && drawnInBand >= CUT_DRAWN * inBand) continue;
    return sides.flatMap((side) => cutDrawings(side, width, height, wallThickness, thick, root));
  }
  return [net];
};

// Partition the wall mask into disconnected wall networks (one per floor
// outline drawn on the page): dilate to associate nearby strokes, label, and
// project the original wall pixels onto the groups; then cut apart drawings
// that one network holds together (`cutDrawings`).
export const partitionWallNetworks = (wallMask, width, height, wallThickness, maxNetworks) => {
  const groupR = Math.max(6, wallThickness * 2);
  const grouped = dilateRect(wallMask, width, height, groupR);
  const { labels } = labelComponents(grouped, width, height);

  const stats = new Map();
  for (let i = 0; i < wallMask.length; i += 1) {
    if (!wallMask[i]) continue;
    const id = labels[i];
    const x = i % width;
    const y = (i / width) | 0;
    let s = stats.get(id);
    if (!s) {
      s = { id, size: 0, bbox: { minX: x, minY: y, maxX: x, maxY: y } };
      stats.set(id, s);
    }
    s.size += 1;
    if (x < s.bbox.minX) s.bbox.minX = x;
    if (x > s.bbox.maxX) s.bbox.maxX = x;
    if (y < s.bbox.minY) s.bbox.minY = y;
    if (y > s.bbox.maxY) s.bbox.maxY = y;
  }

  const nets = [...stats.values()].map((n) => ({ ...n, ids: new Set([n.id]) }));
  if (!nets.length) return [];
  nets.sort((a, b) => b.size - a.size);

  const maskFor = (net) => {
    const mask = new Uint8Array(wallMask.length);
    for (let y = net.bbox.minY; y <= net.bbox.maxY; y += 1) {
      const row = y * width;
      for (let x = net.bbox.minX; x <= net.bbox.maxX; x += 1) {
        if (wallMask[row + x] && net.ids.has(labels[row + x])) mask[row + x] = 1;
      }
    }
    return mask;
  };

  // Rejoin fragments of one outline. Long window spans can break a floor
  // outline into pieces whose extents interleave — each piece covers part of
  // the same region, so their boxes *partially* overlap. Something drawn
  // *inside* another outline (a legend, a title block, a detail, a second
  // floor plan in an L-shaped plan's notch) is contained rather than
  // interleaved, and two outlines that each enclose their own extent are two
  // drawings whatever their boxes do. Merging on bare bbox overlap could not
  // tell those three cases apart.
  const minMerge = Math.max(80, 0.002 * nets[0].size);
  const biggestBbox = bboxAreaOf(nets[0].bbox);
  // Keyed on the merged id-set, since that is the whole input: net objects are
  // mutated in place by a merge, so an object key is only correct while someone
  // remembers to invalidate it by hand, and what it guards is a whole-page
  // bridge and trace per net.
  const cache = new Map();
  const independentOf = (net) => {
    const key = [...net.ids].sort((x, y) => x - y).join(',');
    let independent = cache.get(key);
    if (independent === undefined) {
      independent = bboxAreaOf(net.bbox) >= 0.15 * biggestBbox
        && netSelfSeals(maskFor(net), width, height, net.bbox, wallThickness);
      cache.set(key, independent);
    }
    return independent;
  };

  for (let merged = true; merged;) {
    merged = false;
    for (let i = 0; i < nets.length && !merged; i += 1) {
      for (let j = i + 1; j < nets.length; j += 1) {
        const a = nets[i];
        const b = nets[j];
        if (Math.min(a.size, b.size) < minMerge) continue;
        if (!overlaps(a.bbox, b.bbox, groupR)) continue;
        const aIndependent = independentOf(a);
        const bIndependent = independentOf(b);
        if (aIndependent && bIndependent) continue;
        if (contains(a.bbox, b.bbox, groupR) && bIndependent) continue;
        if (contains(b.bbox, a.bbox, groupR) && aIndependent) continue;
        a.size += b.size;
        for (const id of b.ids) a.ids.add(id);
        a.bbox.minX = Math.min(a.bbox.minX, b.bbox.minX);
        a.bbox.minY = Math.min(a.bbox.minY, b.bbox.minY);
        a.bbox.maxX = Math.max(a.bbox.maxX, b.bbox.maxX);
        a.bbox.maxY = Math.max(a.bbox.maxY, b.bbox.maxY);
        nets.splice(j, 1);
        merged = true;
        break;
      }
    }
  }

  nets.sort((a, b) => b.size - a.size);
  const minSize = Math.max(200, 0.1 * nets[0].size);
  const minBbox = 0.008 * width * height;
  const passed = nets.filter((n) => n.size >= minSize && bboxAreaOf(n.bbox) >= minBbox);
  // The structural strokes, opened once for the page: networks sit further
  // apart than the opening reaches, so each reads its own from this.
  const thick = passed.length
    ? openRect(wallMask, width, height, Math.max(1, Math.round(wallThickness * 0.3)))
    : null;
  const drawings = passed
    .map((n) => ({ mask: maskFor(n), bbox: n.bbox, wallSize: n.size }))
    .flatMap((net) => cutDrawings(net, width, height, wallThickness, thick))
    .sort((a, b) => b.wallSize - a.wallSize);
  const kept = drawings.slice(0, maxNetworks);

  // What this filter threw away, so assembleFloors can report it instead of
  // losing it. Only networks whose extent already cleared the "could be a
  // building" bar: below it every plan has dozens — dimension strings, a north
  // arrow, a title block — and a count including those says nothing. Carried on
  // the array rather than in a new return shape, because scripts/traceDebug.mjs
  // and the memo both take these nets as a plain list.
  kept.dropped = [
    ...nets.filter((n) => n.size < minSize && bboxAreaOf(n.bbox) >= minBbox)
      .map((n) => ({ reason: DROP.thinInk, bbox: n.bbox })),
    ...drawings.slice(maxNetworks).map((n) => ({ reason: DROP.limit, bbox: n.bbox })),
  ];
  return kept;
};

// Partitioning the page into wall networks and climbing each one's closing
// ladder is by far the most expensive thing the tracer does, and it depends on
// nothing but the analysis: constraints only reach scoring, excludeRegions and
// garage carving only reach buildFloor. Both are therefore memoised per image,
// so the footprint clamp a room click needs and the perimeter trace that
// follows it stop paying for the same search twice.
const memo = (cache, key, compute) => {
  if (!cache) return compute();
  if (cache.has(key)) return cache.get(key);
  const value = compute();
  cache.set(key, value);
  return value;
};

// Everything a network's footprint components need to become floors.
const detectFloorNet = (net, analysis, options, constraints, cache, netKey) => {
  const { width, height, wallThickness } = analysis;
  const epsilon = options.simplifyEpsilon ?? Math.max(2, wallThickness * 0.35);
  const fitOptions = {
    ...options.fit,
    mergeTol: options.fit?.mergeTol ?? Math.max(2, Math.round(wallThickness * 0.5)),
  };
  const generated = memo(cache, `gen|${netKey}`, () => generateCandidates(net, analysis, options));
  if (!generated.candidates.length) return null;

  // Constraints are page-wide but a network is one drawing: on a multi-floor
  // sheet every other floor's rooms and labels would otherwise read as
  // "outside this outline" and bury a good trace in errors.
  const inNet = (x, y) => x >= net.bbox.minX - wallThickness * 4
    && x <= net.bbox.maxX + wallThickness * 4
    && y >= net.bbox.minY - wallThickness * 4
    && y <= net.bbox.maxY + wallThickness * 4;
  const localConstraints = constraints ? {
    rooms: (constraints.rooms ?? []).filter((r) => inNet(
      (r.rect.left + r.rect.right) / 2, (r.rect.top + r.rect.bottom) / 2,
    )),
    interiorPoints: (constraints.interiorPoints ?? []).filter((p) => inNet(p.x, p.y)),
  } : null;
  const scopedConstraints = localConstraints
    && (localConstraints.rooms.length || localConstraints.interiorPoints.length)
    ? localConstraints
    : null;

  const evidence = memo(cache, `ev|${netKey}`,
    () => createEvidence(analysis, net.mask, net.ribbon));
  const ctx = {
    analysis,
    evidence,
    epsilon,
    fitOptions,
    wallBboxArea: generated.wallBboxArea,
    // The wall network's own extent, for the `annexation` anchor: that warning
    // is the ratio of the candidate's bbox to this one, so pointing at it means
    // showing both. Read-only; nothing scores against it.
    wallBbox: net.bbox ?? null,
    maxRadius: generated.maxRadius,
    coverage: generated.coverage,
    constraints: scopedConstraints,
    brush: net.brush ?? null,
    // Working px per original px. Warning details divide by it so a bridged
    // opening is reported at the size the user sees, not the downscale's.
    scale: analysis.scaleX,
  };
  const scored = [];
  const scoreNew = () => {
    while (scored.length < generated.candidates.length) {
      scored.push(scoreCandidate(generated.candidates[scored.length], ctx));
    }
  };
  scoreNew();

  // Escalate to the hypotheses that make claims the drawing does not directly
  // support: "only the thick strokes are walls", and "this wall spans an
  // opening no closing radius could". Spanning is only worth inferring when
  // nothing enclosed the network at all.
  const bestOf = (key) => scored.reduce(
    (best, c) => (c ? Math.max(best, key(c)) : best), 0,
  );
  // A remediation pass asks for every hypothesis regardless of whether the base
  // ones fell short, because the first attempt has already been judged wrong by
  // evidence the search itself never sees (see remediate.js). Each rescue is
  // idempotent, so the gated calls below simply become no-ops.
  if (options.forceRescues) {
    generated.rescue.structural();
    generated.rescue.span();
    generated.rescue.corridor();
    scoreNew();
  }
  if (generated.rescue.hasStructural) {
    generated.rescue.structural();
    scoreNew();
  }
  if (bestOf((c) => c.seal.seal) < generated.sealedThreshold) {
    generated.rescue.span();
    scoreNew();
  }
  // Draw mode's guarantee. Asked for when the drawn linework alone neither
  // closed nor landed where the user outlined — the two ways an ink-only
  // hypothesis can fail someone who has already told us where the wall is.
  if (generated.rescue.hasCorridor
    && (bestOf((c) => c.seal.seal) < generated.sealedThreshold
      || bestOf((c) => c.brushFit ?? 0) < 0.9)) {
    generated.rescue.corridor();
    scoreNew();
  }

  // `inclusive` callers want the widest reading of the drawing, not the best
  // reading of the living area, so the one hypothesis that *discards* drawn
  // linework is withheld from them — see detectRoomFromClickCore.
  const pool = options.inclusive ? scored.filter((c) => c && c.variant !== 'structural') : scored;
  const picked = pickCandidate(pool.length ? pool : scored);
  if (!picked) return null;

  const { best, ranked } = picked;
  const { confidence, warnings } = candidateConfidence(best, ctx);
  if (ranked.length === 1) warnings.push(warning('no-alternative', null, 'info'));

  // The "only thick strokes" hypothesis won, so a region bounded entirely by
  // hairlines — an open porch, a screened lanai, a garage closed by its door
  // — was left outside the outline. That is the right answer for living area
  // and the wrong thing to leave unsaid, so it is reported as an exclusion
  // rather than silently dropped.
  let thinStructure = null;
  if (best.variant === 'structural') {
    // Widest by area, not first in rank order: the excluded region is the
    // difference against the most inclusive hypothesis, and rank order says
    // nothing about which `all` candidate that is.
    const widest = ranked.reduce(
      (wide, c) => (c.variant === 'all' && (!wide || c.entry.area > wide.entry.area) ? c : wide),
      null,
    );
    if (widest && widest.entry.area > 1.02 * best.entry.area) {
      // Both masks are derived on read — take them once, not once per pixel.
      const widestMask = widest.entry.mask;
      const bestMask = best.entry.mask;
      const mask = new Uint8Array(widestMask.length);
      let size = 0;
      let minX = width;
      let minY = height;
      let maxX = -1;
      let maxY = -1;
      for (let i = 0; i < mask.length; i += 1) {
        if (!widestMask[i] || bestMask[i]) continue;
        mask[i] = 1;
        size += 1;
        const x = i % width;
        const y = (i / width) | 0;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      if (size >= 0.02 * best.entry.area) {
        thinStructure = { mask, size, bbox: { minX, minY, maxX, maxY } };
      }
    }
  }

  // Floors drawn touching (joined by a stray line) share one network but seal
  // into separate footprint components — keep every component of comparable
  // size, not just the largest.
  const minCompSize = Math.max(0.25 * best.entry.area, 0.01 * width * height);
  const floorComps = best.measured.components
    .filter((c) => c.size >= minCompSize)
    .sort((a, b) => b.size - a.size)
    .map((c) => (c.id === best.entry.componentId
      ? best.entry
      : footprintEntry(best.measured, c, width, height)));

  return {
    floorComps,
    best,
    constraints: scopedConstraints,
    thinStructure,
    confidence,
    warnings,
    epsilon,
    fitOptions,
    evidence,
    structuralInk: generated.structuralKept,
    alternatives: ranked.slice(1, 4).map((c) => ({
      // The geometry, not only its scores. The search already computed these
      // and threw them away at the main-thread boundary — so when a tie-break
      // inside SCORE_EPSILON picked wrong, the right footprint existed and the
      // user's only offer was to paint the whole outline again.
      polygon: c.shape.polygon,
      variant: c.variant,
      policy: c.policy,
      radius: c.radius,
      score: Number(c.score.toFixed(3)),
      areaPx: Math.round(c.areaPx),
      support: Number(c.support.mean.toFixed(3)),
      seal: Number(c.seal.seal.toFixed(3)),
      coverage: Number(c.coverage.toFixed(3)),
    })),
    search: generated.search,
  };
};

// Draw mode's floor of last resort: the stroke itself. Reached when no
// hypothesis built from ink produced a usable candidate — a plan whose walls
// are unreadable, or a stroke over blank paper. The user gets the outline they
// drew, said plainly to be that and nothing more.
const freehandFloorNet = (net, analysis, options) => {
  const { width, height, wallThickness } = analysis;
  // Closed at three-quarters of the brush radius: enough to seal where the
  // user lifted the mouse mid-outline, not enough to round the corners of a
  // stroke they meant.
  const measured = measureFootprint(
    net.ribbon, width, height, Math.max(4, Math.round((net.radius ?? 8) * 0.75)),
  );
  if (!measured?.largest) return null;
  const entry = footprintEntry(measured, measured.largest, width, height);
  const epsilon = options.simplifyEpsilon ?? Math.max(2, wallThickness * 0.35);
  return {
    floorComps: [entry],
    best: {
      variant: 'all', policy: 'freehand', radius: measured.radius, score: 0,
      support: { mean: 0 }, seal: { seal: 1 },
    },
    constraints: null,
    thinStructure: null,
    confidence: 0.45,
    warnings: [warning('drawn-freehand', null, 'warn')],
    epsilon,
    fitOptions: {
      ...options.fit,
      mergeTol: options.fit?.mergeTol ?? Math.max(2, Math.round(wallThickness * 0.5)),
    },
    evidence: createEvidence(analysis, net.mask, net.ribbon),
    // No candidate generation ran, so floorPlausibility measures it itself.
    structuralInk: null,
    alternatives: [],
    search: { variant: 'all', policy: 'freehand', tried: [] },
  };
};

// Is this outline a building, or a legend, a title block or a detail drawing
// that happens to be a closed box? Judged on the same evidence as everything
// else rather than on bbox size alone.
// `structuralInk` is the numerator `generateCandidates` already computed for
// this net — the identical `openRect` at the identical radius, twenty lines of
// call stack earlier. Only the freehand fallback reaches here without one, and
// it passes null rather than a default: this fraction feeds the legend
// rejection below, where a wrong `1` silently keeps a legend as a building.
const floorPlausibility = (floor, net, analysis, evidence, constraints, structuralInk) => {
  const { width, height, wallThickness } = analysis;
  const thickRadius = Math.max(1, Math.round(wallThickness * 0.3));
  const structural = thickRadius >= 2
    ? (structuralInk ?? inkCount(openRect(net.mask, width, height, thickRadius)))
      / Math.max(1, net.wallSize)
    : 1;
  const support = contourSupport(
    floor.outerPolygon, evidence, Math.max(2, Math.round(Math.max(2, wallThickness) * 0.9)),
  );
  let holdsConstraint = null;
  if (constraints?.interiorPoints?.length) {
    holdsConstraint = constraints.interiorPoints.some((p) => {
      const x = Math.round(p.x);
      const y = Math.round(p.y);
      return x >= 0 && y >= 0 && x < width && y < height && floor.footprintMask[y * width + x];
    });
  }
  return { structural, support: support.mean, holdsConstraint };
};

/**
 * One attempt: the wall networks it was given, turned into ordered floors with
 * their quality.
 *
 * Split out of `traceBoundary` so a remediation pass can re-run exactly this
 * with a different partition or different search options and be judged by the
 * same code that judged the first attempt (see remediate.js). `passKey` scopes
 * every memo the attempt touches: a pass that forces the rescue hypotheses
 * mutates the candidate set it is handed, so sharing one memo entry across
 * passes would let a warm cache answer a base trace with an escalated search.
 */
const assembleFloors = (analysis, options, nets, cache, searchScope, passKey) => {
  const { wallThickness } = analysis;
  const maxFloors = Math.max(1, Math.min(5, options.maxFloors ?? 5));
  const constraints = options.constraints ?? null;
  const brush = options.brush ?? null;
  const warnings = [];

  const floors = [];
  const searches = [];
  const alternatives = [];
  let worstConfidence = 1;
  // Seeded with whatever the partition already discarded before this attempt
  // saw a network, so one count covers the whole route from ink to floors.
  const dropped = { reasons: new Set(), regions: [] };
  for (const region of nets.dropped ?? []) dropNet(dropped, region.reason, region.bbox);

  // The geometric non-GLA detectors guess at intent from shape. In draw mode
  // the user already expressed intent by where they painted, so only the
  // explicit OCR label exclusions still apply.
  const floorOptions = brush
    ? { ...options, autoGarage: false, autoShaded: false }
    : options;

  for (let netIndex = 0; netIndex < nets.length; netIndex += 1) {
    const net = nets[netIndex];
    if (floors.length >= maxFloors) {
      // The break skips every remaining network, not only this one — and the
      // cap is not why a nested one would have gone, so each still names
      // itself.
      for (let k = netIndex; k < nets.length; k += 1) {
        const bbox = nets[k].bbox;
        dropNet(dropped, nestedIn(bbox, floors) ? DROP.nested : DROP.limit, bbox);
      }
      break;
    }
    if (nestedIn(net.bbox, floors)) {
      dropNet(dropped, DROP.nested, net.bbox);
      continue;
    }

    // The net key carries the search scope and the pass, so `gen|` and `ev|`
    // inherit both.
    const detected = detectFloorNet(
      net, analysis, options, constraints, cache, `${searchScope}|${passKey}|${netIndex}`,
    )
      ?? (brush ? freehandFloorNet(net, analysis, options) : null);
    if (!detected) {
      dropNet(dropped, DROP.noCandidate, net.bbox);
      continue;
    }
    searches.push(detected.search);
    alternatives.push(detected.alternatives);

    const comps = detected.floorComps;
    for (let compIndex = 0; compIndex < comps.length; compIndex += 1) {
      const footprint = comps[compIndex];
      if (floors.length >= maxFloors) {
        for (let k = compIndex; k < comps.length; k += 1) {
          dropNet(dropped, DROP.limit, comps[k].bbox ?? net.bbox);
        }
        break;
      }
      const floor = buildFloor(
        footprint, { ...analysis, wallMask: net.mask }, detected.epsilon, floorOptions,
      );
      if (!floor) {
        dropNet(dropped, DROP.noPolygon, footprint.bbox ?? net.bbox);
        continue;
      }
      floor.sealRadius = footprint.radius;
      floor.confidence = detected.confidence;
      // Only for a network that produced one floor: with several, a runner-up
      // footprint for the network as a whole does not correspond to any one of
      // them, and offering it as "the next-best version of this outline" would
      // be a different building.
      floor.alternatives = comps.length === 1 ? detected.alternatives : [];
      // The carve's own record rides along with the scorer's. `buildFloor`
      // returns them separately because this assignment used to replace the
      // whole array, which would have dropped every statement about what area
      // was removed, refused or left unsubtracted.
      floor.warnings = [...detected.warnings, ...(floor.carveWarnings ?? [])];
      floor.candidate = {
        variant: detected.best.variant,
        policy: detected.best.policy,
        radius: detected.best.radius,
        score: Number(detected.best.score.toFixed(3)),
        support: Number(detected.best.support.mean.toFixed(3)),
        seal: Number(detected.best.seal.seal.toFixed(3)),
      };
      floor.usedFallback = detected.best.seal.seal < 0.55;
      floor.plausibility = floorPlausibility(
        floor, net, analysis, detected.evidence, detected.constraints, detected.structuralInk,
      );
      floor.net = net;
      // The excluded region sits against this floor's outline rather than
      // inside it, so the adjacency test carries a wall's worth of slack.
      const thin = detected.thinStructure;
      if (thin && overlaps(thin.bbox, floor.footprintBbox, wallThickness * 2)) {
        floor.excludedRegions = [...floor.excludedRegions, {
          sources: ['thin-structure'], keyword: null, size: thin.size, bbox: thin.bbox,
          confidence: 0.5,
        }];
        floor.excluded += 1;
        floor.warnings = [...floor.warnings,
          // The region already stored on the line above, pointed at rather than
          // only counted. It is the union bbox of what may be several
          // disconnected hairline areas, so it can span more than any one of
          // them — a "look here" hint, not an outline of the thing.
          warning('thin-structure-excluded', { size: thin.size }, 'warn',
            { kind: 'ring', rings: [bboxRing(thin.bbox)] })];
      }
      floors.push(floor);
    }
  }
  if (!floors.length) return null;

  // Reject outlines that are not buildings. A hairline-drawn box a fraction of
  // the primary floor's size, with no room or label inside it, is a legend.
  // Not in draw mode: the user painting a loop around something *is* the
  // answer to "is this a building", and this pass is one of the things that
  // silently discards a correct outline.
  const biggestBboxArea = floors.reduce((best, f) => Math.max(best, bboxAreaOf(f.footprintBbox)), 0);
  const biggestArea = floors.reduce((best, f) => Math.max(best, f.footprintArea), 0);
  const kept = [];
  const rejectedRings = [];
  for (const floor of floors) {
    const relBbox = bboxAreaOf(floor.footprintBbox) / biggestBboxArea;
    const relArea = floor.footprintArea / biggestArea;
    const { structural, holdsConstraint } = floor.plausibility;
    const primary = relArea >= 0.999;
    const suspicious = !brush
      && !primary
      && relBbox < 0.55
      && structural < 0.35
      && holdsConstraint !== true;
    // The size test takes the escape the plausibility test already had, but
    // not on its own. `holdsConstraint` is a parsed dimension label sitting
    // inside, not a room the user confirmed, and a room schedule printed in a
    // title block has several — so it is paired with the structural test that
    // is already what separates a legend from a building. A small outline the
    // labels place inside survives if it is drawn as wall; a hairline box with
    // a schedule in it does not.
    const tooSmall = !brush && relBbox < 0.12
      && !(holdsConstraint === true && structural >= 0.35);
    if (tooSmall || suspicious) {
      rejectedRings.push(bboxRing(floor.footprintBbox));
      continue;
    }
    kept.push(floor);
  }
  // Reinstating the largest is a floor that was *not* rejected after all, and
  // it is the first one this loop turned away.
  if (!kept.length) {
    kept.push(floors[0]);
    rejectedRings.shift();
  }
  if (rejectedRings.length) {
    // 'warn', not the 'info' this carried: it removes area from the total,
    // which is the definition of something to check, and at 'info' it was
    // neither counted nor shown.
    warnings.push(warning('floors-rejected', { count: rejectedRings.length }, 'warn',
      { kind: 'ring', rings: rejectedRings.slice(0, 6) }));
  }
  if (dropped.regions.length) {
    // A highlight of forty boxes points at nothing; the count carries the rest.
    // Worst first, because the partition's own drops are seeded ahead of the
    // search's and would otherwise take all six.
    const droppedRings = dropped.regions
      .filter((r) => r.bbox)
      .sort((a, b) => DROP_PRIORITY.indexOf(a.reason) - DROP_PRIORITY.indexOf(b.reason))
      .slice(0, 6).map((r) => bboxRing(r.bbox));
    warnings.push(warning('outlines-dropped', {
      count: dropped.regions.length,
      reasons: [...dropped.reasons],
    }, 'warn', droppedRings.length ? { kind: 'ring', rings: droppedRings } : null));
  }

  // Reading order (rows top-to-bottom, left-to-right within a row). Row
  // grouping first, then a strict comparator inside each row, so the ordering
  // is a valid total order and floor numbering is stable between runs.
  const rows = [];
  for (const floor of [...kept].sort((a, b) => a.footprintBbox.minY - b.footprintBbox.minY)) {
    const bb = floor.footprintBbox;
    const row = rows.find((r) => {
      const overlap = Math.min(r.maxY, bb.maxY) - Math.max(r.minY, bb.minY);
      return overlap > 0.3 * Math.min(r.maxY - r.minY, bb.maxY - bb.minY);
    });
    if (row) {
      row.floors.push(floor);
      row.minY = Math.min(row.minY, bb.minY);
      row.maxY = Math.max(row.maxY, bb.maxY);
    } else {
      rows.push({ minY: bb.minY, maxY: bb.maxY, floors: [floor] });
    }
  }
  const ordered = [];
  for (const row of rows) {
    row.floors.sort((a, b) => a.footprintBbox.minX - b.footprintBbox.minX);
    ordered.push(...row.floors);
  }

  const primary = ordered.reduce(
    (best, f) => (bboxAreaOf(f.footprintBbox) > bboxAreaOf(best.footprintBbox) ? f : best),
  );
  // Keyed on the whole detail, not on `code` plus `detail.px` — only
  // `bridged-opening` carries a `px`, so every other code collapsed to its
  // first instance and three findings on three floors read as one.
  const seen = new Set(warnings.map((w) => `${w.code}|${JSON.stringify(w.detail ?? null)}`));
  for (const floor of ordered) {
    worstConfidence = Math.min(worstConfidence, floor.confidence);
    for (const w of floor.warnings) {
      const key = `${w.code}|${JSON.stringify(w.detail ?? null)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      warnings.push(w);
    }
    delete floor.net;
  }

  return {
    floors: ordered,
    outerPolygon: primary.outerPolygon,
    innerPolygon: primary.innerPolygon,
    holes: primary.holes,
    innerHoles: primary.innerHoles,
    footprintMask: primary.footprintMask,
    footprintArea: primary.footprintArea,
    footprintBbox: primary.footprintBbox,
    sealRadius: primary.sealRadius,
    exteriorThickness: primary.exteriorThickness,
    usedFallback: ordered.some((f) => f.usedFallback),
    confidence: worstConfidence,
    warnings,
    excluded: ordered.reduce((sum, f) => sum + f.excluded, 0),
    excludedGarages: ordered.reduce((sum, f) => sum + f.excludedGarages, 0),
    debug: {
      sealSearches: searches,
      alternatives,
      candidate: primary.candidate,
      wallBbox: nets[0].bbox,
      wallBboxArea: bboxAreaOf(nets[0].bbox),
      networks: nets.length,
      // Working px. Every piece of the drawing this attempt did not measure,
      // with why — the geometry behind `outlines-dropped` and `floors-rejected`
      // for anything that wants more than their counts.
      rejectedRegions: [
        ...dropped.regions,
        ...floors.filter((f) => !kept.includes(f))
          .map((f) => ({ reason: 'judged not to be a building', bbox: f.footprintBbox })),
      ],
    },
  };
};

export const traceBoundary = (analysis, options = {}) => {
  const { width, height, wallThickness } = analysis;
  const maxFloors = Math.max(1, Math.min(5, options.maxFloors ?? 5));
  const brush = options.brush ?? null;

  // A caller-supplied mask is not part of the cache key, so it opts out of the
  // memo rather than risk answering for a different drawing. A brush opts out
  // for the same reason and more strongly: its nets, evidence and candidates
  // all vary with the stroke, which no key here carries — and a drawn trace
  // almost always follows an auto trace of the very same image.
  const cache = (options.mask || brush) ? null : (options.searchCache ?? null);
  // In draw mode the brush declares the partition: one painted loop is one
  // building, whatever the ink under it does. That is the whole point — the
  // page-scope merge and reject rules in assembleFloors are exactly what fails
  // on the plans a user reaches for this tool on.
  // Every memo below is per image, so anything that changes *what the search
  // computes* has to be in the key. This is derived once and threaded through
  // all three, because the two halves had already drifted: the nets key
  // carried `maxCloseRadius` while the candidates key did not, so two traces
  // of one image at different radii shared a candidate set built for the
  // first — `generateCandidates` derives `maxRadius`, and therefore the whole
  // closing ladder, from exactly that option. No caller varies it today, so
  // this was latent rather than live, but `options.boundary` is spread in
  // wholesale from the caller and `pipeline.js` already treats those options
  // as key material for the room-clamp analysis cache.
  const searchScope = `${maxFloors}|${options.maxCloseRadius ?? ''}`;
  const nets = brush
    ? brushNetworks(brush, options.mask ?? analysis.boundaryMask, width, height)
    : memo(cache, `nets|${searchScope}`, () =>
      partitionWallNetworks(
        options.mask ?? analysis.boundaryMask, width, height, wallThickness, maxFloors + 2,
      ));
  if (!nets.length) return null;

  if (brush) {
    for (const net of nets) {
      const sealRadius = Math.max(4, Math.round(brush.radius * 0.75));
      net.brush = {
        region: strokeRegion(net.corridor, width, height, sealRadius),
        band: net.corridor,
        // Sampled over the painted band, which always contains the ink.
        bbox: net.corridorBbox ?? net.bbox,
      };
    }
  }

  const base = assembleFloors(analysis, options, nets, cache, searchScope, 'base');
  if (!shouldRemediate(base, analysis, options)) return base;

  // The first attempt is doubtful, or provably excludes something the rest of
  // the app already located. Both are reasons to search again rather than to
  // hand the answer over with a caveat attached — see remediate.js.
  return remediateTrace({
    analysis,
    options,
    nets,
    base,
    attempt: (passNets, passOptions, passKey) =>
      assembleFloors(analysis, passOptions, passNets, cache, searchScope, passKey),
  });
};
