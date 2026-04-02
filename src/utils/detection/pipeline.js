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
 * Edge-inward scanning: scan from each image edge inward, detect long
 * segments of black (wall) pixels, filter short segments (text/logos),
 * extend detected wall lines, and build the exterior polygon.
 * Falls back to the existing flood-fill approach when edge scanning
 * does not produce a valid polygon.
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

const scanEdgeInward = (wallMask, width, height, minSegLen, gapTol) => {
  // Scan from each edge inward to find the first row/column containing
  // a long wall segment.  Returns the four wall-line positions.
  let topY = -1;
  let bottomY = -1;
  let leftX = -1;
  let rightX = -1;

  // From top edge downward
  for (let y = 0; y < Math.floor(height * 0.5); y += 1) {
    if (findLongSegments(wallMask, y, width, true, width, minSegLen, gapTol).length > 0) {
      topY = y;
      break;
    }
  }

  // From bottom edge upward
  for (let y = height - 1; y >= Math.floor(height * 0.5); y -= 1) {
    if (findLongSegments(wallMask, y, width, true, width, minSegLen, gapTol).length > 0) {
      bottomY = y;
      break;
    }
  }

  // From left edge rightward
  for (let x = 0; x < Math.floor(width * 0.5); x += 1) {
    if (findLongSegments(wallMask, x, height, false, width, minSegLen, gapTol).length > 0) {
      leftX = x;
      break;
    }
  }

  // From right edge leftward
  for (let x = width - 1; x >= Math.floor(width * 0.5); x -= 1) {
    if (findLongSegments(wallMask, x, height, false, width, minSegLen, gapTol).length > 0) {
      rightX = x;
      break;
    }
  }

  if (topY < 0 || bottomY < 0 || leftX < 0 || rightX < 0) return null;
  if (rightX - leftX < minSegLen || bottomY - topY < minSegLen) return null;

  return { topY, bottomY, leftX, rightX };
};

const buildEdgeScanFootprint = (wallMask, width, height, bounds, gapTol) => {
  // Within the bounding box from edge scanning, build a more precise
  // footprint by scanning row-by-row and column-by-column, then combining
  // both masks for robustness.
  const footprint = new Uint8Array(width * height);
  const { topY, bottomY, leftX, rightX } = bounds;

  // Row-by-row scan: fill between first and last wall pixel per row.
  // This correctly captures horizontal exterior walls.
  for (let y = topY; y <= bottomY; y += 1) {
    let first = -1;
    let last = -1;
    for (let x = leftX; x <= rightX; x += 1) {
      if (wallMask[y * width + x]) {
        if (first < 0) first = x;
        last = x;
      }
    }
    if (first >= 0 && last - first > gapTol) {
      for (let x = first; x <= last; x += 1) {
        footprint[y * width + x] = 1;
      }
    }
  }

  // Column-by-column scan: fill between first and last wall pixel per column.
  // This correctly captures vertical exterior walls (e.g. an irregular right
  // wall whose outer vertical line has gaps between cross-segments, causing the
  // row-only pass to miss the exterior extent of those rows).
  for (let x = leftX; x <= rightX; x += 1) {
    let first = -1;
    let last = -1;
    for (let y = topY; y <= bottomY; y += 1) {
      if (wallMask[y * width + x]) {
        if (first < 0) first = y;
        last = y;
      }
    }
    if (first >= 0 && last - first > gapTol) {
      for (let y = first; y <= last; y += 1) {
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

  // Close small wall gaps with dilation for robust footprint detection.
  const closedMask = dilate(baseWallMask, preprocess.width, preprocess.height, options.outerDilate ?? 2);

  const w = preprocess.width;
  const h = preprocess.height;
  const minSegLen = Math.floor(Math.min(w, h) * 0.15);
  const gapTol = options.gapTolerance ?? 8;

  // Try edge-inward scanning first — more robust against surrounding text/logos.
  const edgeBounds = scanEdgeInward(closedMask, w, h, minSegLen, gapTol);
  let footprint;

  if (edgeBounds) {
    footprint = buildEdgeScanFootprint(closedMask, w, h, edgeBounds, gapTol);
    // Verify the footprint is non-trivial
    let fpSize = 0;
    for (let i = 0; i < footprint.length; i += 1) {
      if (footprint[i]) fpSize += 1;
    }
    if (fpSize < w * h * 0.02) {
      footprint = null; // too small, fall back
    }
  }

  // Fall back to the existing flood-fill from edges approach
  if (!footprint) {
    footprint = getFloorplanFootprint(closedMask, w, h);
  }

  // Outer boundary
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
      normalizedSize: { width: preprocess.width, height: preprocess.height },
      hasOuter: Boolean(outerPolygon),
      hasInner: Boolean(innerPolygon),
      usedEdgeScan: Boolean(edgeBounds),
    },
  };
};

export const boundaryByMode = (result, wallMode = 'inner') => {
  if (!result) return null;
  if (wallMode === 'outer') return result.outer ?? result.inner;
  return result.inner ?? result.outer;
};

export const isPointInsideNormalizedImage = (point, preprocess) => pointInBounds(point, preprocess.width, preprocess.height);
