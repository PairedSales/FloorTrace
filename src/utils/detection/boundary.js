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
import { findGarageCavities } from './garage.js';

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
  let largest = components[0];
  let totalEnclosed = 0;
  for (const comp of components) {
    totalEnclosed += comp.size;
    if (comp.size > largest.size) largest = comp;
  }
  return { labels, closed, components, largest, totalEnclosed, radius };
};

// One footprint component -> the shape buildFloor consumes.
const footprintEntry = (measured, component, width) => ({
  mask: componentMask(measured.labels, component, width),
  labels: measured.labels,
  closed: measured.closed,
  componentId: component.id,
  area: component.size,
  bbox: component.bbox,
  bboxArea: bboxAreaOf(component.bbox),
  radius: measured.radius,
});

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

// Enclosed open cavities of the footprint: footprint minus the closed wall
// mask, so doorways bridged by the seal keep house rooms separate.
const openCavities = (footprint, width, height) => {
  const open = new Uint8Array(footprint.mask.length);
  for (let i = 0; i < open.length; i += 1) {
    open[i] = footprint.mask[i] && !footprint.closed[i] ? 1 : 0;
  }
  return labelComponents(open, width, height);
};

// OCR-labelled non-GLA features (garage/porch/patio/deck…): each label bbox
// votes for the enclosed cavity it sits in, and that cavity becomes a carve
// target. Garage-keyword labels are tracked separately for reporting.
const selectLabelledCavities = (regions, labels, components, footprint, minCavity, width, height) => {
  const targets = new Set();
  const garages = new Set();
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
    if (region.keyword && /garage/i.test(region.keyword)) garages.add(best);
  }
  return { targets, garages };
};

// Carve the target cavities out of the sealed footprint: each cavity is
// cleared and a rect opening then drops its orphaned railing/outline ring —
// the shared house wall survives as part of the solid footprint body and
// becomes the new boundary, i.e. the trace lands on the exterior wall face.
const carveCavities = (footprint, width, height, labels, components, targets, exteriorThickness) => {
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
    ...footprint,
    mask: newMask,
    labels: newLabels,
    componentId: component.id,
    area: component.size,
    bbox: component.bbox,
    bboxArea: (maxX - minX + 1) * (maxY - minY + 1),
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

  // Non-GLA regions are removed after the seal so the trace covers the living
  // area only: cavities voted in by OCR labels (garage/porch/patio/deck…) plus
  // cavities with strong geometric garage evidence, which fires even when OCR
  // read nothing. Labels sitting in a different floor's cavity get no votes
  // here, so passing all regions to every floor is safe.
  let excluded = 0;
  let excludedGarages = 0;
  if (options.excludeRegions?.length || options.autoGarage !== false) {
    const cavities = openCavities(footprint, width, height);
    if (cavities.components.length) {
      const minCavity = Math.max(16, exteriorThickness * exteriorThickness * 4);
      let targets = new Set();
      const garageIds = new Set();
      if (options.excludeRegions?.length) {
        const picked = selectLabelledCavities(
          options.excludeRegions, cavities.labels, cavities.components, footprint,
          minCavity, width, height,
        );
        targets = picked.targets;
        for (const id of picked.garages) garageIds.add(id);
      }
      if (options.autoGarage !== false) {
        const garages = findGarageCavities({
          labels: cavities.labels,
          components: cavities.components,
          footprint,
          wallMask,
          width,
          height,
          exteriorThickness,
          minCavity,
        });
        for (const id of garages) {
          targets.add(id);
          garageIds.add(id);
        }
      }
      const carved = carveCavities(
        footprint, width, height, cavities.labels, cavities.components, targets, exteriorThickness,
      );
      if (carved) {
        const carvedOuter = polygonize(
          carved.labels, width, height, carved.componentId, epsilon, options.fit,
        );
        if (carvedOuter) {
          footprint = carved;
          outerResult = carvedOuter;
          excluded = targets.size;
          excludedGarages = garageIds.size;
          exteriorThickness = sampleExteriorThickness(
            outerResult.ring, wallMask, footprint.mask, width, height, wallThickness,
          );
        }
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
    excludedGarages,
  };
};

// Partition the wall mask into disconnected wall networks (one per floor
// outline drawn on the page): dilate to associate nearby strokes, label, and
// project the original wall pixels onto the groups. Networks much smaller
// than the largest are legends or stray fragments, not floors.
const partitionWallNetworks = (wallMask, width, height, wallThickness, maxNetworks) => {
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

  // Long window runs erase whole wall spans, so one floor outline can land
  // here as several components whose bboxes overlap (distinct floors drawn on
  // a page do not overlap). Merge those before size-filtering so a fragmented
  // outline neither spawns phantom floors nor loses its small pieces.
  const nets = [...stats.values()].map((n) => ({ ...n, ids: new Set([n.id]) }));
  const margin = groupR;
  const intersects = (a, b) =>
    a.minX <= b.maxX + margin && b.minX <= a.maxX + margin &&
    a.minY <= b.maxY + margin && b.minY <= a.maxY + margin;
  for (let merged = true; merged;) {
    merged = false;
    for (let i = 0; i < nets.length && !merged; i += 1) {
      for (let j = i + 1; j < nets.length; j += 1) {
        if (!intersects(nets[i].bbox, nets[j].bbox)) continue;
        const a = nets[i];
        const b = nets[j];
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
  if (!nets.length) return [];
  const minSize = Math.max(200, 0.15 * nets[0].size);
  return nets
    .filter((n) => n.size >= minSize && bboxAreaOf(n.bbox) >= 0.01 * width * height)
    .slice(0, maxNetworks)
    .map((n) => {
      const mask = new Uint8Array(wallMask.length);
      for (let y = n.bbox.minY; y <= n.bbox.maxY; y += 1) {
        const row = y * width;
        for (let x = n.bbox.minX; x <= n.bbox.maxX; x += 1) {
          if (wallMask[row + x] && n.ids.has(labels[row + x])) mask[row + x] = 1;
        }
      }
      return { mask, bbox: n.bbox, wallSize: n.size };
    });
};

// Seal one isolated wall network. Window spans (including ticks/dashes inside
// them) are bridged colinearly across the whole network, then an escalating
// closing ladder handles what bridging cannot (window gaps wrapping corners).
// Leaks shrink the enclosed area, so the truly sealed footprint is the ladder
// entry with (near-)maximal enclosed area at the smallest radius — a greedy
// "first radius that looks sealed" accepts partial footprints when one wing
// of the floor seals before the rest.
const detectFloorNet = (net, width, height, wallThickness, options) => {
  const wallBboxArea = bboxAreaOf(net.bbox);
  const compW = net.bbox.maxX - net.bbox.minX + 1;
  const compH = net.bbox.maxY - net.bbox.minY + 1;
  const maxGap = Math.max(24, wallThickness * 12, Math.round(Math.max(compW, compH) * 0.3));
  const minFlank = Math.max(8, wallThickness * 2);
  const bridged = bridgeRuns(net.mask, width, height, maxGap, minFlank);

  const longest = Math.max(width, height);
  const maxRadius = options.maxCloseRadius ?? Math.max(32, Math.round(longest * 0.045));
  const radii = [];
  for (let r = 2; r < maxRadius; r = Math.round(r * 1.45) + 1) radii.push(r);
  radii.push(maxRadius);

  const tried = [];
  const measured = [];
  for (const r of radii) {
    const fp = measureFootprint(bridged, width, height, r);
    tried.push({ radius: r, area: fp?.totalEnclosed ?? 0 });
    if (!fp) continue;
    // Sanity: a footprint spanning far beyond the network means the closing
    // annexed something that is not this floor.
    if (bboxAreaOf(fp.largest.bbox) > 1.35 * wallBboxArea) break;
    measured.push(fp);
  }
  if (!measured.length) return null;

  const maxEnclosed = measured.reduce((best, fp) => Math.max(best, fp.totalEnclosed), 0);
  const pick = measured.find((fp) => fp.totalEnclosed >= 0.98 * maxEnclosed);

  // A never-sealing network (genuinely open side) still yields its walls plus
  // whatever they enclose; flag it so callers know the trace is best-effort.
  const largestFp = footprintEntry(pick, pick.largest, width);
  const usedFallback = !isSealed(largestFp, wallBboxArea);

  // Floors drawn touching (joined by a stray line) share one network but seal
  // into separate footprint components — keep every component of comparable
  // size, not just the largest.
  const minCompSize = Math.max(0.25 * pick.largest.size, 0.01 * width * height);
  const floorComps = pick.components
    .filter((c) => c.size >= minCompSize)
    .sort((a, b) => b.size - a.size)
    .map((c) => (c === pick.largest ? largestFp : footprintEntry(pick, c, width)));

  return { floorComps, usedFallback, tried, wallBbox: net.bbox, wallBboxArea };
};

export const traceBoundary = (analysis, options = {}) => {
  const { width, height, wallThickness } = analysis;
  const epsilon = options.simplifyEpsilon ?? Math.max(2, wallThickness * 0.35);
  const maxFloors = Math.max(1, Math.min(5, options.maxFloors ?? 5));

  // Multi-floor pages: split the wall mask into disconnected networks first,
  // then run the full seal search on each network in isolation. Bridging and
  // large closing radii are safe per network — there is no neighbouring floor
  // left in the mask to merge into.
  const nets = partitionWallNetworks(analysis.wallMask, width, height, wallThickness, maxFloors);
  const floors = [];
  const searches = [];

  for (const net of nets) {
    if (floors.length >= maxFloors) break;
    // A network sitting inside an already-traced footprint is interior
    // detail (stair block, island), not another floor.
    const cx = (net.bbox.minX + net.bbox.maxX) >> 1;
    const cy = (net.bbox.minY + net.bbox.maxY) >> 1;
    if (floors.some((f) => f.footprintMask[cy * width + cx])) continue;

    const detected = detectFloorNet(net, width, height, wallThickness, options);
    if (!detected) continue;
    searches.push(detected.tried);

    for (const footprint of detected.floorComps) {
      if (floors.length >= maxFloors) break;
      const floor = buildFloor(footprint, { ...analysis, wallMask: net.mask }, epsilon, options);
      if (floor) {
        floor.sealRadius = footprint.radius;
        floor.usedFallback = detected.usedFallback;
        floors.push(floor);
      }
    }
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
    excludedGarages: kept.reduce((sum, f) => sum + f.excludedGarages, 0),
    debug: {
      tried: searches[0],
      sealSearches: searches,
      wallBbox: nets[0].bbox,
      wallBboxArea: bboxAreaOf(nets[0].bbox),
    },
  };
};

export { polygonArea, polygonBounds };
