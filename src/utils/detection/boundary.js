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

import { bridgeRuns, dilateRect, labelComponents, openRect } from './raster.js';
import { polygonArea, polygonBounds, pointInPolygon } from './polygon.js';
import { createEvidence, contourSupport } from './wallEvidence.js';
import {
  generateCandidates, footprintEntry, sealMetrics, measureFootprint,
} from './candidates.js';
import { scoreCandidate, pickCandidate, candidateConfidence, warning } from './scoring.js';
import { buildFloor } from './footprint.js';
import { brushNetworks, strokeRegion } from './brush.js';

const bboxAreaOf = (bbox) => (bbox.maxX - bbox.minX + 1) * (bbox.maxY - bbox.minY + 1);

const inkCount = (mask) => {
  let n = 0;
  for (let i = 0; i < mask.length; i += 1) n += mask[i];
  return n;
};

// Does this group of strokes enclose its own bounding box on its own? A
// complete floor outline does; a piece of an outline left behind by a long
// window span encloses at best a corner of the region it belongs to. Two
// groups that each close by themselves are two drawings, however well their
// walls line up on the page — which is what stops floor plans stacked on a
// sheet and sharing a left-wall coordinate from being welded into one
// building, and what the old "merge whenever the bounding boxes overlap" rule
// could not express at all.
const INDEPENDENT_SEAL = 0.75;

const netSelfSeals = (mask, width, height, bbox, wallThickness) => {
  const compW = bbox.maxX - bbox.minX + 1;
  const compH = bbox.maxY - bbox.minY + 1;
  const bridged = bridgeRuns(
    mask, width, height,
    Math.max(24, wallThickness * 12, Math.round(Math.max(compW, compH) * 0.3)),
    Math.max(8, wallThickness * 2),
  );
  const fp = measureFootprint(bridged, width, height, Math.max(4, wallThickness));
  if (!fp) return false;
  const entry = footprintEntry(fp, fp.largest, width);
  return sealMetrics(entry, bboxAreaOf(bbox)).seal >= INDEPENDENT_SEAL;
};

const contains = (outer, inner, margin) =>
  outer.minX - margin <= inner.minX && outer.maxX + margin >= inner.maxX
  && outer.minY - margin <= inner.minY && outer.maxY + margin >= inner.maxY;

const overlaps = (a, b, margin) =>
  a.minX <= b.maxX + margin && b.minX <= a.maxX + margin
  && a.minY <= b.maxY + margin && b.minY <= a.maxY + margin;

// Partition the wall mask into disconnected wall networks (one per floor
// outline drawn on the page): dilate to associate nearby strokes, label, and
// project the original wall pixels onto the groups.
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
  const cache = new Map();
  const independentOf = (net) => {
    if (!cache.has(net)) {
      cache.set(net, bboxAreaOf(net.bbox) >= 0.15 * biggestBbox
        && netSelfSeals(maskFor(net), width, height, net.bbox, wallThickness));
    }
    return cache.get(net);
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
        cache.delete(a);
        cache.delete(b);
        nets.splice(j, 1);
        merged = true;
        break;
      }
    }
  }

  nets.sort((a, b) => b.size - a.size);
  const minSize = Math.max(200, 0.1 * nets[0].size);
  return nets
    .filter((n) => n.size >= minSize && bboxAreaOf(n.bbox) >= 0.008 * width * height)
    .slice(0, maxNetworks)
    .map((n) => ({ mask: maskFor(n), bbox: n.bbox, wallSize: n.size }));
};

// Everything a network's footprint components need to become floors.
const detectFloorNet = (net, analysis, options, constraints) => {
  const { width, height, wallThickness } = analysis;
  const epsilon = options.simplifyEpsilon ?? Math.max(2, wallThickness * 0.35);
  const fitOptions = {
    ...options.fit,
    mergeTol: options.fit?.mergeTol ?? Math.max(2, Math.round(wallThickness * 0.5)),
  };
  const generated = generateCandidates(net, analysis, options);
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

  const evidence = createEvidence(analysis, net.mask, net.ribbon);
  const ctx = {
    analysis,
    evidence,
    epsilon,
    fitOptions,
    wallBboxArea: generated.wallBboxArea,
    maxRadius: generated.maxRadius,
    coverage: generated.coverage,
    constraints: scopedConstraints,
    brush: net.brush ?? null,
    scale: 1,
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

  const picked = pickCandidate(scored);
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
    const widest = ranked.find((c) => c.variant === 'all');
    if (widest && widest.entry.area > 1.02 * best.entry.area) {
      const mask = new Uint8Array(widest.entry.mask.length);
      let size = 0;
      let minX = width;
      let minY = height;
      let maxX = -1;
      let maxY = -1;
      for (let i = 0; i < mask.length; i += 1) {
        if (!widest.entry.mask[i] || best.entry.mask[i]) continue;
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
      : footprintEntry(best.measured, c, width)));

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
    alternatives: ranked.slice(1, 4).map((c) => ({
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
  const entry = footprintEntry(measured, measured.largest, width);
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
    alternatives: [],
    search: { variant: 'all', policy: 'freehand', tried: [] },
  };
};

// Is this outline a building, or a legend, a title block or a detail drawing
// that happens to be a closed box? Judged on the same evidence as everything
// else rather than on bbox size alone.
const floorPlausibility = (floor, net, analysis, evidence, constraints) => {
  const { width, height, wallThickness } = analysis;
  const thickRadius = Math.max(1, Math.round(wallThickness * 0.3));
  const structural = thickRadius >= 2
    ? inkCount(openRect(net.mask, width, height, thickRadius)) / Math.max(1, net.wallSize)
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

export const traceBoundary = (analysis, options = {}) => {
  const { width, height, wallThickness } = analysis;
  const maxFloors = Math.max(1, Math.min(5, options.maxFloors ?? 5));
  const constraints = options.constraints ?? null;
  const brush = options.brush ?? null;
  const warnings = [];

  // In draw mode the brush declares the partition: one painted loop is one
  // building, whatever the ink under it does. That is the whole point — the
  // page-scope merge and reject rules below are exactly what fails on the
  // plans a user reaches for this tool on.
  const nets = brush
    ? brushNetworks(brush, options.mask ?? analysis.boundaryMask, width, height)
    : partitionWallNetworks(
      options.mask ?? analysis.boundaryMask, width, height, wallThickness, maxFloors + 2,
    );
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

  const floors = [];
  const searches = [];
  const alternatives = [];
  let worstConfidence = 1;

  // The geometric non-GLA detectors guess at intent from shape. In draw mode
  // the user already expressed intent by where they painted, so only the
  // explicit OCR label exclusions still apply.
  const floorOptions = brush
    ? { ...options, autoGarage: false, autoShaded: false }
    : options;

  for (const net of nets) {
    if (floors.length >= maxFloors) break;
    // A network sitting inside an already-traced outline is interior detail
    // (stair block, island, courtyard ring), not another floor. Tested against
    // the outline rather than the carved footprint mask, or a courtyard that
    // has just been carved into a hole reads as "not inside" and comes back as
    // a phantom floor.
    const cx = (net.bbox.minX + net.bbox.maxX) >> 1;
    const cy = (net.bbox.minY + net.bbox.maxY) >> 1;
    if (floors.some((f) => pointInPolygon({ x: cx, y: cy }, f.outerPolygon))) continue;

    const detected = detectFloorNet(net, analysis, options, constraints)
      ?? (brush ? freehandFloorNet(net, analysis, options) : null);
    if (!detected) continue;
    searches.push(detected.search);
    alternatives.push(detected.alternatives);

    for (const footprint of detected.floorComps) {
      if (floors.length >= maxFloors) break;
      const floor = buildFloor(
        footprint, { ...analysis, wallMask: net.mask }, detected.epsilon, floorOptions,
      );
      if (!floor) continue;
      floor.sealRadius = footprint.radius;
      floor.confidence = detected.confidence;
      floor.warnings = detected.warnings;
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
        floor, net, analysis, detected.evidence, detected.constraints,
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
          warning('thin-structure-excluded', { size: thin.size }, 'warn')];
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
  let rejectedFloors = 0;
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
    if ((!brush && relBbox < 0.12) || suspicious) {
      rejectedFloors += 1;
      continue;
    }
    kept.push(floor);
  }
  if (!kept.length) kept.push(floors[0]);
  if (rejectedFloors) {
    warnings.push(warning('floors-rejected', { count: rejectedFloors }, 'info'));
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
  for (const floor of ordered) {
    worstConfidence = Math.min(worstConfidence, floor.confidence);
    for (const w of floor.warnings) {
      if (!warnings.some((existing) => existing.code === w.code && existing.detail?.px === w.detail?.px)) {
        warnings.push(w);
      }
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
    },
  };
};

export { polygonArea, polygonBounds, sealMetrics };
