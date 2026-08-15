// Detection pipeline cores. Environment-agnostic: both functions take a plain
// {width, height, data} ImageData-like object and run identically in the
// browser worker (src/workers/detectionWorker.js) and the Node benchmark
// harness (scripts/detectionBenchmark.mjs).
//
// detectRoomFromClickCore: shared analysis -> boundary (for the footprint
// clamp) -> coverage-based rectangle growth from the label position.
// traceFloorplanBoundaryCore: shared analysis -> candidate footprints ->
// scoring against wall evidence and constraints -> best boundary, its interior
// envelope, and the quality channel describing how much to trust it.

import { analyzeFloorplan } from './analyze.js';
import { traceBoundary } from './boundary.js';
import { growRoomRect } from './room.js';
import { buildSat } from './raster.js';
import { polygonBounds, mapPolygonToOriginal, ringSetArea } from './polygon.js';
import { validateBoundaryResult } from './validate.js';
import { getCachedAnalysis, getSearchCache } from './cache.js';
import { rasterizeBrush } from './brush.js';
import { RESULT_SCOPED_CODES } from '../boundaryQuality.js';

const toOverlay = (bounds) => ({
  x1: bounds.minX,
  y1: bounds.minY,
  x2: bounds.maxX,
  y2: bounds.maxY,
});

const boundaryEntry = (polygon, scaleX, scaleY) => {
  if (!polygon || polygon.length < 3) return null;
  const mapped = mapPolygonToOriginal(polygon, scaleX, scaleY);
  const bounds = polygonBounds(mapped);
  if (!bounds) return null;
  return { polygon: mapped, overlay: toOverlay(bounds) };
};

const mapRings = (rings, scaleX, scaleY) =>
  (rings ?? [])
    .map((ring) => mapPolygonToOriginal(ring, scaleX, scaleY))
    .filter((ring) => ring.length >= 3);

// `anchor` (where on the image to look) is filled by the detector in a later
// pass; it is declared here so the field exists wherever a warning does.
const tagWarning = (w) => ({
  ...w,
  scope: RESULT_SCOPED_CODES.has(w.code) ? 'result' : 'floor',
  anchor: w.anchor ?? null,
});

const namesFloor = (w, i) => w.detail?.floor === i
  || (Array.isArray(w.detail?.floors) && w.detail.floors.includes(i));

// Validation is raised against the whole result, after the per-floor split the
// app reads — so `label-outside`, `self-intersecting` and the rest lived only
// in the toast and died with it. Fan each one back onto the floor its detail
// names; whole-drawing findings go onto every floor, tagged so the panel can
// say which is which. The top-level list is left exactly as it was.
const fanOutWarnings = (floors, boundaryWarnings, validationWarnings) => {
  const perFloor = new Set(floors.flatMap((f) => (f.warnings ?? []).map((w) => w.code)));
  // Whatever the boundary stage raised above any single floor. Its list is the
  // union of the floors' own warnings plus these, so the floors' codes are what
  // separates them.
  const resultOnly = boundaryWarnings.filter(
    (w) => RESULT_SCOPED_CODES.has(w.code) && !perFloor.has(w.code),
  );
  return floors.map((floor, i) => ({
    ...floor,
    warnings: [
      ...(floor.warnings ?? []),
      ...validationWarnings.filter((w) => RESULT_SCOPED_CODES.has(w.code) || namesFloor(w, i)),
      ...resultOnly,
    ].map(tagWarning),
  }));
};

// Constraints arrive in original image px; the detector works at the analysis
// scale. Rooms are rectangles known to be inside the building; interior points
// are label positions the OCR pass located and parsed.
const scaleConstraints = (constraints, analysis) => {
  if (!constraints) return null;
  const sx = analysis.scaleX;
  const sy = analysis.scaleY;
  const rooms = (constraints.rooms ?? [])
    .filter((r) => r && r.rect)
    .map((r) => ({
      name: r.name ?? null,
      rect: {
        left: r.rect.left * sx,
        right: r.rect.right * sx,
        top: r.rect.top * sy,
        bottom: r.rect.bottom * sy,
      },
    }));
  const interiorPoints = (constraints.interiorPoints ?? [])
    .filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y))
    .map((p) => ({ x: p.x * sx, y: p.y * sy, name: p.name ?? null }));
  if (!rooms.length && !interiorPoints.length) return null;
  return { rooms, interiorPoints };
};

export const traceFloorplanBoundaryCore = (imageData, options = {}) => {
  const t0 = Date.now();
  const maxDimension = options.preprocess?.maxDimension ?? 1400;
  const analysis = getCachedAnalysis(
    options.cacheKey, maxDimension, options.analyze,
    () => analyzeFloorplan(imageData, { maxDimension, ...options.analyze }),
  );
  // Non-GLA label bboxes (original image px) -> working scale.
  const excludeRegions = (options.excludeRegions ?? []).map((r) => ({
    x: r.x * analysis.scaleX,
    y: r.y * analysis.scaleY,
    width: r.width * analysis.scaleX,
    height: r.height * analysis.scaleY,
    keyword: r.keyword,
  }));
  const constraints = scaleConstraints(options.constraints, analysis);
  // Draw mode: strokes and brush radius arrive in original image px.
  const brush = options.brush
    ? rasterizeBrush(options.brush.strokes, options.brush.radius, analysis)
    : null;
  const source = brush ? 'drawn' : 'auto';
  const boundary = traceBoundary(analysis, {
    ...options.boundary,
    excludeRegions,
    constraints,
    brush,
    searchCache: getSearchCache(options.cacheKey, maxDimension, options.analyze),
  });
  if (!boundary) {
    return {
      outer: null,
      inner: null,
      floors: [],
      excludedRegions: 0,
      excludedGarages: 0,
      quality: {
        confidence: 0,
        warnings: [tagWarning({ code: 'no-boundary', severity: 'error', message: 'no wall outline could be traced' })],
        source,
      },
      debug: { elapsedMs: Date.now() - t0 },
    };
  }

  const { scaleX, scaleY } = analysis;
  const outer = boundaryEntry(boundary.outerPolygon, scaleX, scaleY);
  const inner = boundaryEntry(boundary.innerPolygon, scaleX, scaleY);
  if (!outer && !inner) return null;

  // One entry per disconnected floor outline, in page reading order. The
  // top-level outer/inner stay the largest floor for single-boundary callers.
  const floors = (boundary.floors ?? [])
    .map((floor) => ({
      outer: boundaryEntry(floor.outerPolygon, scaleX, scaleY),
      inner: boundaryEntry(floor.innerPolygon, scaleX, scaleY),
      holes: mapRings(floor.holes, scaleX, scaleY),
      innerHoles: mapRings(floor.innerHoles, scaleX, scaleY),
      confidence: floor.confidence,
      warnings: floor.warnings,
      excluded: floor.excluded,
      excludedGarages: floor.excludedGarages,
      candidate: floor.candidate,
    }))
    .filter((floor) => floor.outer || floor.inner);

  const validation = validateBoundaryResult(
    { floors },
    {
      imageWidth: imageData.width,
      imageHeight: imageData.height,
      labels: options.constraints?.interiorPoints ?? [],
      // A label inside a deliberately excluded region (a garage, a porch) is
      // outside the outline on purpose, not evidence of a bad trace.
      exemptRegions: options.excludeRegions ?? [],
      userDrawn: Boolean(brush),
    },
  );

  const warnings = [...(boundary.warnings ?? []), ...validation.warnings].map(tagWarning);
  const confidence = Math.max(0, Math.min(0.98, boundary.confidence * validation.factor));

  return {
    outer,
    inner,
    floors: fanOutWarnings(floors, boundary.warnings ?? [], validation.warnings),
    holes: mapRings(boundary.holes, scaleX, scaleY),
    innerHoles: mapRings(boundary.innerHoles, scaleX, scaleY),
    // Top-level (not debug): the worker only forwards a whitelist of fields.
    excludedRegions: boundary.excluded,
    excludedGarages: boundary.excludedGarages,
    quality: {
      confidence,
      warnings,
      usedFallback: boundary.usedFallback,
      source,
      floorCount: floors.length,
      candidate: boundary.debug.candidate,
      areaPx: outer ? ringSetArea(outer.polygon, mapRings(boundary.holes, scaleX, scaleY)) : 0,
    },
    debug: {
      floorCount: floors.length,
      workingSize: { width: analysis.width, height: analysis.height },
      scale: { x: scaleX, y: scaleY },
      wallThickness: analysis.wallThickness,
      exteriorThickness: boundary.exteriorThickness,
      sealRadius: boundary.sealRadius,
      usedFallback: boundary.usedFallback,
      sealSearches: boundary.debug.sealSearches,
      alternatives: boundary.debug.alternatives,
      networks: boundary.debug.networks,
      elapsedMs: Date.now() - t0,
    },
  };
};

// One SAT per clamped floor, not per click: every room placed on a floorplan
// was rebuilding the same page-sized table before growing its rectangle.
const footprintSats = new WeakMap();

const footprintSat = (target, analysis) => {
  const cached = footprintSats.get(target);
  if (cached) return cached;
  const sat = buildSat(target.footprintMask, analysis.width, analysis.height);
  footprintSats.set(target, sat);
  return sat;
};

export const detectRoomFromClickCore = (imageData, clickPoint, options = {}) => {
  if (!clickPoint) return null;
  const t0 = Date.now();
  // One working scale for both stages: run at two, and the footprint the room
  // detector is clamped by is a measurably different building from the
  // perimeter the user sees.
  const maxDimension = options.preprocess?.maxDimension ?? 1400;
  const analysis = getCachedAnalysis(
    options.cacheKey, maxDimension, options.analyze,
    () => analyzeFloorplan(imageData, { maxDimension, ...options.analyze }),
  );

  const workPoint = {
    x: clickPoint.x * analysis.scaleX,
    y: clickPoint.y * analysis.scaleY,
  };

  // The boundary pass supplies the footprint clamp so room growth can never
  // escape the building. Detection still works (unclamped) if it fails.
  // On multi-floor pages, clamp to the floor under the click so rooms outside
  // the largest footprint aren't rejected.
  //
  // A clamp is a rail, not a definition of living area, and its two failure
  // modes are not symmetric: too tight and the click falls outside, so the
  // room is never detected at all and nothing says why; too loose and growth
  // is bounded by wall coverage instead, which is what the unclamped path
  // already does. So it asks for the widest hypothesis rather than the
  // best-scoring one. `autoGarage: false` was half of that intent — it stops
  // the non-GLA carve, but it cannot hand back a bay the winning candidate
  // never enclosed, which is how "clicking a garage label must still detect
  // the garage room" failed whenever the structural hypothesis won.
  //
  // The search cache is what makes this affordable: this trace and the
  // perimeter trace that follows a room placement climb the same closing
  // ladder, and the ladder is ~84% of a trace. The boundary options join the
  // memo key — keyed on the image alone, a second call with different options
  // was silently answered with the first call's geometry.
  const boundary = getCachedAnalysis(
    options.cacheKey
      ? `${options.cacheKey}::roomclamp::${JSON.stringify(options.boundary ?? null)}`
      : null,
    maxDimension, options.analyze,
    () => traceBoundary(analysis, {
      ...options.boundary,
      autoGarage: false,
      inclusive: true,
      searchCache: getSearchCache(options.cacheKey, maxDimension, options.analyze),
    }),
  );
  let footprintInfo = null;
  if (boundary) {
    const px = Math.min(analysis.width - 1, Math.max(0, Math.round(workPoint.x)));
    const py = Math.min(analysis.height - 1, Math.max(0, Math.round(workPoint.y)));
    const clickedFloor = (boundary.floors ?? [])
      .find((floor) => floor.footprintMask[py * analysis.width + px]);
    const target = clickedFloor ?? boundary;
    footprintInfo = {
      footprintMask: target.footprintMask,
      footprintArea: target.footprintArea,
      satFootprint: footprintSat(target, analysis),
    };
  }
  const labelBbox = options.labelBbox
    ? {
      x: options.labelBbox.x * analysis.scaleX,
      y: options.labelBbox.y * analysis.scaleY,
      width: options.labelBbox.width * analysis.scaleX,
      height: options.labelBbox.height * analysis.scaleY,
    }
    : null;

  // Scale hint in original image px per foot -> working scale.
  const hint = options.pixelsPerFoot;
  const room = growRoomRect(analysis, footprintInfo, workPoint, {
    labelBbox,
    labelDims: options.labelDims,
    pixelsPerFoot: hint?.x > 0 && hint?.y > 0
      ? { x: hint.x * analysis.scaleX, y: hint.y * analysis.scaleY }
      : null,
  });
  if (!room) return null;

  const polygon = mapPolygonToOriginal([
    { x: room.rect.left, y: room.rect.top },
    { x: room.rect.right + 1, y: room.rect.top },
    { x: room.rect.right + 1, y: room.rect.bottom + 1 },
    { x: room.rect.left, y: room.rect.bottom + 1 },
  ], analysis.scaleX, analysis.scaleY);
  const bounds = polygonBounds(polygon);

  // Per-side wall faces in original px. These are direct measurements of the
  // interior face of one wall over a known span — the same surface the
  // boundary stage otherwise has to approximate — and used to be discarded.
  const sides = {};
  for (const key of ['left', 'right', 'top', 'bottom']) {
    const side = room.sides[key];
    if (!side) continue;
    const horizontal = key === 'left' || key === 'right';
    sides[key] = {
      edge: side.edge / (horizontal ? analysis.scaleX : analysis.scaleY),
      cov: side.cov,
      thick: side.thick,
      kind: side.kind,
      exterior: side.exterior ?? null,
    };
  }

  return {
    polygon,
    overlay: toOverlay(bounds),
    confidence: room.confidence,
    rect: {
      left: bounds.minX, right: bounds.maxX, top: bounds.minY, bottom: bounds.maxY,
    },
    sides,
    pixelsPerFoot: room.pixelsPerFoot
      ? {
        x: room.pixelsPerFoot.x / analysis.scaleX,
        y: room.pixelsPerFoot.y / analysis.scaleY,
      }
      : null,
    debug: {
      workingSize: { width: analysis.width, height: analysis.height },
      scale: { x: analysis.scaleX, y: analysis.scaleY },
      wallThickness: analysis.wallThickness,
      sides: room.sides,
      hasFootprint: Boolean(footprintInfo),
      elapsedMs: Date.now() - t0,
    },
  };
};

// The interior envelope can fail to be produced; falling back to the exterior
// polygon keeps something on screen, and the `no-inner` warning raised during
// validation is what tells the user the interior figure is not really interior.
export const boundaryByMode = (result, wallMode = 'inner') => {
  if (!result) return null;
  if (wallMode === 'outer') return result.outer ?? result.inner;
  return result.inner ?? result.outer;
};
