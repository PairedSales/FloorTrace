// Candidate scoring: turn "which footprint?" from a threshold decision into a
// comparison against evidence. Every candidate is measured on four axes and
// the winner carries its own confidence and warnings, so a wrong answer is
// visible instead of silently green.
//
//  seal        does the region actually close, and does it fill its own
//              wall network rather than one sealed wing of it
//  support     is the outline drawn as wall, or fabricated across blank paper
//  economy     how much closing/bridging had to be invented to get here
//  constraint  do the rooms and labels the rest of the app already found
//              actually lie inside it

import { simplifyRing, fitRing, polygonArea } from './polygon.js';
import { traceFramedBoundary } from './labelFrame.js';
import { contourSupport } from './wallEvidence.js';
import { regionFit } from './brush.js';

const clamp01 = (v) => Math.max(0, Math.min(1, v));

const polygonizeFootprint = (entry, width, height, epsilon, fitOptions) => {
  const ring = traceFramedBoundary(entry, width, height);
  if (ring.length < 3) return null;
  const simplified = simplifyRing(ring, epsilon);
  if (simplified.length < 3) return null;
  const fitted = fitRing(simplified, fitOptions);
  if (!fitted.polygon || fitted.polygon.length < 3) return null;
  return { polygon: fitted.polygon, ring, skew: fitted.skew };
};

// Fraction of a rectangle's area covered by the footprint mask. Exported
// because remediate.js has to ask the same question of a finished floor that
// this asks of a candidate, and two samplers would eventually disagree about
// whether a room is inside.
export const rectCoverage = (mask, width, height, rect) => {
  const x0 = Math.max(0, Math.round(rect.left));
  const x1 = Math.min(width - 1, Math.round(rect.right));
  const y0 = Math.max(0, Math.round(rect.top));
  const y1 = Math.min(height - 1, Math.round(rect.bottom));
  if (x1 < x0 || y1 < y0) return 0;
  let inside = 0;
  let total = 0;
  const stepX = Math.max(1, Math.round((x1 - x0) / 24));
  const stepY = Math.max(1, Math.round((y1 - y0) / 24));
  for (let y = y0; y <= y1; y += stepY) {
    const row = y * width;
    for (let x = x0; x <= x1; x += stepX) {
      total += 1;
      if (mask[row + x]) inside += 1;
    }
  }
  return total ? inside / total : 0;
};

const pointInside = (mask, width, height, point) => {
  const x = Math.round(point.x);
  const y = Math.round(point.y);
  if (x < 0 || y < 0 || x >= width || y >= height) return false;
  return Boolean(mask[y * width + x]);
};

/**
 * Constraints supplied by the rest of the app, all in working-scale px and all
 * optional. Rooms and interior labels are known-inside evidence: geometry that
 * excludes them is provably wrong, and nothing else in the pipeline was ever
 * allowed to know that.
 */
export const scoreConstraints = (entry, analysis, constraints) => {
  const { width, height } = analysis;
  const rooms = constraints?.rooms ?? [];
  const points = constraints?.interiorPoints ?? [];
  if (!rooms.length && !points.length) return null;

  // `entry.mask` is derived on every read, so take it once — this runs for
  // every candidate whenever constraints exist, which is exactly the repeated
  // post-room-placement trace.
  const mask = entry.mask;
  let roomHits = 0;
  const roomMisses = [];
  for (const room of rooms) {
    const cover = rectCoverage(mask, width, height, room.rect ?? room);
    if (cover >= 0.9) roomHits += 1;
    else roomMisses.push({ name: room.name, cover, rect: room.sourceRect ?? null });
  }
  let pointHits = 0;
  const pointMisses = [];
  for (const point of points) {
    if (pointInside(mask, width, height, point)) pointHits += 1;
    else pointMisses.push(point);
  }

  const total = rooms.length + points.length;
  const hits = roomHits + pointHits;
  return {
    fit: total ? hits / total : 1,
    rooms: rooms.length,
    roomMisses,
    points: points.length,
    pointMisses,
  };
};

// Weighted fraction of the network's wall ink the footprint encloses. Leaving
// drawn wall outside means part of the building was lost. Measured against
// every enclosed component, not just the largest: two outlines drawn close
// enough to share a wall network seal into two components of one footprint.
const inkCoverage = (measured, coverage, width) => {
  if (!coverage?.total) return 1;
  const { labels, frame } = measured;
  const { x: xs, y: ys, weight } = coverage;
  let inside = 0;
  if (!frame) {
    for (let k = 0; k < xs.length; k += 1) {
      if (labels[ys[k] * width + xs[k]] >= 0) inside += weight[k];
    }
    return inside / coverage.total;
  }
  // Outside the crop there is no enclosure by construction — which is exactly
  // what the `-1` padding of the old page-sized array said.
  const { x0, y0, w, h } = frame;
  for (let k = 0; k < xs.length; k += 1) {
    const fx = xs[k] - x0;
    if (fx < 0 || fx >= w) continue;
    const fy = ys[k] - y0;
    if (fy < 0 || fy >= h) continue;
    if (labels[fy * w + fx] >= 0) inside += weight[k];
  }
  return inside / coverage.total;
};

export const scoreCandidate = (candidate, ctx) => {
  const {
    analysis, evidence, epsilon, fitOptions, wallBboxArea, maxRadius, constraints, coverage: cov,
  } = ctx;
  const { width, height, wallThickness } = analysis;

  const shape = polygonizeFootprint(candidate.entry, width, height, epsilon, fitOptions);
  if (!shape) return null;

  const tol = Math.max(2, Math.round(Math.max(2, wallThickness) * 0.9));
  const support = contourSupport(shape.polygon, evidence, tol);
  const coverage = inkCoverage(candidate.measured, cov, width);

  // Economy: closing radius and welded span are both fabrication. Prefer the
  // least-invented hypothesis that still holds together.
  const radiusCost = clamp01(candidate.radius / Math.max(2, maxRadius));
  const spanCost = clamp01(candidate.bridgedSpan / Math.max(40, 0.35 * Math.sqrt(wallBboxArea)));
  const economy = 1 - clamp01(0.6 * radiusCost + 0.4 * spanCost);

  // Annexation: a footprint whose bbox reaches beyond its own wall network
  // grabbed something that is not this floor.
  const spill = Math.max(0, candidate.entry.bboxArea / Math.max(1, wallBboxArea) - 1.02);
  const annex = clamp01(spill / 0.3);

  const constraintScore = constraints ? scoreConstraints(candidate.entry, analysis, constraints) : null;

  // Incompleteness: this closing radius enclosed less than the same evidence
  // eventually could. A footprint that stops at an interior wall while the
  // real outline needs a wider closing looks perfectly sealed and perfectly
  // supported — it is simply missing rooms, and only the ladder can say so.
  const completeness = candidate.completeness ?? 1;
  const incomplete = clamp01((0.97 - completeness) / 0.2);

  // Draw mode: how well this footprint matches the region the user's stroke
  // encloses. The strongest constraint available, because it is the one piece
  // of evidence that came from someone who can see the drawing.
  const brushFit = ctx.brush
    ? regionFit(
      candidate.entry.mask, ctx.brush.region.mask, ctx.brush.band,
      width, height, ctx.brush.bbox,
    )
    : null;

  const terms = [
    { w: 0.34, v: candidate.seal.seal },
    { w: 0.30, v: support.mean },
    { w: 0.26, v: coverage },
    { w: 0.10, v: economy },
  ];
  // OCR labels lose most of their pull in draw mode: a user who paints around
  // the garage wants it out, and scoring every such candidate down for
  // "excluding a labelled area" rewards annexing exactly what they excluded.
  if (constraintScore) terms.push({ w: ctx.brush ? 0.08 : 0.22, v: constraintScore.fit });
  if (brushFit !== null) terms.push({ w: 0.25, v: brushFit });
  const weight = terms.reduce((sum, t) => sum + t.w, 0);
  const score = terms.reduce((sum, t) => sum + t.w * t.v, 0) / weight
    - 0.3 * annex - 0.3 * incomplete;

  return {
    ...candidate,
    shape,
    support,
    coverage,
    completeness,
    annex,
    constraintScore,
    brushFit,
    score,
    areaPx: polygonArea(shape.polygon),
  };
};

const WARNING_TEXT = {
  unsealed: 'the outline never closed — part of the building may be missing',
  'weak-wall-support': 'much of the outline is not drawn as a wall',
  'bridged-opening': 'a wide opening was bridged to close the outline',
  'heavy-closing': 'a large closing radius was needed; corners may be rounded',
  annexation: 'the outline reaches beyond the wall network it came from',
  'wall-left-outside': 'some drawn wall falls outside the traced outline',
  'thin-structure-excluded': 'an attached area bounded only by hairlines was left out of the living area',
  'incomplete-enclosure': 'a wider closing enclosed more of this outline',
  'floors-rejected': 'some closed outlines were judged not to be buildings',
  'no-boundary': 'no wall outline could be traced',
  'floor-empty': 'a floor produced no usable polygon',
  'self-intersecting': 'the traced outline crosses itself',
  'covers-page': 'the outline covers almost the whole page',
  'tiny-floor': 'a traced outline is very small',
  'inner-not-nested': 'the interior outline is not inside the exterior one',
  'inner-over-inset': 'the interior outline is inset unusually far',
  'no-inner': 'no interior envelope could be derived; interior mode shows the exterior outline',
  'floors-overlap': 'two traced floors cover the same area',
  'room-outside': 'a detected room falls outside the traced outline',
  'label-outside': 'a labelled area falls outside the traced outline',
  'no-alternative': 'only one usable hypothesis was found',
  'brush-mismatch': 'the traced outline does not match the area you outlined',
  'drawn-freehand': 'no wall was found under part of the outline, so your stroke was used instead',
  remediated: 'the first outline left known rooms outside, so it was traced again',
};

// `anchor` is where on the image the warning is about, in WORKING-RASTER px.
// pipeline.js maps it to original px exactly once — it divides by scaleX/scaleY,
// because those are working-per-original and so <= 1. Omitted when null so the
// emitted shape is unchanged for every warning that has no geometry to point at.
export const warning = (code, detail, severity = 'warn', anchor = null) => (anchor
  ? { code, severity, detail, message: WARNING_TEXT[code] ?? code, anchor }
  : { code, severity, detail, message: WARNING_TEXT[code] ?? code });

/**
 * The stretches of a contour that no wall was found under, as polylines.
 *
 * Deliberately here and not inside `contourSupport`: that runs once per
 * candidate and returns four scalars, so collecting runs there would allocate
 * per candidate in the hot path for geometry only the winner ever reads. This
 * runs once per network, on the winner, and only once the warning has already
 * fired — the same walk `contourSupport` did, repeated for its shape rather
 * than its score. It feeds nothing back: the value is written into a warning
 * and read by nothing that scores.
 */
const unsupportedRuns = (polygon, ctx, step = 2) => {
  const evidence = ctx?.evidence;
  const wallThickness = ctx?.analysis?.wallThickness;
  if (!polygon || polygon.length < 3 || !evidence || !wallThickness) return null;
  const tol = Math.max(2, Math.round(Math.max(2, wallThickness) * 0.9));

  const runs = [];
  let current = null;
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
      if (evidence.levelAt(x, y, tol) <= 0) {
        if (current) current.push({ x, y });
        else current = [{ x, y }];
      } else if (current) {
        if (current.length >= 2) runs.push(current);
        current = null;
      }
    }
  }
  if (current && current.length >= 2) runs.push(current);
  if (!runs.length) return null;
  // Longest first, capped: a highlight of forty fragments points at nothing.
  runs.sort((p, q) => q.length - p.length);
  return { kind: 'segment', runs: runs.slice(0, 6) };
};

// An inclusive integer bbox as a closed 4-point ring. `bboxAreaOf` uses
// `max - min + 1`, so the +1 is that same convention, not a fudge.
export const bboxRing = (b) => (b ? [
  { x: b.minX, y: b.minY },
  { x: b.maxX + 1, y: b.minY },
  { x: b.maxX + 1, y: b.maxY + 1 },
  { x: b.minX, y: b.maxY + 1 },
] : null);

/**
 * Confidence for the winning candidate. Deliberately pessimistic: unsupported
 * outline, a bridged opening or a missing room each pull it down, because the
 * cost of a silent wrong answer here is a wrong square-footage figure.
 */
export const candidateConfidence = (scored, ctx) => {
  const warnings = [];
  const { support, seal, constraintScore, brushFit } = scored;
  const perimeter = Math.max(1, support.total);

  let confidence = seal.seal * (0.3 + 0.7 * support.mean);

  if (seal.seal < 0.55) {
    warnings.push(warning('unsealed', { cover: seal.cover, solidity: seal.solidity }, 'error'));
    confidence *= 0.35;
  }
  // In draw mode a stretch of outline supported only by the user's stroke is a
  // legitimate answer, not a defect — the ribbon already grades it below
  // structural ink, so the bar for calling it *weak* drops accordingly.
  if (support.mean < (ctx.brush ? 0.4 : 0.6)) {
    warnings.push(warning('weak-wall-support', { support: Number(support.mean.toFixed(3)) }, 'warn',
      unsupportedRuns(scored.shape?.polygon, ctx)));
    confidence *= 0.75;
  }
  if (support.longestGap > Math.max(24, 0.08 * perimeter)) {
    const px = Math.round(support.longestGap / ctx.scale);
    // The ends of the unsupported run the `px` figure measures. "A 34px opening
    // was bridged" is unactionable until it can be pointed at. Note it lies on
    // the candidate contour, which in interior-wall mode is inset from the
    // outline the canvas draws — a hint at where to look, not a tracing of it.
    warnings.push(warning('bridged-opening', { px }, 'warn',
      support.longestGapSpan
        ? { kind: 'segment', points: support.longestGapSpan }
        : null));
    confidence *= 1 - Math.min(0.35, support.longestGap / (0.5 * perimeter));
  }
  if (scored.radius >= 0.6 * ctx.maxRadius) {
    warnings.push(warning('heavy-closing', { radius: scored.radius }));
    confidence *= 0.85;
  }
  if (scored.annex > 0.15) {
    // The two rectangles `annex` is literally the ratio of: what this candidate
    // covers, against the wall network it was grown from. Both already measured.
    warnings.push(warning('annexation', { spill: Number(scored.annex.toFixed(2)) }, 'warn',
      (scored.entry?.bbox && ctx.wallBbox)
        ? { kind: 'ring', rings: [bboxRing(scored.entry.bbox), bboxRing(ctx.wallBbox)] }
        : null));
    confidence *= 1 - 0.4 * scored.annex;
  }
  if (scored.completeness < 0.9) {
    warnings.push(warning('incomplete-enclosure', { completeness: Number(scored.completeness.toFixed(2)) }));
    confidence *= 0.7;
  }
  if (scored.coverage < 0.9) {
    warnings.push(warning('wall-left-outside', { coverage: Number(scored.coverage.toFixed(2)) }));
    confidence *= 0.6 + 0.4 * scored.coverage;
  }
  if (brushFit !== null && brushFit < 0.75) {
    // The comparison itself: the band you painted against the outline that was
    // traced. `regionFit` keeps only scalar counts, so the miss and spill
    // regions do not exist to point at — these two do, and they are the pair
    // the disagreement is between.
    warnings.push(warning('brush-mismatch', { fit: Number(brushFit.toFixed(2)) },
      brushFit < 0.5 ? 'error' : 'warn',
      (ctx.brush?.bbox && scored.shape?.polygon)
        ? { kind: 'ring', rings: [bboxRing(ctx.brush.bbox), scored.shape.polygon] }
        : null));
    confidence *= 0.4 + 0.6 * brushFit;
  }
  if (constraintScore) {
    // A room or label outside a *drawn* outline is usually a deliberate
    // exclusion — the user painted around the garage. Still reported, because
    // it is also how a mis-drawn outline shows itself, but it no longer
    // condemns geometry the user chose. (validate.js softens its own
    // late-stage copy of this check on the same grounds.)
    const severity = ctx.brush ? 'warn' : 'error';
    for (const miss of constraintScore.roomMisses) {
      warnings.push(warning('room-outside', {
        name: miss.name,
        cover: Number(miss.cover.toFixed(2)),
        rect: miss.rect,
      }, severity));
    }
    if (constraintScore.pointMisses.length) {
      warnings.push(warning('label-outside', { count: constraintScore.pointMisses.length }, severity));
    }
    confidence *= ctx.brush
      ? 0.85 + 0.15 * constraintScore.fit
      : 0.55 + 0.45 * constraintScore.fit;
  }

  return { confidence: Math.max(0.05, Math.min(0.98, confidence)), warnings };
};

// Scores closer than this say nothing about which hypothesis is better.
const SCORE_EPSILON = 0.015;

// How much of the drawing a hypothesis refuses to believe. `structural`
// discards drawn linework (candidates.js): right for a dimension string welded
// to a wall by its own extension lines, wrong for a porch whose railings are
// the only thing holding its outline. Within the noise band that is the same
// kind of cost as a wider closing radius, so it breaks the same way — and only
// there. A structural hypothesis that scores clearly better still wins.
const invention = (c) => (c.variant === 'structural' ? 1 : 0);

const cheaper = (a, b) =>
  invention(a) - invention(b)
  || a.radius - b.radius
  || a.bridgedSpan - b.bridgedSpan
  || b.score - a.score
  || a.variant.localeCompare(b.variant)
  || a.policy.localeCompare(b.policy);

/**
 * Best candidate, with the runners-up kept for diagnostics. Ties break toward
 * the cheaper hypothesis: less invented evidence, then less closing, then less
 * bridging.
 *
 * Scored against the leader rather than pairwise. "within epsilon of each
 * other" is not a transitive relation, so as a sort comparator it was not an
 * ordering at all: three candidates a≈b, b≈c, a<c made the winner a function
 * of the order they happened to be pushed in, and reversing the input array
 * alone changed which footprint the tracer returned.
 */
export const pickCandidate = (scored) => {
  const usable = scored.filter(Boolean);
  if (!usable.length) return null;
  const byScore = [...usable].sort((a, b) =>
    b.score - a.score
    || a.radius - b.radius
    || a.bridgedSpan - b.bridgedSpan
    || a.variant.localeCompare(b.variant)
    || a.policy.localeCompare(b.policy));
  const lead = byScore[0].score;
  const best = byScore
    .filter((c) => lead - c.score <= SCORE_EPSILON)
    .reduce((won, c) => (cheaper(c, won) < 0 ? c : won));
  const ranked = best === byScore[0] ? byScore : [best, ...byScore.filter((c) => c !== best)];
  return { best, ranked };
};
