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
import { extractWallSegments } from './wallEvidence.js';
import { growRoomRect } from './room.js';
import { buildSat } from './raster.js';
import { polygonBounds, mapPolygonToOriginal, ringSetArea } from './polygon.js';
import { validateBoundaryResult } from './validate.js';
import { getCachedAnalysis, getSearchCache, searchCacheStats } from './cache.js';
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

// Anchors are emitted in working-raster px. `scaleX`/`scaleY` are working px
// per ORIGINAL px (raster.js: `width / ow`), so they are <= 1 and mapping back
// DIVIDES — exactly what mapPolygonToOriginal does. Multiplying instead puts
// every anchor off the page by 1/scale², and no benchmark would catch it,
// because benchmarks never read anchors.
export const mapAnchor = (anchor, scaleX, scaleY) => {
  if (!anchor) return null;
  if (anchor.kind === 'ring') {
    return { kind: 'ring', rings: mapRings(anchor.rings, scaleX, scaleY) };
  }
  if (anchor.kind === 'point' || anchor.kind === 'segment') {
    // A segment carries either one polyline (`points`) or several disconnected
    // ones (`runs`) — weak support is rarely a single stretch.
    if (anchor.runs) {
      return {
        kind: anchor.kind,
        runs: anchor.runs.map((r) => mapPolygonToOriginal(r ?? [], scaleX, scaleY)),
      };
    }
    return { kind: anchor.kind, points: mapPolygonToOriginal(anchor.points ?? [], scaleX, scaleY) };
  }
  if (anchor.kind === 'rect') {
    return {
      kind: 'rect',
      x: anchor.x / scaleX,
      y: anchor.y / scaleY,
      width: anchor.width / scaleX,
      height: anchor.height / scaleY,
    };
  }
  return null;
};

// Applied to boundary-stage warnings only. validate.js runs on already-mapped
// polygons and original-px labels, so anything it emits is original px already
// and must never be scaled a second time — which is why this is not folded into
// `tagWarning`, whose input list mixes both sources.
const mapWarningAnchors = (list, scaleX, scaleY) => (list ?? []).map(
  (w) => (w.anchor ? { ...w, anchor: mapAnchor(w.anchor, scaleX, scaleY) } : w)
);

// `anchor` is where on the image to look. Detector-emitted anchors arrive
// already mapped; everything else has none.
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
      // Kept unscaled so a `room-outside` warning can carry where the room was
      // in original px. Rooms are written with `name: null`, so matching a
      // warning back to one by name never resolves.
      sourceRect: r.rect,
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
      warnings: mapWarningAnchors(floor.warnings, scaleX, scaleY),
      // Mapped here with everything else it will be drawn beside. These are
      // whole footprints in working px; left unmapped they would be offered to
      // the user at 1/scale of where the building is.
      alternatives: (floor.alternatives ?? [])
        .map((alt) => ({
          ...alt,
          polygon: mapPolygonToOriginal(alt.polygon ?? [], scaleX, scaleY),
        }))
        .filter((alt) => alt.polygon.length >= 3),
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
      // The extent of the drawing, in the same original px as the polygons, so
      // `covers-page` can ask whether the outline outgrew the *building* rather
      // than whether the building fills its own sheet. A plan cropped tight to
      // its page is the common CAD export, not a runaway flood.
      inkArea: boundary.debug?.wallBboxArea
        ? boundary.debug.wallBboxArea / (scaleX * scaleY)
        : null,
      // Two facts about the sheet rather than about any one outline, so they
      // are raised here where the result-scoped checks live. Wall thickness is
      // the answer to "is this image too small to trace" — below ~3px at
      // working scale the strokes do not survive, and measured on the fixtures
      // confidence *rises* as the input degrades. Skew is measured by the
      // polygon fit and was discarded; past its ceiling the fit squashes the
      // outline onto the page's axes, which silently shrinks the footprint.
      wallThickness: analysis.wallThickness,
      skew: (boundary.floors ?? []).reduce((worst, f) => (
        f.deskewed === false && f.skewDeg > worst ? f.skewDeg : worst
      ), 0),
      labels: options.constraints?.interiorPoints ?? [],
      // A label inside a deliberately excluded region (a garage, a porch) is
      // outside the outline on purpose, not evidence of a bad trace.
      exemptRegions: options.excludeRegions ?? [],
      // The regions the carve actually removed, back in original px. The OCR
      // list above only covers exclusions the app knew about before the trace;
      // geometric garage detection finds its own, and without them the tracer
      // reported the garage it had just carved as a label outside the outline.
      //
      // Only carves something *said* was excluded — an OCR keyword, or the
      // garage detector's door evidence. A `shaded` carve is a guess from tint
      // alone at 0.5 confidence, and letting it exempt the labels it removed
      // switches off the one check that could contradict it: two tinted
      // bathrooms came off this plan at 93% confidence with nothing said,
      // because the carve that took them also silenced their labels.
      carvedRegions: (boundary.floors ?? []).flatMap(
        (floor) => (floor.excludedRegions ?? []).filter(
          (r) => r.bbox && (r.sources ?? [r.source]).some((src) => src !== 'shaded'),
        ).map((r) => ({
          x: r.bbox.minX / scaleX,
          y: r.bbox.minY / scaleY,
          width: (r.bbox.maxX - r.bbox.minX + 1) / scaleX,
          height: (r.bbox.maxY - r.bbox.minY + 1) / scaleY,
        })),
      ),
      userDrawn: Boolean(brush),
    },
  );

  // Mapped from the same unmapped source objects the per-floor list came from,
  // and `mapAnchor` is pure, so each object is mapped exactly once either way.
  const boundaryWarnings = mapWarningAnchors(boundary.warnings, scaleX, scaleY);
  const warnings = [...boundaryWarnings, ...validation.warnings].map(tagWarning);
  const confidence = Math.max(0, Math.min(0.98, boundary.confidence * validation.factor));

  // The validation discount reaches the floors, not only the aggregate. Every
  // durable surface — the dock chip, `planStage`, the exhibit's flag list —
  // reads a floor's own confidence, and only the transient toast read the
  // aggregate. A floor cut to 0.35 by `label-outside` chipped green at 0.98
  // while the toast beside it said 65%, about the same outline.
  const discounted = fanOutWarnings(floors, boundaryWarnings, validation.warnings)
    .map((floor, i) => ({
      ...floor,
      confidence: Math.max(0, Math.min(0.98,
        floor.confidence * (validation.floorFactors?.[i] ?? validation.factor))),
    }));

  return {
    outer,
    inner,
    floors: discounted,
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
      // Present only when the first attempt was re-searched. Part of quality
      // rather than debug: it is the record of why the outline on screen is not
      // the one the first search produced, and the worker forwards debug
      // through a whitelist that would have dropped it.
      ...(boundary.remediation ? { remediation: boundary.remediation } : {}),
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
      searchMemo: searchCacheStats(),
      elapsedMs: Date.now() - t0,
    },
  };
};

// The clamp trace behind a room click, as one function so the prewarm below and
// `detectRoomFromClickCore` cannot drift apart. Sharing this exact call is what
// makes the prewarm free of behaviour risk: the two do not merely compute the
// same thing, they resolve to the same memo entry.
//
// That is also why no option is added for the prewarm's benefit (`remediate`
// included). `options.boundary` is part of the memo key, so a prewarm that
// passed anything extra would key differently, miss, and buy nothing.
const roomClampBoundary = (analysis, maxDimension, options) => getCachedAnalysis(
  options.cacheKey
    ? `${options.cacheKey}::roomclamp::${JSON.stringify(options.boundary ?? null)}`
    : null,
  maxDimension, options.analyze,
  () => traceBoundary(analysis, {
    ...options.boundary,
    autoGarage: false,
    // The other half of the same intent, and it was missing: a tinted bathroom
    // floor reads to `findShadedPockets` exactly as a condo terrace does, so
    // the clamp came back with both baths cut out of it and a click on either
    // label landed outside the rail and returned nothing at all. Draw mode
    // already turns this pair off together, for the same reason.
    autoShaded: false,
    inclusive: true,
    searchCache: getSearchCache(options.cacheKey, maxDimension, options.analyze),
  }),
);

/**
 * Run the analysis and the room-clamp trace for their side effect on the memo,
 * and return nothing but a receipt.
 *
 * The detection worker is idle for the whole OCR scan (2-4 s) and then does
 * this work serially afterwards, where it lands squarely on the clock: the
 * first measured label pays analyze + a complete closing-ladder search. Neither
 * depends on anything OCR produces — `boundary.js` is explicit that constraints
 * only reach scoring and excludeRegions only reach buildFloor — so both can run
 * during the scan instead.
 *
 * Correctness is structural rather than measured: steps 4 and 5 call exactly
 * the code they called before and simply find the memo populated.
 */
export const prewarmDetectionCore = (imageData, options = {}) => {
  const maxDimension = options.preprocess?.maxDimension ?? 1400;
  const analysis = getCachedAnalysis(
    options.cacheKey, maxDimension, options.analyze,
    () => analyzeFloorplan(imageData, { maxDimension, ...options.analyze }),
  );
  roomClampBoundary(analysis, maxDimension, options);
  return { warmed: true };
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
  const boundary = roomClampBoundary(analysis, maxDimension, options);
  let footprintInfo = null;
  if (boundary) {
    const px = Math.min(analysis.width - 1, Math.max(0, Math.round(workPoint.x)));
    const py = Math.min(analysis.height - 1, Math.max(0, Math.round(workPoint.y)));
    const clickedFloor = (boundary.floors ?? [])
      .find((floor) => floor.footprintMask[py * analysis.width + px]);
    // A clamp the click falls *outside* is not a tighter rail, it is a refusal
    // with no words: growth starts outside its own bound, `growRoomRect`
    // returns null, and the user clicks a room and nothing happens. Falling
    // back to the whole boundary never helped — that is the footprint the
    // click is already outside of. The bbox is what separates the two cases,
    // and it also carries the refusal the clamp used to carry by accident:
    // inside it, a click the mask rejects is a hole the tracer left in a
    // building it did enclose, so drop the clamp and let wall coverage bound
    // the growth as the unclamped path already does; outside it, the click is
    // on blank page and the answer is still nothing, which is what the clamp —
    // and only the clamp — was stopping, so it is refused here in its own
    // words. ExampleFloorplan9's bottom-right corner is drawn open, so the
    // seal floods in and takes the storage room: clamped it is undetectable,
    // unclamped it is an ordinary walled rectangle.
    const inFootprintBbox = (bbox) => bbox && px >= bbox.minX && px <= bbox.maxX
      && py >= bbox.minY && py <= bbox.maxY;
    const target = clickedFloor
      ?? ((boundary.floors ?? []).find((floor) => inFootprintBbox(floor.footprintBbox))
        ?? (inFootprintBbox(boundary.footprintBbox) ? boundary : null));
    if (!target) return null;
    if (target.footprintMask[py * analysis.width + px]) {
      footprintInfo = {
        footprintMask: target.footprintMask,
        footprintArea: target.footprintArea,
        satFootprint: footprintSat(target, analysis),
      };
    }
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
    foreignPoints: (options.foreignPoints ?? []).map((p) => ({
      x: p.x * analysis.scaleX, y: p.y * analysis.scaleY,
    })),
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

// The snap engine's vectorisation, taken off the SAME memoised analysis the
// room and boundary stages use.
//
// `wallSnapEngine.wallSnapSegments` ran its own
// `binarizeToWorkingScale(imageData, 1400)` — bit-identical to the first step
// of `analyzeFloorplan`, and thrown away afterwards. Since `useSnappingSystem`
// already fires this request the moment the image is set (auto-snap is on by
// default), that duplicated slice was the only thing standing between the app
// and a free analysis prewarm: this request now runs during the OCR scan and
// leaves the analysis in the memo, so step 4's first label no longer pays for
// it. The segments are unchanged — same `ink`, same extractor.
//
// `maxDimension` is pinned to 1400 rather than read from `options.preprocess`
// for two reasons: the segments are *defined* at that scale
// (wallSnapEngine.WORKING_MAX_DIMENSION), and the memo key has to be the one
// the room/boundary calls default to or the sharing silently stops.
export const wallSnapSegmentsCore = (imageData, options = {}) => {
  const analysis = getCachedAnalysis(
    options.cacheKey, 1400, options.analyze,
    () => analyzeFloorplan(imageData, { maxDimension: 1400, ...options.analyze }),
  );
  const { vertical, horizontal } = extractWallSegments(
    analysis.ink, analysis.width, analysis.height,
  );
  return {
    vertical, horizontal, scaleX: analysis.scaleX, scaleY: analysis.scaleY,
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
