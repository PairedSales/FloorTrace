// Exterior/interior boundary tracing: adaptively close the wall mask until
// the footprint seals (flood-fill from the border no longer leaks inside),
// then polygonize the footprint contour and derive the interior envelope by
// eroding the footprint by the sampled exterior wall thickness.

import {
  closeRect,
  erodeRect,
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

const measureFootprint = (wallMask, width, height, radius) => {
  const closed = radius > 0 ? closeRect(wallMask, width, height, radius) : wallMask;
  const outside = floodOutside(closed, width, height);
  const footprint = new Uint8Array(closed.length);
  for (let i = 0; i < closed.length; i += 1) footprint[i] = outside[i] ? 0 : 1;
  const labeled = largestComponent(footprint, width, height);
  if (!labeled) return null;
  const { labels, component } = labeled;
  const mask = new Uint8Array(footprint.length);
  const { minX, minY, maxX, maxY } = component.bbox;
  for (let y = minY; y <= maxY; y += 1) {
    const row = y * width;
    for (let x = minX; x <= maxX; x += 1) {
      if (labels[row + x] === component.id) mask[row + x] = 1;
    }
  }
  return {
    mask,
    labels,
    componentId: component.id,
    area: component.size,
    bbox: component.bbox,
    bboxArea: (maxX - minX + 1) * (maxY - minY + 1),
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

const polygonize = (labels, width, height, componentId, epsilon, fitOptions) => {
  const ring = traceComponentBoundary(labels, width, height, componentId);
  if (ring.length < 3) return null;
  const simplified = simplifyRing(ring, epsilon);
  if (simplified.length < 3) return null;
  return { polygon: rectilinearFit(simplified, fitOptions), ring };
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
    const outside = floodOutside(closeRect(wallMask, width, height, maxRadius), width, height);
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
      componentId: labeled.component.id,
      area: labeled.component.size,
      bbox: labeled.component.bbox,
      bboxArea: wallBboxArea,
      radius: maxRadius,
    };
  }

  const epsilon = options.simplifyEpsilon ?? Math.max(2, wallThickness * 0.35);
  const outerResult = polygonize(
    footprint.labels, width, height, footprint.componentId, epsilon, options.fit,
  );
  if (!outerResult) return null;

  const exteriorThickness = sampleExteriorThickness(
    outerResult.ring, wallMask, footprint.mask, width, height, wallThickness,
  );

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
    sealRadius: footprint.radius,
    exteriorThickness,
    usedFallback,
    debug: { tried, wallBbox: wb, wallBboxArea },
  };
};

export { polygonArea, polygonBounds };
