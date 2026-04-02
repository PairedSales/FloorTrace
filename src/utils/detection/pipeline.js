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
 * Segment-based outward scanning: from the click/OCR text position,
 * scan outward in all four directions to find long horizontal and
 * vertical wall segments that form a rectangle.  Door gaps are
 * tolerated via a configurable gap tolerance.
 *
 * The algorithm:
 * 1. Scan upward from click point row-by-row to find the first row
 *    with a long horizontal wall segment that spans the click x.
 * 2. Repeat downward, leftward, and rightward.
 * 3. The four wall positions define a rectangle.
 * 4. Rooms are always rectangular per the problem constraints.
 */

/**
 * Scan a single row/column of the wall mask for long wall segments.
 * Returns segments that overlap the given cross-axis position.
 */
const findWallSegmentsCovering = (wallMask, scanLine, length, isHorizontal, width, minLen, gapTol, crossPos) => {
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
      if (gapRun > gapTol) {
        const segEnd = i - gapRun;
        if (segEnd - segStart + 1 >= minLen && segStart <= crossPos && segEnd >= crossPos) {
          segments.push({ start: segStart, end: segEnd });
        }
        segStart = -1;
        gapRun = 0;
      }
    }
  }

  if (segStart >= 0) {
    const segEnd = length - 1 - gapRun;
    if (segEnd - segStart + 1 >= minLen && segStart <= crossPos && segEnd >= crossPos) {
      segments.push({ start: segStart, end: segEnd });
    }
  }

  return segments;
};

/**
 * Scan outward from a center point in all four directions to find the
 * first long wall segment in each direction.  Returns bounding
 * rectangle {topY, bottomY, leftX, rightX} or null.
 */
const scanOutwardForRoom = (wallMask, width, height, cx, cy, minLen, gapTol) => {
  let topY = -1;
  let bottomY = -1;
  let leftX = -1;
  let rightX = -1;

  // Scan upward from cy to find the first row with a long horizontal segment covering cx
  for (let y = cy; y >= 0; y -= 1) {
    const segs = findWallSegmentsCovering(wallMask, y, width, true, width, minLen, gapTol, cx);
    if (segs.length > 0) {
      topY = y;
      break;
    }
  }

  // Scan downward
  for (let y = cy; y < height; y += 1) {
    const segs = findWallSegmentsCovering(wallMask, y, width, true, width, minLen, gapTol, cx);
    if (segs.length > 0) {
      bottomY = y;
      break;
    }
  }

  // Scan leftward from cx to find the first column with a long vertical segment covering cy
  for (let x = cx; x >= 0; x -= 1) {
    const segs = findWallSegmentsCovering(wallMask, x, height, false, width, minLen, gapTol, cy);
    if (segs.length > 0) {
      leftX = x;
      break;
    }
  }

  // Scan rightward
  for (let x = cx; x < width; x += 1) {
    const segs = findWallSegmentsCovering(wallMask, x, height, false, width, minLen, gapTol, cy);
    if (segs.length > 0) {
      rightX = x;
      break;
    }
  }

  if (topY < 0 || bottomY < 0 || leftX < 0 || rightX < 0) return null;
  if (rightX - leftX < 2 || bottomY - topY < 2) return null;

  return { topY, bottomY, leftX, rightX };
};

export const detectRoomFromClickCore = (imageData, clickPoint, options = {}) => {
  const preprocess = normalizeImageData(imageData, options.preprocess);
  const orientation = estimateDominantOrientations(preprocess.gray, preprocess.width, preprocess.height, options.orientation);
  const baseWallMask = prepareWallMask(preprocess.wallMask, preprocess.width, preprocess.height, options.wallMask);

  const w = preprocess.width;
  const h = preprocess.height;

  const nPoint = mapPointToNormalized(clickPoint, preprocess.scale);
  const cx = Math.max(0, Math.min(w - 1, nPoint.x));
  const cy = Math.max(0, Math.min(h - 1, nPoint.y));

  // Room walls are the longest continuous features in the image.
  // Use a shorter minimum segment length than exterior detection since
  // rooms can be small relative to the overall image.
  const minDim = Math.min(w, h);
  const minSegLenPct = options.roomMinSegmentPct ?? 0.06;
  const minSegLen = Math.max(4, Math.floor(minDim * minSegLenPct));
  const gapTol = options.roomGapTolerance ?? 8;

  const roomBounds = scanOutwardForRoom(baseWallMask, w, h, cx, cy, minSegLen, gapTol);

  if (roomBounds) {
    const { topY, bottomY, leftX, rightX } = roomBounds;
    const roomW = rightX - leftX;
    const roomH = bottomY - topY;
    const imageArea = w * h;
    const roomArea = roomW * roomH;

    // Reject rooms that are unreasonably large (>60%) or tiny (<0.3%).
    if (roomArea <= imageArea * 0.6 && roomArea >= imageArea * 0.003) {
      const polygon = [
        { x: leftX, y: topY },
        { x: rightX, y: topY },
        { x: rightX, y: bottomY },
        { x: leftX, y: bottomY },
      ];

      const confidenceBase = Math.min(1, roomArea / (imageArea * 0.15));
      const confidence = Math.max(0.3, Math.min(0.98, confidenceBase));

      return normalizedRoomResult(polygon, preprocess, confidence, {
        normalizedSize: { width: w, height: h },
        dominantAngles: orientation.dominant,
        algorithm: 'segment-scan',
        roomBounds,
        thresholds: { minSegmentLength: minSegLen, gapTolerance: gapTol },
      });
    }
  }

  // Fallback: use flood-fill with morphological closing to bridge door gaps.
  const roomCloseRadius = options.roomCloseRadius ?? 4;
  const roomWallMask = closeMask(preprocess.wallMask, w, h, roomCloseRadius);
  const freeMask = invertMask(roomWallMask);

  // Find a free-space seed near the click point (handles clicks on wall/text).
  let seed = null;
  if (freeMask[cy * w + cx]) {
    seed = { x: cx, y: cy };
  } else {
    for (let r = 1; r <= 30 && !seed; r += 1) {
      for (let dx = -r; dx <= r && !seed; dx += 1) {
        const px1 = cx + dx;
        const py1 = cy - r;
        const py2 = cy + r;
        if (px1 >= 0 && px1 < w && py1 >= 0 && py1 < h && freeMask[py1 * w + px1]) seed = { x: px1, y: py1 };
        if (!seed && px1 >= 0 && px1 < w && py2 >= 0 && py2 < h && freeMask[py2 * w + px1]) seed = { x: px1, y: py2 };
      }
      for (let dy = -r + 1; dy < r && !seed; dy += 1) {
        const px1 = cx - r;
        const px2 = cx + r;
        const py1 = cy + dy;
        if (px1 >= 0 && px1 < w && py1 >= 0 && py1 < h && freeMask[py1 * w + px1]) seed = { x: px1, y: py1 };
        if (!seed && px2 >= 0 && px2 < w && py1 >= 0 && py1 < h && freeMask[py1 * w + px2]) seed = { x: px2, y: py1 };
      }
    }
  }
  if (!seed) return null;

  // Flood-fill from the seed to find the enclosed room region.
  const visited = new Uint8Array(w * h);
  const startIdx = seed.y * w + seed.x;
  visited[startIdx] = 1;
  const queue = [startIdx];
  let minX = seed.x;
  let maxX = seed.x;
  let minY = seed.y;
  let maxY = seed.y;
  let head = 0;
  while (head < queue.length) {
    const idx = queue[head];
    head += 1;
    const x = idx % w;
    const y = Math.floor(idx / w);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    const enqueue = (nIdx) => {
      if (!visited[nIdx] && freeMask[nIdx]) { visited[nIdx] = 1; queue.push(nIdx); }
    };
    if (x + 1 < w) enqueue(idx + 1);
    if (x - 1 >= 0) enqueue(idx - 1);
    if (y + 1 < h) enqueue(idx + w);
    if (y - 1 >= 0) enqueue(idx - w);
  }

  const imageArea = w * h;
  const regionArea = (maxX - minX + 1) * (maxY - minY + 1);
  if (regionArea > imageArea * 0.6 || regionArea < imageArea * 0.003) return null;

  const polygon = [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ];

  const confidenceBase = Math.min(1, queue.length / (imageArea * 0.2));
  const confidence = Math.max(0.2, Math.min(0.98, confidenceBase));

  return normalizedRoomResult(polygon, preprocess, confidence, {
    normalizedSize: { width: w, height: h },
    dominantAngles: orientation.dominant,
    algorithm: 'flood-fill-fallback',
    componentSize: queue.length,
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
    return {
      outer: null,
      inner: null,
      debug: {
        normalizedSize: { width: w, height: h },
        hasOuter: false,
        hasInner: false,
        algorithm: 'edge-inward-scanning',
        thresholds: { minSegmentLength: minSegLen, minSegmentLengthPct: minSegLenPct, gapTolerance: gapTol },
        segmentCounts: { horizontal: hSegCount, vertical: vSegCount, diagonal: diagSegCount },
        footprintSize: fpSize,
        footprintPct: Number((fpSize / (w * h) * 100).toFixed(1)),
        rejected: 'footprint too small',
      },
    };
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
