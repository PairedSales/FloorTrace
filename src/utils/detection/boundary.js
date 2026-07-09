// Exterior/interior boundary tracing: adaptively close the wall mask until
// the footprint seals (flood-fill from the border no longer leaks inside),
// then polygonize the footprint contour and derive the interior envelope by
// eroding the footprint by the sampled exterior wall thickness.

import {
  bridgeRuns,
  closeRect,
  dilateRect,
  erodeRect,
  openRect,
  floodOutside,
  labelComponents,
} from './raster.js';
import {
  traceComponentBoundary,
  simplifyRing,
  rectilinearFit,
  polygonArea,
  polygonBounds,
} from './polygon.js';

const largestComponent = (mask, width, height) => {
  const { labels, components } = labelComponents(mask, width, height);
  if (!components.length) return null;
  let best = components[0];
  for (const comp of components) {
    if (comp.size > best.size) best = comp;
  }
  return { labels, component: best };
};

const bboxAreaOf = (bbox) => (bbox.maxX - bbox.minX + 1) * (bbox.maxY - bbox.minY + 1);

const componentMask = (labels, component, width) => {
  const mask = new Uint8Array(labels.length);
  const { minX, minY, maxX, maxY } = component.bbox;
  for (let y = minY; y <= maxY; y += 1) {
    const row = y * width;
    for (let x = minX; x <= maxX; x += 1) {
      if (labels[row + x] === component.id) mask[row + x] = 1;
    }
  }
  return mask;
};

const measureFootprint = (wallMask, width, height, radius) => {
  const closed = radius > 0 ? closeRect(wallMask, width, height, radius) : wallMask;
  const outside = floodOutside(closed, width, height);
  const footprint = new Uint8Array(closed.length);
  for (let i = 0; i < closed.length; i += 1) footprint[i] = outside[i] ? 0 : 1;
  const labeled = largestComponent(footprint, width, height);
  if (!labeled) return null;
  const { labels, component } = labeled;
  return {
    mask: componentMask(labels, component, width),
    labels,
    closed,
    componentId: component.id,
    area: component.size,
    bbox: component.bbox,
    bboxArea: bboxAreaOf(component.bbox),
    radius,
  };
};

// Sealed = the footprint is a filled building region, not a leaked sliver:
// it must cover most of the wall network's bounding box and be reasonably
// solid within its own bbox.
const isSealed = (fp, wallBboxArea) =>
  fp && fp.bboxArea >= 0.55 * wallBboxArea && fp.area >= 0.4 * fp.bboxArea;

// March inward from footprint boundary pixels and measure the depth of the
// initial wall band. Gaps up to `gapTol` (double-line wall cavities) count as
// wall; a longer free run ends the band.
const sampleExteriorThickness = (boundary, wallMask, footprint, width, height, strokeThickness) => {
  const gapTol = Math.max(4, strokeThickness * 2);
  const maxDepth = Math.max(12, strokeThickness * 6) + gapTol;
  const samples = [];
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  for (let i = 0; i < boundary.length; i += 4) {
    const p = boundary[i];
    let dir = null;
    for (const d of dirs) {
      const nx = p.x + d[0] * 3;
      const ny = p.y + d[1] * 3;
      const bx = p.x - d[0] * 2;
      const by = p.y - d[1] * 2;
      const inwardOk = nx >= 0 && ny >= 0 && nx < width && ny < height && footprint[ny * width + nx];
      const outwardOk = bx < 0 || by < 0 || bx >= width || by >= height || !footprint[by * width + bx];
      if (inwardOk && outwardOk) {
        dir = d;
        break;
      }
    }
    if (!dir) continue;

    let lastWall = -1;
    let freeRun = 0;
    let sawWall = false;
    for (let step = 0; step <= maxDepth; step += 1) {
      const x = p.x + dir[0] * step;
      const y = p.y + dir[1] * step;
      if (x < 0 || y < 0 || x >= width || y >= height) break;
      if (wallMask[y * width + x]) {
        lastWall = step;
        freeRun = 0;
        sawWall = true;
      } else {
        freeRun += 1;
        if (sawWall && freeRun > gapTol) break;
        // Boundary pixels sitting on a bridged gap never see wall up close.
        if (!sawWall && step > 3) break;
      }
    }
    if (sawWall && lastWall >= 0) samples.push(lastWall + 1);
  }

  if (samples.length < 8) return Math.max(2, strokeThickness);
  samples.sort((a, b) => a - b);
  return samples[(samples.length / 2) | 0];
};

// Carve OCR-labelled exterior features (porch/patio/deck/balcony) out of the
// sealed footprint. Each label bbox seeds the enclosed open cavity it sits in
// (labelled on footprint minus the closed wall mask, so doorways bridged by
// the seal keep house rooms separate); the cavity is cleared and a rect
// opening then drops its orphaned railing/outline ring — the shared house
// wall survives as part of the solid footprint body and becomes the new
// boundary, i.e. the trace lands on the exterior wall face.
const carveExcludedRegions = (footprint, width, height, regions, exteriorThickness) => {
  const open = new Uint8Array(footprint.mask.length);
  for (let i = 0; i < open.length; i += 1) {
    open[i] = footprint.mask[i] && !footprint.closed[i] ? 1 : 0;
  }
  const { labels, components } = labelComponents(open, width, height);
  if (!components.length) return null;

  const minCavity = Math.max(16, exteriorThickness * exteriorThickness * 4);
  const targets = new Set();
  for (const region of regions) {
    // Vote over a small sample grid: label bboxes are approximate and their
    // centre can land on a stroke or a stray glyph pixel.
    const votes = new Map();
    for (let sy = 0; sy <= 4; sy += 1) {
      for (let sx = 0; sx <= 4; sx += 1) {
        const x = Math.round(region.x + (region.width * sx) / 4);
        const y = Math.round(region.y + (region.height * sy) / 4);
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const id = labels[y * width + x];
        if (id >= 0) votes.set(id, (votes.get(id) ?? 0) + 1);
      }
    }
    let best = -1;
    let bestVotes = 0;
    for (const [id, count] of votes) {
      if (count > bestVotes) {
        best = id;
        bestVotes = count;
      }
    }
    if (best < 0) continue;
    const size = components[best].size;
    // Sanity: skip noise slivers and anything big enough to be the house
    // interior itself (a misplaced label must not gut the footprint).
    if (size < minCavity || size > 0.45 * footprint.area) continue;
    targets.add(best);
  }
  if (!targets.size) return null;

  const mask = footprint.mask.slice();
  for (const id of targets) {
    const { minX, minY, maxX, maxY } = components[id].bbox;
    for (let y = minY; y <= maxY; y += 1) {
      const row = y * width;
      for (let x = minX; x <= maxX; x += 1) {
        if (labels[row + x] === id) mask[row + x] = 0;
      }
    }
  }

  // Clip the opening back to the carved mask so its dilation cannot refill
  // the cavity we just removed.
  const opened = openRect(mask, width, height, Math.max(2, exteriorThickness + 2));
  for (let i = 0; i < opened.length; i += 1) {
    if (!mask[i]) opened[i] = 0;
  }
  const labeled = largestComponent(opened, width, height);
  if (!labeled || labeled.component.size < 0.35 * footprint.area) return null;

  const { component, labels: newLabels } = labeled;
  const newMask = new Uint8Array(opened.length);
  const { minX, minY, maxX, maxY } = component.bbox;
  for (let y = minY; y <= maxY; y += 1) {
    const row = y * width;
    for (let x = minX; x <= maxX; x += 1) {
      if (newLabels[row + x] === component.id) newMask[row + x] = 1;
    }
  }
  return {
    excluded: targets.size,
    footprint: {
      ...footprint,
      mask: newMask,
      labels: newLabels,
      componentId: component.id,
      area: component.size,
      bbox: component.bbox,
      bboxArea: (maxX - minX + 1) * (maxY - minY + 1),
    },
  };
};

const polygonize = (labels, width, height, componentId, epsilon, fitOptions) => {
  const ring = traceComponentBoundary(labels, width, height, componentId);
  if (ring.length < 3) return null;
  const simplified = simplifyRing(ring, epsilon);
  if (simplified.length < 3) return null;
  return { polygon: rectilinearFit(simplified, fitOptions), ring };
};

// One sealed footprint component -> floor entry: outer contour, per-floor
// exterior thickness, OCR exclusion carving, and eroded inner envelope.
const buildFloor = (initialFootprint, analysis, epsilon, options) => {
  const { wallMask, width, height, wallThickness } = analysis;
  let footprint = initialFootprint;
  let outerResult = polygonize(
    footprint.labels, width, height, footprint.componentId, epsilon, options.fit,
  );
  if (!outerResult) return null;

  let exteriorThickness = sampleExteriorThickness(
    outerResult.ring, wallMask, footprint.mask, width, height, wallThickness,
  );

  // OCR-labelled exterior features (porch/patio/deck…) are removed after the
  // seal so the trace covers the main structure only. Labels sitting in a
  // different floor's cavity get no votes here, so passing all regions to
  // every floor is safe.
  let excluded = 0;
  if (options.excludeRegions?.length) {
    const carved = carveExcludedRegions(
      footprint, width, height, options.excludeRegions, exteriorThickness,
    );
    if (carved) {
      const carvedOuter = polygonize(
        carved.footprint.labels, width, height, carved.footprint.componentId, epsilon, options.fit,
      );
      if (carvedOuter) {
        footprint = carved.footprint;
        outerResult = carvedOuter;
        excluded = carved.excluded;
        exteriorThickness = sampleExteriorThickness(
          outerResult.ring, wallMask, footprint.mask, width, height, wallThickness,
        );
      }
    }
  }

  let innerPolygon = null;
  const eroded = erodeRect(footprint.mask, width, height, exteriorThickness);
  const innerComp = largestComponent(eroded, width, height);
  if (innerComp && innerComp.component.size > 0.2 * footprint.area) {
    const innerResult = polygonize(
      innerComp.labels, width, height, innerComp.component.id, epsilon, options.fit,
    );
    if (innerResult && polygonArea(innerResult.polygon) > 0) {
      innerPolygon = innerResult.polygon;
    }
  }

  return {
    outerPolygon: outerResult.polygon,
    innerPolygon,
    footprintMask: footprint.mask,
    footprintArea: footprint.area,
    footprintBbox: footprint.bbox,
    exteriorThickness,
    excluded,
  };
};

// Single-floor detection against one wall mask: seal-radius search with a
// bridge guard, falling back to the outer contour of the wall network (walls
// plus everything they enclose) when the interior never seals — window gaps
// stripped from the wall mask make that common on real plans.
const detectOneFloor = (wallMask, width, height, wallThickness, options) => {
  const wallExtent = largestComponent(wallMask, width, height);
  if (!wallExtent) return null;
  const wb = wallExtent.component.bbox;
  const wallBboxArea = bboxAreaOf(wb);
  if (wallBboxArea < 0.01 * width * height) return null;

  const longest = Math.max(width, height);
  const maxRadius = options.maxCloseRadius ?? Math.max(24, Math.round(longest * 0.03));
  const radii = [];
  for (let r = 2; r < maxRadius; r = Math.round(r * 1.45) + 1) radii.push(r);
  radii.push(maxRadius);

  const searchSeal = (mask, tried, retry) => {
    let sealed = null;
    let lastGood = null;
    for (const r of radii) {
      const fp = measureFootprint(mask, width, height, r);
      tried.push({ radius: r, area: fp?.area ?? 0, retry });
      if (!fp) continue;
      // A footprint spanning far beyond the wall network means the closing
      // has bridged into a neighbouring floor outline: stop before accepting.
      if (fp.bboxArea > 1.35 * wallBboxArea) break;
      lastGood = fp;
      if (isSealed(fp, wallBboxArea)) {
        sealed = fp;
        break;
      }
    }
    return { sealed, lastGood };
  };

  const tried = [];
  let { sealed: footprint, lastGood } = searchSeal(wallMask, tried, false);

  let usedFallback = false;
  if (!footprint) {
    const fallback = lastGood ?? measureFootprint(wallMask, width, height, radii[0]);
    if (!fallback) return null;

    // Never sealed — usually window spans in the exterior walls wider than
    // any radius that is safe while neighbouring floors share the mask. The
    // fallback blob isolates this network's walls, so retry on them alone
    // with colinear gaps bridged; without neighbours, sealing is safe.
    const zone = dilateRect(fallback.mask, width, height, 4);
    const isolated = new Uint8Array(wallMask.length);
    for (let i = 0; i < isolated.length; i += 1) {
      isolated[i] = wallMask[i] && zone[i] ? 1 : 0;
    }
    const maxGap = Math.max(24, wallThickness * 10);
    const minFlank = Math.max(8, wallThickness * 2);
    const bridged = bridgeRuns(isolated, width, height, maxGap, minFlank);
    footprint = searchSeal(bridged, tried, true).sealed;

    if (!footprint) {
      // Still leaking: use the wall network's own outer contour (walls plus
      // everything they enclose, ignoring unreachable-gap leaks).
      usedFallback = true;
      footprint = fallback;
    }
  }

  return {
    footprint,
    usedFallback,
    tried,
    wallBbox: wb,
    wallBboxArea,
    wallSize: wallExtent.component.size,
  };
};

export const traceBoundary = (analysis, options = {}) => {
  const { width, height, wallThickness } = analysis;
  const epsilon = options.simplifyEpsilon ?? Math.max(2, wallThickness * 0.35);
  const maxFloors = Math.max(1, Math.min(5, options.maxFloors ?? 5));

  // Multi-floor pages: detect one floor at a time, erase its wall network,
  // and re-run on the remainder. Each pass reuses the full single-floor
  // algorithm, so floors that seal at different radii (or never seal) still
  // trace independently — a single global closing radius cannot both bridge
  // window gaps and keep nearby floors separate.
  const floors = [];
  const searches = [];
  let first = null;
  let workMask = analysis.wallMask;

  for (let i = 0; i < maxFloors; i += 1) {
    const detected = detectOneFloor(workMask, width, height, wallThickness, options);
    if (!detected) break;
    // Much smaller wall networks than the first floor's are legends or
    // leftover fragments, not floors.
    if (first && detected.wallSize < 0.15 * first.wallSize) break;
    if (!first) first = detected;
    searches.push(detected.tried);

    const floor = buildFloor(detected.footprint, { ...analysis, wallMask: workMask }, epsilon, options);
    if (floor) {
      floor.sealRadius = detected.footprint.radius;
      floor.usedFallback = detected.usedFallback;
      floors.push(floor);
    }
    if (floors.length >= maxFloors) break;

    const margin = Math.max(4, detected.footprint.radius);
    const eraseZone = dilateRect(detected.footprint.mask, width, height, margin);
    const next = new Uint8Array(workMask.length);
    let remaining = 0;
    for (let p = 0; p < workMask.length; p += 1) {
      const keep = workMask[p] && !eraseZone[p] ? 1 : 0;
      next[p] = keep;
      remaining += keep;
    }
    if (remaining < 0.15 * first.wallSize) break;
    workMask = next;
  }
  if (!floors.length) return null;

  // Post-filter tiny outlines that slipped past the wall-size guard.
  const biggestBboxArea = floors.reduce(
    (best, f) => Math.max(best, bboxAreaOf(f.footprintBbox)), 0,
  );
  const kept = floors.filter((f) => bboxAreaOf(f.footprintBbox) >= 0.12 * biggestBboxArea);

  // Reading order (rows top-to-bottom, left-to-right within a row) so floor
  // numbering matches how the page reads; the largest floor stays the primary
  // for the single-boundary top-level fields.
  kept.sort((a, b) => {
    const ab = a.footprintBbox;
    const bb = b.footprintBbox;
    const overlap = Math.min(ab.maxY, bb.maxY) - Math.max(ab.minY, bb.minY);
    const minH = Math.min(ab.maxY - ab.minY, bb.maxY - bb.minY);
    return overlap > 0.3 * minH ? ab.minX - bb.minX : ab.minY - bb.minY;
  });
  const primary = kept.reduce(
    (best, f) => (bboxAreaOf(f.footprintBbox) > bboxAreaOf(best.footprintBbox) ? f : best),
  );

  return {
    floors: kept,
    outerPolygon: primary.outerPolygon,
    innerPolygon: primary.innerPolygon,
    footprintMask: primary.footprintMask,
    footprintArea: primary.footprintArea,
    footprintBbox: primary.footprintBbox,
    sealRadius: primary.sealRadius,
    exteriorThickness: primary.exteriorThickness,
    usedFallback: primary.usedFallback,
    excluded: kept.reduce((sum, f) => sum + f.excluded, 0),
    debug: { tried: searches[0], sealSearches: searches, wallBbox: first.wallBbox, wallBboxArea: first.wallBboxArea },
  };
};

export { polygonArea, polygonBounds };
