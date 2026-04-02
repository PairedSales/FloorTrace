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
 * Expansion-based room detection: from the OCR/click point,
 * expand outward in 4 directions (left, right, up, down) until
 * rectangular room walls are found.
 *
 * Step 1: Preprocess – convert to binary wall mask and apply
 *         morphological closing to bridge door/window gaps.
 * Step 2: Start from the OCR/click location (find free-space seed
 *         if the click lands on a wall pixel).
 * Step 3: Expand outward in each direction, scanning for walls
 *         with sufficient perpendicular continuity.
 * Step 4: Handle wall gaps via the preprocessed image and
 *         configurable gap tolerance.
 * Step 5: Construct a rectangle from the four detected boundaries.
 * Step 6: Validate the rectangle (minimum size, OCR point inside).
 *
 * Configurable parameters:
 *   - roomCloseRadius: morphological closing radius (default 4)
 *   - gapTolerance:    max gap in wall continuity (default 8)
 *   - minWallThickness: min perpendicular wall extent (default 15)
 *   - minRoomSize:     min room area in pixels² (default 400)
 */

// Room detection tuning constants
const MIN_WALL_THICKNESS_PIXELS = 20;          // Absolute floor for wall thickness threshold
const WALL_THICKNESS_IMAGE_RATIO = 0.06;       // Wall thickness as fraction of shorter dimension
const HORIZONTAL_WALL_WIDTH_RATIO = 0.4;       // Horizontal wall must span this fraction of room width
const MAX_ROOM_AREA_RATIO = 0.9;               // Reject rooms covering >90% of image area
const MAX_SCAN_BAND = 3;                        // Max pixel band to check around scan line
const MIN_SCAN_BAND = 1;                        // Min pixel band to check around scan line
const SCAN_BAND_DIVISOR = 2;                    // Divide gap tolerance by this for scan band

/**
 * Measure wall continuity in the perpendicular direction at (x, y).
 * For a vertical wall, measures how far the wall extends vertically.
 * For a horizontal wall, measures how far the wall extends horizontally.
 * Allows small gaps up to gapTolerance pixels.
 */
const measureWallContinuity = (wallMask, x, y, isVerticalWall, width, height, gapTolerance) => {
  let count = 0;
  let gap = 0;

  if (isVerticalWall) {
    for (let dy = 0; y - dy >= 0; dy += 1) {
      if (wallMask[(y - dy) * width + x]) { count += 1; gap = 0; }
      else { gap += 1; if (gap > gapTolerance) break; }
    }
    gap = 0;
    for (let dy = 1; y + dy < height; dy += 1) {
      if (wallMask[(y + dy) * width + x]) { count += 1; gap = 0; }
      else { gap += 1; if (gap > gapTolerance) break; }
    }
  } else {
    for (let dx = 0; x - dx >= 0; dx += 1) {
      if (wallMask[y * width + (x - dx)]) { count += 1; gap = 0; }
      else { gap += 1; if (gap > gapTolerance) break; }
    }
    gap = 0;
    for (let dx = 1; x + dx < width; dx += 1) {
      if (wallMask[y * width + (x + dx)]) { count += 1; gap = 0; }
      else { gap += 1; if (gap > gapTolerance) break; }
    }
  }

  return count;
};

/**
 * Expand from (startX, startY) in the given direction until a wall
 * with sufficient perpendicular continuity is found.
 *
 * Checks a small band of pixels around the scan line to handle
 * cases where a door gap aligns with the scan row/column.
 *
 * Returns { position, continuity, wallsChecked }.
 */
const expandToFindWall = (wallMask, startX, startY, direction, width, height, options) => {
  const { gapTolerance = 8, minWallThickness = 15 } = options;
  const isHorizontalScan = direction === 'left' || direction === 'right';
  const step = direction === 'left' || direction === 'up' ? -1 : 1;
  const isVerticalWall = isHorizontalScan;

  let pos = isHorizontalScan ? startX : startY;
  const limit = step > 0
    ? (isHorizontalScan ? width - 1 : height - 1)
    : 0;
  const fixedPos = isHorizontalScan ? startY : startX;
  const scanBand = Math.min(MAX_SCAN_BAND, Math.max(MIN_SCAN_BAND, Math.floor(gapTolerance / SCAN_BAND_DIVISOR)));
  const wallsChecked = [];

  while (pos !== limit) {
    pos += step;

    // Check a small band around the fixed position for wall pixels.
    let wallX = -1;
    let wallY = -1;
    for (let d = -scanBand; d <= scanBand; d += 1) {
      const fp = fixedPos + d;
      if (fp < 0 || fp >= (isHorizontalScan ? height : width)) continue;
      const idx = isHorizontalScan ? fp * width + pos : pos * width + fp;
      if (wallMask[idx]) {
        wallX = isHorizontalScan ? pos : fp;
        wallY = isHorizontalScan ? fp : pos;
        break;
      }
    }

    if (wallX >= 0) {
      const continuity = measureWallContinuity(
        wallMask, wallX, wallY, isVerticalWall, width, height, gapTolerance,
      );
      wallsChecked.push({ pos, continuity });

      if (continuity >= minWallThickness) {
        return { position: pos, continuity, wallsChecked };
      }
    }
  }

  // Reached image boundary.
  return { position: pos, continuity: 0, wallsChecked };
};

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

export const detectRoomFromClickCore = (imageData, clickPoint, options = {}) => {
  // Step 1: Preprocess – binary wall mask + morphological closing.
  const preprocess = normalizeImageData(imageData, options.preprocess);
  const orientation = estimateDominantOrientations(
    preprocess.gray, preprocess.width, preprocess.height, options.orientation,
  );

  const roomCloseRadius = options.roomCloseRadius ?? 4;
  const roomWallMask = closeMask(
    preprocess.wallMask,
    preprocess.width,
    preprocess.height,
    roomCloseRadius,
  );
  const freeMask = invertMask(roomWallMask);

  // Step 2: Map click/OCR point to normalized coordinates.
  const nPoint = mapPointToNormalized(clickPoint, preprocess.scale);
  const clampedPoint = {
    x: Math.max(0, Math.min(preprocess.width - 1, nPoint.x)),
    y: Math.max(0, Math.min(preprocess.height - 1, nPoint.y)),
  };

  // Find free-space seed near the click point (handles clicks on wall/text).
  const seed = findFreeSpaceSeed(
    freeMask, clampedPoint.x, clampedPoint.y, preprocess.width, preprocess.height,
  );
  if (!seed) return null;

  // Step 3 & 4: Expand in 4 directions to find walls.
  // Two-pass approach: find vertical walls first (reliable because horizontal
  // text labels rarely masquerade as vertical walls), then use the detected
  // room width to set a higher threshold for horizontal wall detection so
  // text labels and dimension lines are filtered out.
  const w = preprocess.width;
  const h = preprocess.height;
  const gapTolerance = options.gapTolerance ?? 8;
  const minWallThickness = options.minWallThickness
    ?? Math.max(MIN_WALL_THICKNESS_PIXELS, Math.floor(Math.min(w, h) * WALL_THICKNESS_IMAGE_RATIO));
  const minRoomSize = options.minRoomSize ?? 400;
  const expandOpts = { gapTolerance, minWallThickness };

  // Pass 1: Find vertical walls (left/right).
  const leftResult = expandToFindWall(roomWallMask, seed.x, seed.y, 'left', w, h, expandOpts);
  const rightResult = expandToFindWall(roomWallMask, seed.x, seed.y, 'right', w, h, expandOpts);

  // Pass 2: Find horizontal walls (up/down) with an adaptive threshold.
  // Horizontal room walls should span a significant portion of the room
  // width; text labels and dimension lines are shorter and get filtered.
  const detectedWidth = rightResult.position - leftResult.position;
  const horzWallThreshold = Math.max(minWallThickness, Math.floor(detectedWidth * HORIZONTAL_WALL_WIDTH_RATIO));
  const horzExpandOpts = { gapTolerance, minWallThickness: horzWallThreshold };
  const upResult = expandToFindWall(roomWallMask, seed.x, seed.y, 'up', w, h, horzExpandOpts);
  const downResult = expandToFindWall(roomWallMask, seed.x, seed.y, 'down', w, h, horzExpandOpts);

  // Step 5: Construct room rectangle from the four boundaries.
  const left = leftResult.position;
  const right = rightResult.position;
  const top = upResult.position;
  const bottom = downResult.position;

  // Step 6: Validate room.
  const roomWidth = right - left + 1;
  const roomHeight = bottom - top + 1;
  const roomArea = roomWidth * roomHeight;
  const imageArea = w * h;

  // Reject if too small (noise) or too large (detection failure).
  if (roomArea < minRoomSize) return null;
  if (roomArea > imageArea * MAX_ROOM_AREA_RATIO) return null;

  // Ensure seed point lies inside the rectangle.
  if (seed.x < left || seed.x > right || seed.y < top || seed.y > bottom) return null;

  const polygon = [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ];

  const confidenceBase = Math.min(1, roomArea / (imageArea * 0.2));
  const confidence = Math.max(0.2, Math.min(0.98, confidenceBase));

  return normalizedRoomResult(polygon, preprocess, confidence, {
    normalizedSize: { width: w, height: h },
    dominantAngles: orientation.dominant,
    startPoint: { x: seed.x, y: seed.y },
    expansionPaths: {
      left: { position: left, continuity: leftResult.continuity },
      right: { position: right, continuity: rightResult.continuity },
      up: { position: top, continuity: upResult.continuity },
      down: { position: bottom, continuity: downResult.continuity },
    },
    wallsDetected: {
      left: leftResult.wallsChecked,
      right: rightResult.wallsChecked,
      up: upResult.wallsChecked,
      down: downResult.wallsChecked,
    },
    roomBounds: { left, right, top, bottom },
    roomArea,
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
