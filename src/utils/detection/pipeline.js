import { normalizeImageData, mapPointToNormalized } from './preprocess';
import { estimateDominantOrientations } from './orientation';
import { prepareWallMask, closeMask, erode, dilate } from './wallMask';
import {
  labelConnectedComponents,
  componentToPolygon,
  polygonToBounds,
  mapPolygonFromNormalized,
} from './vectorize';

const invertMask = (mask) => {
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i += 1) {
    out[i] = mask[i] ? 0 : 1;
  }
  return out;
};

const floodFillFromEdges = (wallMask, width, height) => {
  const visited = new Uint8Array(width * height);
  const queue = [];

  const tryEnqueue = (idx) => {
    if (!visited[idx] && !wallMask[idx]) {
      visited[idx] = 1;
      queue.push(idx);
    }
  };

  for (let x = 0; x < width; x += 1) {
    tryEnqueue(x);
    tryEnqueue((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    tryEnqueue(y * width);
    tryEnqueue(y * width + width - 1);
  }

  let head = 0;
  while (head < queue.length) {
    const idx = queue[head];
    head += 1;
    const x = idx % width;
    const y = Math.floor(idx / width);
    if (x + 1 < width) tryEnqueue(idx + 1);
    if (x - 1 >= 0) tryEnqueue(idx - 1);
    if (y + 1 < height) tryEnqueue(idx + width);
    if (y - 1 >= 0) tryEnqueue(idx - width);
  }

  return visited;
};

const getFloorplanFootprint = (wallMask, width, height) => {
  const exterior = floodFillFromEdges(wallMask, width, height);
  const footprint = new Uint8Array(width * height);
  for (let i = 0; i < footprint.length; i += 1) {
    footprint[i] = exterior[i] ? 0 : 1;
  }
  return footprint;
};

const pointInBounds = (point, width, height) => point.x >= 0 && point.y >= 0 && point.x < width && point.y < height;

const normalizedRoomResult = (polygon, preprocessResult, confidence, debug = {}) => {
  const mapped = mapPolygonFromNormalized(polygon, preprocessResult.scale);
  const bounds = polygonToBounds(mapped);
  if (!bounds) return null;

  return {
    polygon: mapped,
    overlay: {
      x1: bounds.minX,
      y1: bounds.minY,
      x2: bounds.maxX,
      y2: bounds.maxY,
    },
    confidence,
    debug,
  };
};

/* ---------- Room Detection (Problem 1) ----------
 * Expand from click point outward to find the enclosing room walls.
 * Uses aggressive morphological closing to bridge door-sized gaps,
 * then flood-fills from the click point and returns the axis-aligned
 * bounding box of the filled region.  If the click lands on a wall
 * pixel, we search nearby for a free-space seed.
 */

const findFreeSpaceSeed = (freeMask, cx, cy, width, height, maxRadius = 30) => {
  if (freeMask[cy * width + cx]) return { x: cx, y: cy };

  const tryPixel = (px, py) => {
    if (px >= 0 && py >= 0 && px < width && py < height && freeMask[py * width + px]) {
      return { x: px, y: py };
    }
    return null;
  };

  // Search the perimeter of expanding squares around the click point.
  for (let r = 1; r <= maxRadius; r += 1) {
    // Top and bottom edges of the square
    for (let dx = -r; dx <= r; dx += 1) {
      const hit = tryPixel(cx + dx, cy - r) ?? tryPixel(cx + dx, cy + r);
      if (hit) return hit;
    }
    // Left and right edges (excluding corners already checked)
    for (let dy = -r + 1; dy < r; dy += 1) {
      const hit = tryPixel(cx - r, cy + dy) ?? tryPixel(cx + r, cy + dy);
      if (hit) return hit;
    }
  }
  return null;
};

const floodFillBoundingBox = (freeMask, startX, startY, width, height) => {
  const visited = new Uint8Array(width * height);
  const startIdx = startY * width + startX;
  visited[startIdx] = 1;
  const queue = [startIdx];
  let minX = startX;
  let maxX = startX;
  let minY = startY;
  let maxY = startY;
  let head = 0;

  while (head < queue.length) {
    const idx = queue[head];
    head += 1;
    const x = idx % width;
    const y = Math.floor(idx / width);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;

    const enqueue = (nIdx) => {
      if (!visited[nIdx] && freeMask[nIdx]) { visited[nIdx] = 1; queue.push(nIdx); }
    };
    if (x + 1 < width) enqueue(idx + 1);
    if (x - 1 >= 0) enqueue(idx - 1);
    if (y + 1 < height) enqueue(idx + width);
    if (y - 1 >= 0) enqueue(idx - width);
  }

  return { minX, minY, maxX, maxY, size: queue.length };
};

export const detectRoomFromClickCore = (imageData, clickPoint, options = {}) => {
  const preprocess = normalizeImageData(imageData, options.preprocess);
  const orientation = estimateDominantOrientations(preprocess.gray, preprocess.width, preprocess.height, options.orientation);

  // Use aggressive morphological closing to bridge door-sized gaps.
  const roomCloseRadius = options.roomCloseRadius ?? 4;
  const roomWallMask = closeMask(
    preprocess.wallMask,
    preprocess.width,
    preprocess.height,
    roomCloseRadius,
  );
  const freeMask = invertMask(roomWallMask);

  const nPoint = mapPointToNormalized(clickPoint, preprocess.scale);
  const clampedPoint = {
    x: Math.max(0, Math.min(preprocess.width - 1, nPoint.x)),
    y: Math.max(0, Math.min(preprocess.height - 1, nPoint.y)),
  };

  // Find a free-space seed near the click point (handles clicks on wall/text).
  const seed = findFreeSpaceSeed(freeMask, clampedPoint.x, clampedPoint.y, preprocess.width, preprocess.height);
  if (!seed) return null;

  // Flood-fill from the seed to find the enclosed room region.
  const region = floodFillBoundingBox(freeMask, seed.x, seed.y, preprocess.width, preprocess.height);

  // Sanity-check: reject regions that are unreasonably large (>60% of image)
  // or tiny (<0.5% of image) — likely a detection failure.
  const imageArea = preprocess.width * preprocess.height;
  const regionArea = (region.maxX - region.minX + 1) * (region.maxY - region.minY + 1);
  if (regionArea > imageArea * 0.6 || regionArea < imageArea * 0.005) {
    // Fall back to the original connected-component approach with default wall mask.
    const fallbackMask = prepareWallMask(preprocess.wallMask, preprocess.width, preprocess.height, options.wallMask);
    const fallbackFree = invertMask(fallbackMask);
    const labeled = labelConnectedComponents(fallbackFree, preprocess.width, preprocess.height, 1);
    if (!labeled.components.length) return null;

    const pointIndex = clampedPoint.y * preprocess.width + clampedPoint.x;
    let targetId = labeled.labels[pointIndex];
    if (targetId < 0) {
      const cands = labeled.components.filter((c) => (c.bbox.maxX - c.bbox.minX + 1) * (c.bbox.maxY - c.bbox.minY + 1) > 400).sort((a, b) => b.size - a.size);
      targetId = cands[0]?.id ?? -1;
    }
    if (targetId < 0) return null;

    let polygon = componentToPolygon(labeled.labels, preprocess.width, preprocess.height, targetId, {
      simplifyEpsilon: options.simplifyEpsilon ?? 2.2,
      angleBins: orientation.dominant,
    });
    if (!polygon.length) return null;
    if (polygon.length < 4) {
      polygon = componentToPolygon(labeled.labels, preprocess.width, preprocess.height, targetId, { simplifyEpsilon: 1.1, angleBins: orientation.dominant });
    }

    const sel = labeled.components.find((c) => c.id === targetId);
    const conf = Math.max(0.2, Math.min(0.98, sel ? sel.size / (imageArea * 0.2) : 0.2));
    return normalizedRoomResult(polygon, preprocess, conf, {
      normalizedSize: { width: preprocess.width, height: preprocess.height },
      dominantAngles: orientation.dominant,
      componentSize: sel?.size ?? 0,
    });
  }

  // Build axis-aligned rectangle polygon from bounding box (rooms are always rectangular).
  const polygon = [
    { x: region.minX, y: region.minY },
    { x: region.maxX, y: region.minY },
    { x: region.maxX, y: region.maxY },
    { x: region.minX, y: region.maxY },
  ];

  const confidenceBase = Math.min(1, region.size / (imageArea * 0.2));
  const confidence = Math.max(0.2, Math.min(0.98, confidenceBase));

  return normalizedRoomResult(polygon, preprocess, confidence, {
    normalizedSize: { width: preprocess.width, height: preprocess.height },
    dominantAngles: orientation.dominant,
    componentSize: region.size,
  });
};

const getLargestComponentPolygon = (mask, preprocess, orientation, options) => {
  const labels = labelConnectedComponents(mask, preprocess.width, preprocess.height, 1);
  if (!labels.components.length) return null;
  const component = labels.components.sort((a, b) => b.size - a.size)[0];
  if (!component) return null;
  const polygon = componentToPolygon(labels.labels, preprocess.width, preprocess.height, component.id, {
    simplifyEpsilon: options.simplifyEpsilon ?? 2.5,
    angleBins: orientation.dominant,
  });
  if (!polygon.length) return null;
  return { polygon, component };
};

/* ---------- Exterior Wall Tracing (Problem 2) ----------
 * Robust exterior boundary detection using:
 *   1. Connected component analysis to remove noise (text, logos)
 *   2. Line detection (H/V run-length) to identify structural walls
 *   3. Colinear segment merging for continuous wall lines
 *   4. Flood-fill footprint extraction and polygon construction
 *
 * This algorithm does NOT rely on "first black pixel from edge" logic.
 * It explicitly filters small components (text) and non-linear shapes
 * (logos), then prioritizes long continuous lines as wall candidates.
 */

/**
 * Step 1 — Connected component filtering.
 * Identify all connected groups of wall pixels and remove:
 *  • Text: small, fragmented clusters (area < 0.2% of image)
 *  • Small non-structural shapes: components that don't span at least
 *    8% of the shorter dimension in either direction
 *  • Logos: compact, solid shapes (low aspect ratio + high solidity)
 * Keep only components likely to be structural walls.
 */
const filterComponentsByStructure = (wallMask, width, height) => {
  const labeled = labelConnectedComponents(wallMask, width, height, 1);
  const { components, labels } = labeled;
  if (!components.length) return wallMask;

  const imageArea = width * height;
  const minDim = Math.min(width, height);
  const minArea = imageArea * 0.002;
  const minSpan = minDim * 0.08;

  const keptIds = new Set();

  for (const comp of components) {
    const bboxW = comp.bbox.maxX - comp.bbox.minX + 1;
    const bboxH = comp.bbox.maxY - comp.bbox.minY + 1;

    // Remove small fragments (text, stray dots).
    if (comp.size < minArea) continue;

    // Remove compact components that span very little in both dimensions.
    if (bboxW < minSpan && bboxH < minSpan) continue;

    // Remove compact solid shapes (logos): low aspect ratio + high fill
    // ratio while still small relative to image.
    const aspect = Math.max(bboxW, bboxH) / Math.max(1, Math.min(bboxW, bboxH));
    const solidity = comp.size / (bboxW * bboxH);
    if (aspect < 2.0 && solidity > 0.4 && comp.size < imageArea * 0.03) continue;

    keptIds.add(comp.id);
  }

  // Safety: always keep the largest component.
  if (keptIds.size === 0 && components.length > 0) {
    keptIds.add(components.reduce((a, b) => (a.size > b.size ? a : b)).id);
  }

  const out = new Uint8Array(width * height);
  for (let i = 0; i < labels.length; i += 1) {
    if (keptIds.has(labels[i])) out[i] = 1;
  }
  return out;
};

/**
 * Step 2 — Keep only the single largest connected component.
 * After CC filtering, the remaining mask may still contain multiple
 * disconnected groups.  The largest one is the main wall structure.
 */
const keepLargestComponent = (mask, width, height) => {
  const labeled = labelConnectedComponents(mask, width, height, 1);
  const { components, labels } = labeled;
  if (!components.length) return mask;

  const largest = components.reduce((a, b) => (a.size > b.size ? a : b));
  const out = new Uint8Array(width * height);
  for (let i = 0; i < labels.length; i += 1) {
    if (labels[i] === largest.id) out[i] = 1;
  }
  return out;
};

/**
 * Step 3 — Detect long horizontal and vertical line segments.
 * Scans every row (horizontal) and every column (vertical) of the mask,
 * keeping only segments whose length ≥ minLen.  Small gaps (≤ gapTol px)
 * within a segment are tolerated so that door openings and minor breaks
 * do not split a wall into sub-threshold pieces.
 */
const detectAllLongSegments = (mask, width, height, minLen, gapTol) => {
  const hSegments = [];
  const vSegments = [];

  // Horizontal: scan each row.
  for (let y = 0; y < height; y += 1) {
    let segStart = -1;
    let gapRun = 0;
    for (let x = 0; x < width; x += 1) {
      if (mask[y * width + x]) {
        if (segStart < 0) segStart = x;
        gapRun = 0;
      } else if (segStart >= 0) {
        gapRun += 1;
        if (gapRun > gapTol) {
          const segEnd = x - gapRun;
          if (segEnd - segStart + 1 >= minLen) {
            hSegments.push({ y, start: segStart, end: segEnd });
          }
          segStart = -1;
          gapRun = 0;
        }
      }
    }
    if (segStart >= 0) {
      const segEnd = width - 1 - gapRun;
      if (segEnd - segStart + 1 >= minLen) {
        hSegments.push({ y, start: segStart, end: segEnd });
      }
    }
  }

  // Vertical: scan each column.
  for (let x = 0; x < width; x += 1) {
    let segStart = -1;
    let gapRun = 0;
    for (let y = 0; y < height; y += 1) {
      if (mask[y * width + x]) {
        if (segStart < 0) segStart = y;
        gapRun = 0;
      } else if (segStart >= 0) {
        gapRun += 1;
        if (gapRun > gapTol) {
          const segEnd = y - gapRun;
          if (segEnd - segStart + 1 >= minLen) {
            vSegments.push({ x, start: segStart, end: segEnd });
          }
          segStart = -1;
          gapRun = 0;
        }
      }
    }
    if (segStart >= 0) {
      const segEnd = height - 1 - gapRun;
      if (segEnd - segStart + 1 >= minLen) {
        vSegments.push({ x, start: segStart, end: segEnd });
      }
    }
  }

  return { hSegments, vSegments };
};

/**
 * Step 4 — Merge colinear and nearby segments.
 * For horizontal segments on the same row, merge overlapping or
 * nearly-touching ranges.  Analogous for vertical segments on the
 * same column.  `fixedKey` is 'y' for horizontal, 'x' for vertical.
 */
const mergeSegmentList = (segments, fixedKey, gapTol) => {
  if (!segments.length) return [];
  const sorted = [...segments].sort(
    (a, b) => a[fixedKey] - b[fixedKey] || a.start - b.start,
  );
  const merged = [];
  let cur = { ...sorted[0] };

  for (let i = 1; i < sorted.length; i += 1) {
    const seg = sorted[i];
    if (seg[fixedKey] === cur[fixedKey] && seg.start <= cur.end + gapTol + 1) {
      cur.end = Math.max(cur.end, seg.end);
    } else {
      merged.push(cur);
      cur = { ...seg };
    }
  }
  merged.push(cur);
  return merged;
};

/**
 * Step 5 — Render detected segments back into a binary mask.
 * Each segment is drawn with the given half-thickness so that the
 * resulting lines form a solid barrier for the flood-fill step.
 */
const buildSegmentMask = (hSegments, vSegments, width, height, halfThickness) => {
  const mask = new Uint8Array(width * height);

  for (const seg of hSegments) {
    for (let dy = -halfThickness; dy <= halfThickness; dy += 1) {
      const py = seg.y + dy;
      if (py < 0 || py >= height) continue;
      for (let x = seg.start; x <= seg.end; x += 1) {
        mask[py * width + x] = 1;
      }
    }
  }

  for (const seg of vSegments) {
    for (let dx = -halfThickness; dx <= halfThickness; dx += 1) {
      const px = seg.x + dx;
      if (px < 0 || px >= width) continue;
      for (let y = seg.start; y <= seg.end; y += 1) {
        mask[y * width + px] = 1;
      }
    }
  }

  return mask;
};
/**
 * Step 6 — Build footprint by filling between extreme wall positions.
 * For each row, fill from the leftmost to the rightmost wall pixel.
 * For each column, fill from the topmost to the bottommost wall pixel.
 * Intersect both fills to preserve concavities (e.g. L-shapes).
 * Unlike flood-fill, this is not affected by interior door openings.
 */
const buildFillBetweenFootprint = (mask, width, height, minSpan) => {
  const rowFill = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    let first = -1;
    let last = -1;
    for (let x = 0; x < width; x += 1) {
      if (mask[y * width + x]) {
        if (first < 0) first = x;
        last = x;
      }
    }
    if (first >= 0 && last - first > minSpan) {
      for (let x = first; x <= last; x += 1) {
        rowFill[y * width + x] = 1;
      }
    }
  }

  const colFill = new Uint8Array(width * height);
  for (let x = 0; x < width; x += 1) {
    let first = -1;
    let last = -1;
    for (let y = 0; y < height; y += 1) {
      if (mask[y * width + x]) {
        if (first < 0) first = y;
        last = y;
      }
    }
    if (first >= 0 && last - first > minSpan) {
      for (let y = first; y <= last; y += 1) {
        colFill[y * width + x] = 1;
      }
    }
  }

  const footprint = new Uint8Array(width * height);
  for (let i = 0; i < footprint.length; i += 1) {
    footprint[i] = rowFill[i] && colFill[i] ? 1 : 0;
  }
  return footprint;
};

export const traceFloorplanBoundaryCore = (imageData, options = {}) => {
  const preprocess = normalizeImageData(imageData, options.preprocess);
  const orientation = estimateDominantOrientations(
    preprocess.gray, preprocess.width, preprocess.height, options.orientation,
  );
  const baseWallMask = prepareWallMask(
    preprocess.wallMask, preprocess.width, preprocess.height, options.wallMask,
  );

  const w = preprocess.width;
  const h = preprocess.height;
  const gapTol = options.gapTolerance ?? 8;

  /* --- Step 1: Connected component filtering (remove text & logos) ---
   * Dilate before CC analysis so nearby wall segments connect across
   * small gaps (doors, line breaks).  A generous radius is used so that
   * fragmented exterior walls merge into sizeable components.
   * Filter removes small fragments (text) and compact solid shapes
   * (logos).  All remaining structural components are kept.             */
  const ccDilateRadius = options.ccDilateRadius ?? 5;
  const dilatedForCC = dilate(baseWallMask, w, h, ccDilateRadius);
  const filteredMask = filterComponentsByStructure(dilatedForCC, w, h);

  /* --- Step 2: Recover precise wall edges ---
   * filteredMask is dilated; intersect with the original (non-dilated)
   * base mask so that the line detection operates on true wall pixels.  */
  const preciseMask = new Uint8Array(w * h);
  for (let i = 0; i < preciseMask.length; i += 1) {
    preciseMask[i] = baseWallMask[i] && filteredMask[i] ? 1 : 0;
  }

  /* --- Step 3: Line detection — find long H/V segments ---
   * Run-length analysis on every row and column.  Only segments whose
   * length ≥ 15% of the shorter image dimension are kept (walls are
   * long continuous lines; text produces only short runs).              */
  const minSegLen = Math.max(
    Math.floor(Math.min(w, h) * (options.minSegmentPct ?? 0.15)),
    5,
  );
  const { hSegments, vSegments } = detectAllLongSegments(
    preciseMask, w, h, minSegLen, gapTol,
  );

  /* --- Step 4: Merge colinear / nearby segments ---                   */
  const mergedH = mergeSegmentList(hSegments, 'y', gapTol);
  const mergedV = mergeSegmentList(vSegments, 'x', gapTol);

  /* --- Step 5: Build structural mask from long segments ---
   * Draw the merged segments with a small thickness, then combine
   * with the original filtered wall pixels.  The segments provide
   * clean, continuous wall lines while the original pixels preserve
   * connectivity at corners and junctions.                              */
  const lineHalf = options.lineThickness ?? 2;
  const segmentMask = buildSegmentMask(mergedH, mergedV, w, h, lineHalf);

  // Union: structural segments + original filtered wall pixels.
  const combinedMask = new Uint8Array(w * h);
  for (let i = 0; i < combinedMask.length; i += 1) {
    combinedMask[i] = segmentMask[i] || preciseMask[i] ? 1 : 0;
  }

  /* --- Step 6: Build footprint by filling between wall extremes ---
   * For each row/column, fill between the leftmost/rightmost (or
   * topmost/bottommost) wall pixel.  Intersecting both fills preserves
   * concavities.  Unlike flood-fill, this is robust against interior
   * door openings that would otherwise leak.
   * Use the full base wall mask (not CC-filtered) so that thin
   * exterior wall fragments at the building edges are included.         */
  let footprint = buildFillBetweenFootprint(baseWallMask, w, h, gapTol);
  let usedStructuralPath = true;

  // Verify footprint is non-trivial.
  let fpSize = 0;
  for (let i = 0; i < footprint.length; i += 1) {
    if (footprint[i]) fpSize += 1;
  }

  if (fpSize < w * h * 0.02) {
    // Fallback: use the base wall mask with dilation + flood-fill.
    footprint = getFloorplanFootprint(
      dilate(baseWallMask, w, h, options.outerDilate ?? 2), w, h,
    );
    usedStructuralPath = false;
  }

  /* --- Step 7: Extract outer and inner boundary polygons ---
   * The largest connected component of the footprint gives the outer
   * boundary.  Eroding the footprint approximates the inner wall edge.  */
  const outerResult = getLargestComponentPolygon(
    footprint, preprocess, orientation, options,
  );
  const innerFootprint = erode(footprint, w, h, options.innerErode ?? 2);
  const innerResult = getLargestComponentPolygon(
    innerFootprint, preprocess, orientation, options,
  );

  if (!outerResult && !innerResult) return null;

  const outerPolygon = outerResult
    ? mapPolygonFromNormalized(outerResult.polygon, preprocess.scale) : null;
  const innerPolygon = innerResult
    ? mapPolygonFromNormalized(innerResult.polygon, preprocess.scale) : null;
  const outerBounds = outerPolygon ? polygonToBounds(outerPolygon) : null;
  const innerBounds = innerPolygon ? polygonToBounds(innerPolygon) : null;

  return {
    outer: outerPolygon ? {
      polygon: outerPolygon,
      overlay: {
        x1: outerBounds.minX,
        y1: outerBounds.minY,
        x2: outerBounds.maxX,
        y2: outerBounds.maxY,
      },
    } : null,
    inner: innerPolygon ? {
      polygon: innerPolygon,
      overlay: {
        x1: innerBounds.minX,
        y1: innerBounds.minY,
        x2: innerBounds.maxX,
        y2: innerBounds.maxY,
      },
    } : null,
    debug: {
      dominantAngles: orientation.dominant,
      normalizedSize: { width: w, height: h },
      hasOuter: Boolean(outerPolygon),
      hasInner: Boolean(innerPolygon),
      usedEdgeScan: usedStructuralPath,
    },
  };
};

export const boundaryByMode = (result, wallMode = 'inner') => {
  if (!result) return null;
  if (wallMode === 'outer') return result.outer ?? result.inner;
  return result.inner ?? result.outer;
};

export const isPointInsideNormalizedImage = (point, preprocess) => pointInBounds(point, preprocess.width, preprocess.height);
