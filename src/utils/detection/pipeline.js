// Detection pipeline cores. Environment-agnostic: both functions take a plain
// {width, height, data} ImageData-like object and run identically in the
// browser worker (src/workers/detectionWorker.js) and the Node benchmark
// harness (scripts/detectionBenchmark.mjs).
//
// detectRoomFromClickCore: shared analysis -> boundary (for the footprint
// clamp) -> coverage-based rectangle growth from the label position.
// traceFloorplanBoundaryCore: shared analysis -> adaptive seal-radius closing
// -> outer contour + wall-thickness-inset inner envelope.

import { analyzeFloorplan } from './analyze.js';
import { traceBoundary } from './boundary.js';
import { growRoomRect } from './room.js';
import { buildSat } from './raster.js';
import { polygonBounds, mapPolygonToOriginal } from './polygon.js';

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

export const traceFloorplanBoundaryCore = (imageData, options = {}) => {
  const t0 = Date.now();
  const analysis = analyzeFloorplan(imageData, {
    maxDimension: options.preprocess?.maxDimension ?? 1400,
    ...options.analyze,
  });
  // Exterior-feature label bboxes (original image px) -> working scale.
  const excludeRegions = (options.excludeRegions ?? []).map((r) => ({
    x: r.x * analysis.scaleX,
    y: r.y * analysis.scaleY,
    width: r.width * analysis.scaleX,
    height: r.height * analysis.scaleY,
  }));
  const boundary = traceBoundary(analysis, { ...options.boundary, excludeRegions });
  if (!boundary) return null;

  const outer = boundaryEntry(boundary.outerPolygon, analysis.scaleX, analysis.scaleY);
  const inner = boundaryEntry(boundary.innerPolygon, analysis.scaleX, analysis.scaleY);
  if (!outer && !inner) return null;

  // One entry per disconnected floor outline, in page reading order. The
  // top-level outer/inner stay the largest floor for single-boundary callers.
  const floors = (boundary.floors ?? [])
    .map((floor) => ({
      outer: boundaryEntry(floor.outerPolygon, analysis.scaleX, analysis.scaleY),
      inner: boundaryEntry(floor.innerPolygon, analysis.scaleX, analysis.scaleY),
    }))
    .filter((floor) => floor.outer || floor.inner);

  return {
    outer,
    inner,
    floors,
    // Top-level (not debug): the worker strips debug before posting back.
    excludedRegions: boundary.excluded,
    debug: {
      floorCount: floors.length,
      workingSize: { width: analysis.width, height: analysis.height },
      scale: { x: analysis.scaleX, y: analysis.scaleY },
      wallThickness: analysis.wallThickness,
      exteriorThickness: boundary.exteriorThickness,
      sealRadius: boundary.sealRadius,
      usedFallback: boundary.usedFallback,
      sealSearch: boundary.debug.tried,
      elapsedMs: Date.now() - t0,
    },
  };
};

export const detectRoomFromClickCore = (imageData, clickPoint, options = {}) => {
  if (!clickPoint) return null;
  const t0 = Date.now();
  const analysis = analyzeFloorplan(imageData, {
    maxDimension: options.preprocess?.maxDimension ?? 1300,
    ...options.analyze,
  });

  const workPoint = {
    x: clickPoint.x * analysis.scaleX,
    y: clickPoint.y * analysis.scaleY,
  };

  // The boundary pass supplies the footprint clamp so room growth can never
  // escape the building. Detection still works (unclamped) if it fails.
  // On multi-floor pages, clamp to the floor under the click so rooms outside
  // the largest footprint aren't rejected.
  const boundary = traceBoundary(analysis, options.boundary);
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
      satFootprint: buildSat(target.footprintMask, analysis.width, analysis.height),
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

  const room = growRoomRect(analysis, footprintInfo, workPoint, {
    labelBbox,
    labelDims: options.labelDims,
  });
  if (!room) return null;

  const polygon = mapPolygonToOriginal([
    { x: room.rect.left, y: room.rect.top },
    { x: room.rect.right + 1, y: room.rect.top },
    { x: room.rect.right + 1, y: room.rect.bottom + 1 },
    { x: room.rect.left, y: room.rect.bottom + 1 },
  ], analysis.scaleX, analysis.scaleY);
  const bounds = polygonBounds(polygon);

  return {
    polygon,
    overlay: toOverlay(bounds),
    confidence: room.confidence,
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

export const boundaryByMode = (result, wallMode = 'inner') => {
  if (!result) return null;
  if (wallMode === 'outer') return result.outer ?? result.inner;
  return result.inner ?? result.outer;
};
