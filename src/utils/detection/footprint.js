// One sealed footprint component -> a floor: outer contour, non-GLA carving,
// interior voids as holes, and an interior envelope inset per edge by the wall
// that edge is actually drawn with.

import { bboxAreaOf, erodeRect, labelComponents, openRect } from './raster.js';
import {
  simplifyRing,
  fitRing,
  polygonArea,
  polygonSignedArea,
} from './polygon.js';
import { traceFramedBoundary } from './labelFrame.js';
import {
  collectNonGlaRegions,
  arbitrateRegions,
  applyRegions,
  componentMask,
  enclosedVoids,
  sealedCavities,
  refusedRegion,
} from './nonGla.js';
import { warning, bboxRing } from './scoring.js';

const largestComponent = (mask, width, height) => {
  const { labels, components } = labelComponents(mask, width, height);
  if (!components.length) return null;
  let best = components[0];
  for (const comp of components) {
    if (comp.size > best.size) best = comp;
  }
  return { labels, component: best };
};

// How much of a footprint a space nothing opens onto has to be before saying
// so is worth the reader's attention. The shape gate in `sealedCavities` rules
// out a wing of rooms; this rules out the small ones the shape gate cannot,
// because a door swing seals a bathroom in the structural mask as surely as a
// wall does and a sealed bathroom is exactly square against its box. Measured
// across the nine fixtures: at the 0.4% a carved void is kept at, one
// fine-lined plan raises fourteen of these; at 5% all nine raise none, and the
// synthetic courtyard (13.8%) and the garage bay whose door was drawn too
// thick to read as a door (25%) both still land.
const MIN_SEALED_CAVITY = 0.05;

// Whether the carve is what opened this void — a courtyard the exclusion
// removed — or whether it was already there, which the carve cannot explain
// and the user has to be told about.
const voidWasCarved = (cavity, removed, width) => {
  const { labels, componentId, bbox } = cavity;
  let inside = 0;
  for (let y = bbox.minY; y <= bbox.maxY; y += 1) {
    const row = y * width;
    for (let x = bbox.minX; x <= bbox.maxX; x += 1) {
      if (labels[row + x] === componentId && removed[row + x]) inside += 1;
    }
  }
  return inside >= 0.5 * cavity.size;
};

// Does `outer` account for most of `inner`? Bboxes, because the more specific
// warning already carries the shape — this only decides which one speaks.
const bboxCovers = (outer, inner) => {
  const w = Math.min(outer.maxX, inner.maxX) - Math.max(outer.minX, inner.minX) + 1;
  const h = Math.min(outer.maxY, inner.maxY) - Math.max(outer.minY, inner.minY) + 1;
  if (w <= 0 || h <= 0) return false;
  return w * h >= 0.5 * bboxAreaOf(inner);
};

// `carrier` is anything holding `{labels, frame, componentId}` — the footprint
// entry's labels live in their own crop (labelFrame.js), everything else here
// labels a page-sized mask and carries no frame.
const polygonize = (carrier, width, height, epsilon, fitOptions) => {
  const ring = traceFramedBoundary(carrier, width, height);
  if (ring.length < 3) return null;
  const simplified = simplifyRing(ring, epsilon);
  if (simplified.length < 3) return null;
  const fitted = fitRing(simplified, fitOptions);
  if (!fitted.polygon || fitted.polygon.length < 3) return null;
  // `skewDeg` is what was measured; `deskewed` says whether the fit acted on
  // it. A ring past the de-skew ceiling is squashed onto the page's own axes,
  // which silently shrinks a rotated plan's footprint — so the pair travels up
  // to `quality` where the user can be told the plan is not square.
  return {
    polygon: fitted.polygon,
    ring,
    skew: fitted.skew,
    skewDeg: fitted.skewDeg,
    deskewed: fitted.deskewed,
  };
};

// March inward from footprint boundary pixels and measure the depth of the
// initial wall band. Gaps up to `gapTol` (double-line wall cavities) count as
// wall; a longer free run ends the band.
const measureBandDepth = (x0, y0, dir, wallMask, width, height, gapTol, maxDepth) => {
  let lastWall = -1;
  let freeRun = 0;
  let sawWall = false;
  for (let step = 0; step <= maxDepth; step += 1) {
    const x = Math.round(x0 + dir[0] * step);
    const y = Math.round(y0 + dir[1] * step);
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
  return sawWall && lastWall >= 0 ? lastWall + 1 : -1;
};

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
    const depth = measureBandDepth(p.x, p.y, dir, wallMask, width, height, gapTol, maxDepth);
    if (depth > 0) samples.push(depth);
  }

  if (samples.length < 8) return Math.max(2, strokeThickness);
  samples.sort((a, b) => a - b);
  return samples[(samples.length / 2) | 0];
};

// Inward unit normal of edge i, from the ring's winding. Probing the mask a
// couple of pixels either side cannot decide this reliably: the fitted edge
// sits a pixel or two inside the wall band, so both probes land on wall.
const inwardNormals = (polygon) => {
  const sign = polygonSignedArea(polygon) >= 0 ? 1 : -1;
  return polygon.map((a, i) => {
    const b = polygon[(i + 1) % polygon.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return { nx: 0, ny: 0, len: 0, dx: 0, dy: 0 };
    return { nx: (sign * -dy) / len, ny: (sign * dx) / len, len, dx, dy };
  });
};

// Wall depth behind each polygon edge. One global scalar insets a 4px side
// wall by an 18px measurement taken on the thick front wall; per-edge depth is
// the same measurement, kept per edge.
const measureEdgeInsets = (polygon, normals, wallMask, width, height, strokeThickness, fallback) => {
  const gapTol = Math.max(4, strokeThickness * 2);
  const maxDepth = Math.max(12, strokeThickness * 6) + gapTol;
  return polygon.map((a, i) => {
    const { nx, ny, len, dx, dy } = normals[i];
    if (len < 2) return { inset: fallback, samples: 0 };
    const samples = [];
    const count = Math.max(3, Math.min(48, Math.round(len / 6)));
    // Skip the ends: near a corner the march runs along the perpendicular wall
    // and measures its length, not this wall's depth.
    const margin = Math.min(0.25, Math.max(2, strokeThickness) / Math.max(1, len));
    for (let s = 0; s < count; s += 1) {
      const t = margin + ((s + 0.5) / count) * (1 - 2 * margin);
      const px = a.x + dx * t;
      const py = a.y + dy * t;
      const depth = measureBandDepth(px, py, [nx, ny], wallMask, width, height, gapTol, maxDepth);
      if (depth > 0) samples.push(depth);
    }
    if (samples.length < 3) return { inset: fallback, samples: samples.length };
    samples.sort((p, q) => p - q);
    return { inset: samples[(samples.length / 2) | 0], samples: samples.length };
  });
};

const intersect = (p1, d1, p2, d2, fallback) => {
  const denom = d1.x * d2.y - d1.y * d2.x;
  if (Math.abs(denom) < 1e-9) return fallback;
  const t = ((p2.x - p1.x) * d2.y - (p2.y - p1.y) * d2.x) / denom;
  return { x: p1.x + t * d1.x, y: p1.y + t * d1.y };
};

// Offset every edge inward by its own measured inset and re-intersect.
const offsetPolygon = (polygon, insets, normals, sign = 1) => {
  const n = polygon.length;
  const lines = [];
  for (let i = 0; i < n; i += 1) {
    const a = polygon[i];
    const { nx, ny, len, dx, dy } = normals[i];
    if (len < 1e-6) return null;
    const inset = insets[i].inset * sign;
    lines.push({
      p: { x: a.x + nx * inset, y: a.y + ny * inset },
      d: { x: dx / len, y: dy / len },
      fallback: { x: a.x + nx * inset, y: a.y + ny * inset },
    });
  }
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const prev = lines[(i + n - 1) % n];
    const curr = lines[i];
    out.push(intersect(prev.p, prev.d, curr.p, curr.d, curr.fallback));
  }
  // Drop collapsed vertices produced where an inset exceeded a short edge.
  const cleaned = [];
  for (const p of out) {
    const last = cleaned[cleaned.length - 1];
    if (last && Math.abs(last.x - p.x) < 0.5 && Math.abs(last.y - p.y) < 0.5) continue;
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
    cleaned.push(p);
  }
  return cleaned.length >= 3 ? cleaned : null;
};

/**
 * @returns floor entry with outer/inner polygons, holes, non-GLA regions and
 *   the measurements the scorer and the UI need to explain the result.
 */
export const buildFloor = (initialFootprint, analysis, epsilon, options) => {
  const { wallMask, width, height, wallThickness } = analysis;
  // Spread once: the entry's `mask` is a getter that rebuilds a page-sized
  // array on every read (see footprintEntry), and everything below reads it
  // repeatedly. This is the one place that wants it materialised.
  let footprint = { ...initialFootprint };
  let outerResult = polygonize(footprint, width, height, epsilon, options.fit);
  if (!outerResult) return null;

  let exteriorThickness = sampleExteriorThickness(
    outerResult.ring, wallMask, footprint.mask, width, height, wallThickness,
  );

  // Shave wall-band filaments. An attached-but-unenclosed structure (a porch
  // whose interior leaks to the outside, decorative pillar posts) leaves its
  // wall band welded to the footprint as a zero-area excursion, so the outer
  // contour appears to wrap a region contributing nothing. A filament by
  // definition carries almost no area, so the guard is tight: permitting a 15%
  // loss let this step quietly amputate a real wing whenever the winning
  // footprint had a narrow neck.
  let filamentShaved = false;
  {
    const shaveR = Math.max(2, Math.round(exteriorThickness * 0.75));
    const shaved = openRect(footprint.mask, width, height, shaveR);
    const kept = largestComponent(shaved, width, height);
    if (kept && kept.component.size >= 0.97 * footprint.area
        && kept.component.size < footprint.area) {
      const candidate = {
        ...footprint,
        mask: componentMask(kept.labels, kept.component, width),
        labels: kept.labels,
        // Page-sized labels from `largestComponent`, so no crop frame.
        frame: null,
        componentId: kept.component.id,
        area: kept.component.size,
        bbox: kept.component.bbox,
        bboxArea: bboxAreaOf(kept.component.bbox),
      };
      const reOuter = polygonize(candidate, width, height, epsilon, options.fit);
      if (reOuter) {
        footprint = candidate;
        outerResult = reOuter;
        filamentShaved = true;
        exteriorThickness = sampleExteriorThickness(
          outerResult.ring, wallMask, footprint.mask, width, height, wallThickness,
        );
      }
    }
  }

  // Non-GLA regions are removed after the seal so the trace covers living area
  // only. Every detector contributes candidates; one arbitration step decides.
  let excludedRegions = [];
  let rejectedRegions = [];
  let nearMissRegions = [];
  let removed = null;
  // The building as it stood before the carve, so "0.4% of the footprint" and
  // "5% of the footprint" mean the same fraction of the same thing whether or
  // not a garage came off it first.
  const preCarveArea = footprint.area;
  if (options.excludeRegions?.length || options.autoGarage !== false
      || options.autoShaded !== false) {
    const collected = collectNonGlaRegions(footprint, analysis, {
      ...options,
      exteriorThickness,
      wallMask,
    });
    nearMissRegions = collected.nearMisses;
    const arbitrated = arbitrateRegions(collected.regions);
    if (arbitrated.length) {
      const applied = applyRegions(footprint, arbitrated, analysis, {
        ...options,
        exteriorThickness,
      });
      rejectedRegions = applied.rejected;
      const carvedOuter = applied.accepted.length
        ? polygonize(applied.footprint, width, height, epsilon, options.fit)
        : null;
      if (carvedOuter) {
        footprint = applied.footprint;
        outerResult = carvedOuter;
        excludedRegions = applied.accepted;
        removed = applied.removed;
        exteriorThickness = sampleExteriorThickness(
          outerResult.ring, wallMask, footprint.mask, width, height, wallThickness,
        );
      } else if (applied.accepted.length) {
        // The carve left a footprint with no traceable ring, so it was
        // abandoned — which keeps the area rather than removing it, and is
        // therefore a refusal like any other.
        rejectedRegions = [
          ...rejectedRegions,
          ...applied.accepted.map((r) => refusedRegion(r, 'untraceable')),
        ];
      }
    }
  }

  const carveWarnings = [];
  const anchorOf = (bbox) => ({ kind: 'ring', rings: [bboxRing(bbox)] });
  // Stated, never counted: `area-excluded` is the detector working, and its
  // severity keeps it out of the "things to check" count. The number is here
  // rather than only in a toast because it is the largest discretionary
  // subtraction the app makes.
  for (const region of excludedRegions) {
    carveWarnings.push(warning('area-excluded', {
      keyword: region.keyword ?? null,
      sources: region.sources ?? [region.source],
      areaPx: region.size,
      // Scale-free, and the number that actually answers "how much of my
      // building did it take out". Nothing under `detection/` knows px per
      // foot, so a square-footage figure here could only ever have been wrong.
      shareOfFootprint: preCarveArea > 0 ? region.size / preCarveArea : 0,
      bbox: region.bbox,
    }, 'info', anchorOf(region.bbox)));
  }
  // A near-miss the carve already settled says nothing: the garage detector
  // doubts a cavity another source carved, and "not removed" printed beside
  // the `area-excluded` that removed it is a contradiction, in the count of
  // things to check.
  const settled = [...excludedRegions, ...rejectedRegions].map((r) => r.bbox);
  nearMissRegions = nearMissRegions.filter(
    (miss) => !settled.some((bbox) => bboxCovers(bbox, miss.bbox)),
  );
  for (const region of [...rejectedRegions, ...nearMissRegions]) {
    carveWarnings.push(warning('non-gla-not-removed', {
      keyword: region.keyword ?? null,
      sources: region.sources ?? [region.source],
      reason: region.reason,
      areaPx: region.size,
      bbox: region.bbox,
    }, 'warn', anchorOf(region.bbox)));
  }

  // Voids and sealed cavities are enumerated whether or not anything was
  // carved. A void only ever became a hole as a by-product of an accepted
  // carve, so a courtyard on a plan with no garage was counted as living area
  // in full — 16.5% over on the synthetic courtyard, at 0.98 confidence.
  const minVoid = 0.004 * preCarveArea;
  const holeSources = [];
  const stated = [...excludedRegions, ...rejectedRegions, ...nearMissRegions].map((r) => r.bbox);
  for (const cavity of enclosedVoids(footprint.mask, width, height, minVoid)) {
    if (removed && voidWasCarved(cavity, removed, width)) {
      holeSources.push(cavity);
      continue;
    }
    stated.push(cavity.bbox);
    carveWarnings.push(warning('enclosed-void', {
      areaPx: cavity.size, bbox: cavity.bbox,
    }, 'warn', anchorOf(cavity.bbox)));
  }
  // Not subtracted, only shown: geometry cannot tell a courtyard from a room
  // nothing opens onto, and removing the second deletes floor the plan has.
  // The user has a void tool; what they lacked was any sign there was
  // something to point it at.
  const wallish = analysis.thickMask ?? wallMask;
  const minSealed = MIN_SEALED_CAVITY * preCarveArea;
  for (const cavity of sealedCavities(footprint.mask, wallish, width, height, minSealed)) {
    if (stated.some((bbox) => bboxCovers(bbox, cavity.bbox))) continue;
    carveWarnings.push(warning('enclosed-void', {
      areaPx: cavity.size, bbox: cavity.bbox,
    }, 'warn', anchorOf(cavity.bbox)));
  }

  const holes = [];
  for (const hole of holeSources) {
    const shape = polygonize(hole, width, height, epsilon, options.fit);
    if (shape && polygonArea(shape.polygon) > 0) holes.push(shape.polygon);
  }

  // Interior envelope: inset each edge by the wall measured behind that edge,
  // falling back to a uniform erosion when the offset degenerates.
  let innerPolygon = null;
  const normals = inwardNormals(outerResult.polygon);
  const insets = measureEdgeInsets(
    outerResult.polygon, normals, wallMask, width, height, wallThickness, exteriorThickness,
  );
  const offset = offsetPolygon(outerResult.polygon, insets, normals);
  const outerArea = polygonArea(outerResult.polygon);
  if (offset) {
    const area = polygonArea(offset);
    const sameWinding = Math.sign(polygonSignedArea(offset)) === Math.sign(polygonSignedArea(outerResult.polygon));
    if (sameWinding && area > 0.4 * outerArea && area < outerArea) innerPolygon = offset;
  }
  if (!innerPolygon) {
    const eroded = erodeRect(footprint.mask, width, height, exteriorThickness);
    const innerComp = largestComponent(eroded, width, height);
    if (innerComp && innerComp.component.size > 0.2 * footprint.area) {
      const innerResult = polygonize(
        { labels: innerComp.labels, frame: null, componentId: innerComp.component.id },
        width, height, epsilon, options.fit,
      );
      if (innerResult && polygonArea(innerResult.polygon) > 0) {
        innerPolygon = innerResult.polygon;
      }
    }
  }

  // A hole's interior face is on the other side of its wall, so the ring grows
  // outward while the building's outline shrinks.
  const innerHoles = holes.length && innerPolygon
    ? holes.map((hole) => {
      const holeNormals = inwardNormals(hole);
      const holeInsets = hole.map(() => ({ inset: exteriorThickness, samples: 0 }));
      return offsetPolygon(hole, holeInsets, holeNormals, -1) ?? hole;
    })
    : [];

  return {
    outerPolygon: outerResult.polygon,
    innerPolygon,
    holes,
    innerHoles,
    skew: outerResult.skew,
    skewDeg: outerResult.skewDeg,
    deskewed: outerResult.deskewed,
    footprintMask: footprint.mask,
    footprintArea: footprint.area,
    footprintBbox: footprint.bbox,
    exteriorThickness,
    filamentShaved,
    excludedRegions,
    // Every region the carve examined and declined, near-misses included, and
    // the warnings that say so. `carveWarnings` and not `warnings` because
    // assembleFloors assigns the search's own list over that field after this
    // returns; it merges these in.
    rejectedRegions: [...rejectedRegions, ...nearMissRegions],
    carveWarnings,
    excluded: excludedRegions.length,
    excludedGarages: excludedRegions.filter((r) => r.keyword && /garage/i.test(r.keyword)).length,
  };
};
