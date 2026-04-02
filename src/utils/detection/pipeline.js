import { normalizeImageData, mapPointToNormalized } from './preprocess';
import { estimateDominantOrientations } from './orientation';
import { prepareWallMask, closeMask, erode } from './wallMask';
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
 * Edge-inward scanning algorithm:
 * 1. Filter wall mask to keep only long H/V/diagonal segments (noise removal)
 * 2. Build edge profiles by scanning inward from all four image edges
 * 3. Construct footprint from the intersection of edge profiles
 * 4. Extract polygon from footprint for area calculation
 *
 * This approach is simple and deterministic: exterior walls are the
 * longest continuous features, so short text/logo segments are filtered
 * out before profile construction.
 */

const findLongSegments = (wallMask, scanLine, length, isHorizontal, width, minLen, gapTolerance) => {
  const segments = [];
  let segStart = -1;
  let gapRun = 0;

  for (let i = 0; i < length; i += 1) {
    const idx = isHorizontal
      ? scanLine * width + i
      : i * width + scanLine;
    const isWall = wallMask[idx];

    if (isWall) {
      if (segStart < 0) segStart = i;
      gapRun = 0;
    } else if (segStart >= 0) {
      gapRun += 1;
      if (gapRun > gapTolerance) {
        const segEnd = i - gapRun;
        if (segEnd - segStart + 1 >= minLen) {
          segments.push({ start: segStart, end: segEnd });
        }
        segStart = -1;
        gapRun = 0;
      }
    }
  }

  if (segStart >= 0) {
    const segEnd = length - 1 - gapRun;
    if (segEnd - segStart + 1 >= minLen) {
      segments.push({ start: segStart, end: segEnd });
    }
  }

  return segments;
};

/**
 * Scan a single diagonal line through the wall mask and return long segments.
 * Walks from (startX, startY) stepping by (dx, dy) each iteration.
 */
const scanDiagonalLine = (wallMask, width, height, startX, startY, dx, dy, minLen, gapTol) => {
  const segments = [];
  let segStart = -1;
  let gapRun = 0;
  let x = startX;
  let y = startY;
  let i = 0;

  while (x >= 0 && x < width && y >= 0 && y < height) {
    const isWall = wallMask[y * width + x];
    if (isWall) {
      if (segStart < 0) segStart = i;
      gapRun = 0;
    } else if (segStart >= 0) {
      gapRun += 1;
      if (gapRun > gapTol) {
        const segEnd = i - gapRun;
        if (segEnd - segStart + 1 >= minLen) {
          segments.push({ start: segStart, end: segEnd });
        }
        segStart = -1;
        gapRun = 0;
      }
    }
    x += dx;
    y += dy;
    i += 1;
  }

  if (segStart >= 0) {
    const segEnd = i - 1 - gapRun;
    if (segEnd - segStart + 1 >= minLen) {
      segments.push({ start: segStart, end: segEnd });
    }
  }

  return segments;
};

/**
 * Filter wall mask to keep only pixels belonging to long horizontal
 * or vertical segments. Removes text, logos, and other short noise
 * while preserving the long exterior wall structures.
 */
const filterToLongSegments = (wallMask, width, height, minLen, gapTol) => {
  const filtered = new Uint8Array(width * height);
  let hSegCount = 0;
  let vSegCount = 0;

  for (let y = 0; y < height; y += 1) {
    const segs = findLongSegments(wallMask, y, width, true, width, minLen, gapTol);
    hSegCount += segs.length;
    for (const seg of segs) {
      for (let x = seg.start; x <= seg.end; x += 1) {
        filtered[y * width + x] = 1;
      }
    }
  }

  for (let x = 0; x < width; x += 1) {
    const segs = findLongSegments(wallMask, x, height, false, width, minLen, gapTol);
    vSegCount += segs.length;
    for (const seg of segs) {
      for (let sy = seg.start; sy <= seg.end; sy += 1) {
        filtered[sy * width + x] = 1;
      }
    }
  }

  return { filtered, hSegCount, vSegCount };
};

/**
 * Filter wall mask to keep only pixels belonging to long 45-degree
 * diagonal segments. Scans all diagonals in both directions (+1,+1)
 * and (-1,+1).
 */
const filterDiagonalSegments = (wallMask, width, height, minLen, gapTol) => {
  const filtered = new Uint8Array(width * height);
  let diagSegCount = 0;

  const markSegment = (sx, sy, ddx, ddy, seg) => {
    let mx = sx + ddx * seg.start;
    let my = sy + ddy * seg.start;
    for (let j = seg.start; j <= seg.end; j += 1) {
      if (mx >= 0 && mx < width && my >= 0 && my < height) {
        filtered[my * width + mx] = 1;
      }
      mx += ddx;
      my += ddy;
    }
  };

  // Down-right diagonals (+1, +1)
  for (let sx = 0; sx < width; sx += 1) {
    const segs = scanDiagonalLine(wallMask, width, height, sx, 0, 1, 1, minLen, gapTol);
    diagSegCount += segs.length;
    for (const seg of segs) markSegment(sx, 0, 1, 1, seg);
  }
  for (let sy = 1; sy < height; sy += 1) {
    const segs = scanDiagonalLine(wallMask, width, height, 0, sy, 1, 1, minLen, gapTol);
    diagSegCount += segs.length;
    for (const seg of segs) markSegment(0, sy, 1, 1, seg);
  }

  // Down-left diagonals (-1, +1)
  for (let sx = 0; sx < width; sx += 1) {
    const segs = scanDiagonalLine(wallMask, width, height, sx, 0, -1, 1, minLen, gapTol);
    diagSegCount += segs.length;
    for (const seg of segs) markSegment(sx, 0, -1, 1, seg);
  }
  for (let sy = 1; sy < height; sy += 1) {
    const segs = scanDiagonalLine(wallMask, width, height, width - 1, sy, -1, 1, minLen, gapTol);
    diagSegCount += segs.length;
    for (const seg of segs) markSegment(width - 1, sy, -1, 1, seg);
  }

  return { filtered, diagSegCount };
};

/**
 * Build edge profiles by scanning inward from each image edge.
 * For each coordinate on the perpendicular axis, records the position
 * of the first filtered wall pixel found when scanning inward.
 */
const buildEdgeProfiles = (filteredMask, width, height) => {
  const topProfile = new Int32Array(width).fill(height);
  const bottomProfile = new Int32Array(width).fill(-1);
  const leftProfile = new Int32Array(height).fill(width);
  const rightProfile = new Int32Array(height).fill(-1);

  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      if (filteredMask[y * width + x]) { topProfile[x] = y; break; }
    }
    for (let y = height - 1; y >= 0; y -= 1) {
      if (filteredMask[y * width + x]) { bottomProfile[x] = y; break; }
    }
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (filteredMask[y * width + x]) { leftProfile[y] = x; break; }
    }
    for (let x = width - 1; x >= 0; x -= 1) {
      if (filteredMask[y * width + x]) { rightProfile[y] = x; break; }
    }
  }

  return { topProfile, bottomProfile, leftProfile, rightProfile };
};

/**
 * Build a footprint mask from edge profiles. A pixel is inside the
 * footprint if it lies between the wall hits from all four directions.
 */
const buildFootprintFromProfiles = (profiles, width, height) => {
  const { topProfile, bottomProfile, leftProfile, rightProfile } = profiles;
  const footprint = new Uint8Array(width * height);

  for (let y = 0; y < height; y += 1) {
    if (leftProfile[y] >= width || rightProfile[y] < 0) continue;
    for (let x = 0; x < width; x += 1) {
      if (
        topProfile[x] < height
        && bottomProfile[x] >= 0
        && y >= topProfile[x]
        && y <= bottomProfile[x]
        && x >= leftProfile[y]
        && x <= rightProfile[y]
      ) {
        footprint[y * width + x] = 1;
      }
    }
  }

  return footprint;
};

export const traceFloorplanBoundaryCore = (imageData, options = {}) => {
  const preprocess = normalizeImageData(imageData, options.preprocess);
  const orientation = estimateDominantOrientations(preprocess.gray, preprocess.width, preprocess.height, options.orientation);
  const baseWallMask = prepareWallMask(preprocess.wallMask, preprocess.width, preprocess.height, options.wallMask);

  const w = preprocess.width;
  const h = preprocess.height;
  const minDim = Math.min(w, h);
  const minSegLenPct = options.minSegmentLengthPct ?? 0.15;
  const minSegLen = Math.max(1, Math.floor(minDim * minSegLenPct));
  const gapTol = options.gapTolerance ?? 8;

  // Step 1: Filter wall mask — keep only long H/V segments (removes text/logos).
  const { filtered: hvFiltered, hSegCount, vSegCount } = filterToLongSegments(
    baseWallMask, w, h, minSegLen, gapTol,
  );

  // Step 2: Detect long 45-degree diagonal segments.
  const { filtered: diagFiltered, diagSegCount } = filterDiagonalSegments(
    baseWallMask, w, h, minSegLen, gapTol,
  );

  // Combine H/V and diagonal filtered masks.
  const combinedFiltered = new Uint8Array(w * h);
  for (let i = 0; i < combinedFiltered.length; i += 1) {
    combinedFiltered[i] = hvFiltered[i] || diagFiltered[i] ? 1 : 0;
  }

  // Step 3: Build edge profiles by scanning inward from each image edge.
  const profiles = buildEdgeProfiles(combinedFiltered, w, h);

  // Step 4: Construct footprint from profiles.
  const footprint = buildFootprintFromProfiles(profiles, w, h);

  // Verify the footprint is non-trivial.
  let fpSize = 0;
  for (let i = 0; i < footprint.length; i += 1) {
    if (footprint[i]) fpSize += 1;
  }
  if (fpSize < w * h * 0.01) {
    return null;
  }

  // Step 5: Extract outer polygon from footprint.
  const outerResult = getLargestComponentPolygon(footprint, preprocess, orientation, options);

  // Inner boundary: erode the footprint inward to approximate the inner wall edge.
  const innerFootprint = erode(footprint, w, h, options.innerErode ?? 2);
  const innerResult = getLargestComponentPolygon(innerFootprint, preprocess, orientation, options);

  if (!outerResult && !innerResult) return null;

  const outerPolygon = outerResult ? mapPolygonFromNormalized(outerResult.polygon, preprocess.scale) : null;
  const innerPolygon = innerResult ? mapPolygonFromNormalized(innerResult.polygon, preprocess.scale) : null;
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
      algorithm: 'edge-inward-scanning',
      thresholds: {
        minSegmentLength: minSegLen,
        minSegmentLengthPct: minSegLenPct,
        gapTolerance: gapTol,
      },
      segmentCounts: {
        horizontal: hSegCount,
        vertical: vSegCount,
        diagonal: diagSegCount,
      },
      footprintSize: fpSize,
      footprintPct: Number((fpSize / (w * h) * 100).toFixed(1)),
    },
  };
};

export const boundaryByMode = (result, wallMode = 'inner') => {
  if (!result) return null;
  if (wallMode === 'outer') return result.outer ?? result.inner;
  return result.inner ?? result.outer;
};

export const isPointInsideNormalizedImage = (point, preprocess) => pointInBounds(point, preprocess.width, preprocess.height);
