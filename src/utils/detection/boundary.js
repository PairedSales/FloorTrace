// Exterior/interior boundary tracing: adaptively close the wall mask until
// the footprint seals (flood-fill from the border no longer leaks inside),
// then polygonize the footprint contour and derive the interior envelope by
// eroding the footprint by the sampled exterior wall thickness.

import {
  closeRect,
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
  const { labels, components } = labelComponents(footprint, width, height);
  if (!components.length) return null;
  const sorted = [...components].sort((a, b) => b.size - a.size);
  const best = sorted[0];
  return {
    mask: componentMask(labels, best, width),
    labels,
    closed,
    componentId: best.id,
    area: best.size,
    bbox: best.bbox,
    bboxArea: bboxAreaOf(best.bbox),
    radius,
    components: sorted,
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

export const traceBoundary = (analysis, options = {}) => {
  const { wallMask, width, height, wallThickness } = analysis;

  const wallExtent = largestComponent(wallMask, width, height);
  if (!wallExtent) return null;
  const wb = wallExtent.component.bbox;
  const wallBboxArea = (wb.maxX - wb.minX + 1) * (wb.maxY - wb.minY + 1);
  if (wallBboxArea < 0.01 * width * height) return null;

  const longest = Math.max(width, height);
  const maxRadius = options.maxCloseRadius ?? Math.max(24, Math.round(longest * 0.03));
  const radii = [];
  for (let r = 2; r < maxRadius; r = Math.round(r * 1.45) + 1) radii.push(r);
  radii.push(maxRadius);

  let footprint = null;
  const tried = [];
  for (const r of radii) {
    const fp = measureFootprint(wallMask, width, height, r);
    tried.push({ radius: r, area: fp?.area ?? 0 });
    if (isSealed(fp, wallBboxArea)) {
      footprint = fp;
      break;
    }
  }

  // Never sealed: fall back to the outer contour of the wall network itself
  // (walls + everything they enclose, ignoring unreachable-gap leaks).
  let usedFallback = false;
  if (!footprint) {
    usedFallback = true;
    const filled = new Uint8Array(wallMask.length);
    const closed = closeRect(wallMask, width, height, maxRadius);
    const outside = floodOutside(closed, width, height);
    for (let i = 0; i < filled.length; i += 1) filled[i] = outside[i] ? 0 : 1;
    const labeled = largestComponent(filled, width, height);
    if (!labeled) return null;
    const mask = new Uint8Array(filled.length);
    for (let i = 0; i < filled.length; i += 1) {
      if (labeled.labels[i] === labeled.component.id) mask[i] = 1;
    }
    footprint = {
      mask,
      labels: labeled.labels,
      closed,
      componentId: labeled.component.id,
      area: labeled.component.size,
      bbox: labeled.component.bbox,
      bboxArea: wallBboxArea,
      radius: maxRadius,
    };
  }

  const epsilon = options.simplifyEpsilon ?? Math.max(2, wallThickness * 0.35);

  // Disconnected sibling footprints (multi-floor pages): components that are
  // also solid at the sealing radius and big enough to be a floor outline.
  const maxFloors = Math.max(1, Math.min(5, options.maxFloors ?? 5));
  const footprints = [footprint];
  if (!usedFallback && footprint.components) {
    for (const comp of footprint.components) {
      if (footprints.length >= maxFloors) break;
      if (comp.id === footprint.componentId) continue;
      if (comp.size < 0.12 * footprint.area) break; // sorted by size desc
      if (comp.size < 0.4 * bboxAreaOf(comp.bbox)) continue; // leaked sliver, not a sealed floor
      footprints.push({
        ...footprint,
        mask: componentMask(footprint.labels, comp, width),
        componentId: comp.id,
        area: comp.size,
        bbox: comp.bbox,
        bboxArea: bboxAreaOf(comp.bbox),
      });
    }
  }

  const floors = [];
  for (const fp of footprints) {
    const floor = buildFloor(fp, analysis, epsilon, options);
    if (floor) floors.push(floor);
  }
  if (!floors.length) return null;

  // Reading order (rows top-to-bottom, left-to-right within a row) so floor
  // numbering matches how the page reads; the largest floor stays the primary
  // for the single-boundary top-level fields.
  floors.sort((a, b) => {
    const ab = a.footprintBbox;
    const bb = b.footprintBbox;
    const overlap = Math.min(ab.maxY, bb.maxY) - Math.max(ab.minY, bb.minY);
    const minH = Math.min(ab.maxY - ab.minY, bb.maxY - bb.minY);
    return overlap > 0.3 * minH ? ab.minX - bb.minX : ab.minY - bb.minY;
  });
  const primary = floors.reduce((best, f) => (f.footprintArea > best.footprintArea ? f : best));

  return {
    floors,
    outerPolygon: primary.outerPolygon,
    innerPolygon: primary.innerPolygon,
    footprintMask: primary.footprintMask,
    footprintArea: primary.footprintArea,
    footprintBbox: primary.footprintBbox,
    sealRadius: footprint.radius,
    exteriorThickness: primary.exteriorThickness,
    usedFallback,
    excluded: floors.reduce((sum, f) => sum + f.excluded, 0),
    debug: { tried, wallBbox: wb, wallBboxArea },
  };
};

export { polygonArea, polygonBounds };
