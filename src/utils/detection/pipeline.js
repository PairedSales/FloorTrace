import { normalizeImageData, mapPointToNormalized } from './preprocess';
import { estimateDominantOrientations } from './orientation';
import { closeMask, erode, dilate } from './wallMask';
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

// Brightness below which a pixel is considered part of a wall.
// 200 detects 1-pixel-wide walls after box-blur (gray ≈ 170 for a thin
// line on white background) while rejecting background near walls (≈ 225)
// and JPEG artifacts (≈ 250).
const DARK_PIXEL_THRESHOLD = 200;

/* ---------- Exterior Wall Tracing (Problem 2) ----------
 * Exterior boundary detection using edge-inward scanning on raw
 * grayscale brightness (global threshold).
 *
 * For clean inputs (black-on-white, no extraneous noise outside the
 * floorplan), a simple global brightness threshold is more accurate
 * than adaptive thresholding: it correctly captures the full thickness
 * of thick walls (no hollow centers) and preserves thin lines such as
 * window outlines (no morphological erosion).
 *
 * Starting from the outermost edges of the image, the algorithm scans
 * inward to find the first dark pixel in each row/column.  The
 * intersection of the 4 edge profiles defines the exterior perimeter,
 * correctly handling rectangular polygons with concavities and
 * 45-degree angles.
 */

/**
 * Edge-inward scanning for exterior wall detection.
 * Scans from all 4 edges of the image towards the center, recording
 * the position of the first wall (black) pixel encountered in each
 * row/column.  Returns 4 profile arrays.
 *
 * For clean, preprocessed inputs this directly identifies the exterior
 * wall positions without any line detection or segment merging.
 */
const scanEdgeInward = (wallMask, width, height) => {
  const topProfile = new Int32Array(width).fill(height);
  const bottomProfile = new Int32Array(width).fill(-1);
  const leftProfile = new Int32Array(height).fill(width);
  const rightProfile = new Int32Array(height).fill(-1);

  // Top & bottom profiles: scan each column vertically.
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      if (wallMask[y * width + x]) { topProfile[x] = y; break; }
    }
    for (let y = height - 1; y >= 0; y -= 1) {
      if (wallMask[y * width + x]) { bottomProfile[x] = y; break; }
    }
  }

  // Left & right profiles: scan each row horizontally.
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (wallMask[y * width + x]) { leftProfile[y] = x; break; }
    }
    for (let x = width - 1; x >= 0; x -= 1) {
      if (wallMask[y * width + x]) { rightProfile[y] = x; break; }
    }
  }

  return { topProfile, bottomProfile, leftProfile, rightProfile };
};

const profileToArray = (profile) => Array.from(profile);

const cloneProfiles = (profiles) => ({
  topProfile: new Int32Array(profiles.topProfile),
  bottomProfile: new Int32Array(profiles.bottomProfile),
  leftProfile: new Int32Array(profiles.leftProfile),
  rightProfile: new Int32Array(profiles.rightProfile),
});

const fillShortInvalidRuns = (profile, invalidValue, maxRunLength) => {
  const out = new Int32Array(profile);
  let i = 0;
  while (i < out.length) {
    if (out[i] !== invalidValue) {
      i += 1;
      continue;
    }

    const start = i;
    while (i < out.length && out[i] === invalidValue) i += 1;
    const end = i - 1;
    const runLength = end - start + 1;
    if (runLength > maxRunLength) continue;

    const left = start - 1 >= 0 ? out[start - 1] : invalidValue;
    const right = i < out.length ? out[i] : invalidValue;
    const hasLeft = left !== invalidValue;
    const hasRight = right !== invalidValue;
    if (!hasLeft && !hasRight) continue;

    for (let j = start; j <= end; j += 1) {
      if (hasLeft && hasRight) {
        const t = (j - start + 1) / (runLength + 1);
        out[j] = Math.round(left * (1 - t) + right * t);
      } else if (hasLeft) {
        out[j] = left;
      } else {
        out[j] = right;
      }
    }
  }
  return out;
};

const medianFilterProfile = (profile, invalidValue, windowSize) => {
  const out = new Int32Array(profile.length);
  const radius = Math.floor(windowSize / 2);
  for (let i = 0; i < profile.length; i += 1) {
    if (profile[i] === invalidValue) {
      out[i] = invalidValue;
      continue;
    }
    const values = [];
    for (let j = Math.max(0, i - radius); j <= Math.min(profile.length - 1, i + radius); j += 1) {
      if (profile[j] !== invalidValue) values.push(profile[j]);
    }
    if (!values.length) {
      out[i] = profile[i];
      continue;
    }
    values.sort((a, b) => a - b);
    out[i] = values[Math.floor(values.length / 2)];
  }
  return out;
};

const clampProfileDelta = (profile, invalidValue, maxDelta) => {
  const out = new Int32Array(profile);
  let lastIdx = -1;
  for (let i = 0; i < out.length; i += 1) {
    if (out[i] === invalidValue) continue;
    if (lastIdx >= 0) {
      const minV = out[lastIdx] - maxDelta * (i - lastIdx);
      const maxV = out[lastIdx] + maxDelta * (i - lastIdx);
      out[i] = Math.max(minV, Math.min(maxV, out[i]));
    }
    lastIdx = i;
  }
  return out;
};

const robustLinearFit = (xs, ys, huberDelta = 2, iterations = 4) => {
  let slope = 0;
  let intercept = ys.reduce((sum, y) => sum + y, 0) / ys.length;
  let weights = new Float32Array(xs.length).fill(1);

  for (let iter = 0; iter < iterations; iter += 1) {
    let sumW = 0;
    let sumX = 0;
    let sumY = 0;
    let sumXX = 0;
    let sumXY = 0;
    for (let i = 0; i < xs.length; i += 1) {
      const w = weights[i];
      const x = xs[i];
      const y = ys[i];
      sumW += w;
      sumX += w * x;
      sumY += w * y;
      sumXX += w * x * x;
      sumXY += w * x * y;
    }
    const denom = (sumW * sumXX) - (sumX * sumX);
    if (Math.abs(denom) < 1e-6) break;
    slope = ((sumW * sumXY) - (sumX * sumY)) / denom;
    intercept = (sumY - (slope * sumX)) / sumW;

    for (let i = 0; i < xs.length; i += 1) {
      const residual = ys[i] - (slope * xs[i] + intercept);
      const absResidual = Math.abs(residual);
      weights[i] = absResidual <= huberDelta ? 1 : huberDelta / absResidual;
    }
  }

  return { slope, intercept };
};

const piecewiseLinearRegularize = (profile, invalidValue, options = {}) => {
  const {
    segmentLength = 64,
    minSegmentLength = 16,
    huberDelta = 2,
    iterations = 4,
  } = options;
  const out = new Int32Array(profile);
  let runStart = -1;

  const flushRun = (runEnd) => {
    if (runStart < 0) return;
    const runLength = runEnd - runStart + 1;
    if (runLength < minSegmentLength) {
      runStart = -1;
      return;
    }
    for (let segStart = runStart; segStart <= runEnd; segStart += segmentLength) {
      const segEnd = Math.min(runEnd, segStart + segmentLength - 1);
      const len = segEnd - segStart + 1;
      if (len < minSegmentLength) continue;
      const xs = new Array(len);
      const ys = new Array(len);
      for (let i = 0; i < len; i += 1) {
        xs[i] = segStart + i;
        ys[i] = out[segStart + i];
      }
      const fit = robustLinearFit(xs, ys, huberDelta, iterations);
      for (let i = 0; i < len; i += 1) {
        out[segStart + i] = Math.round(fit.slope * xs[i] + fit.intercept);
      }
    }
    runStart = -1;
  };

  for (let i = 0; i < out.length; i += 1) {
    const valid = out[i] !== invalidValue;
    if (valid && runStart < 0) runStart = i;
    if (!valid && runStart >= 0) flushRun(i - 1);
  }
  flushRun(out.length - 1);

  return out;
};

const regularizeEdgeProfiles = (profiles, width, height, options = {}) => {
  const {
    maxInvalidRun = 6,
    medianWindow = 7,
    maxDeltaX = 2,
    maxDeltaY = 2,
    piecewiseLinear = false,
    piecewiseOptions = {},
  } = options;
  const window = Math.max(3, Math.min(11, medianWindow | 1));
  const out = cloneProfiles(profiles);

  const processProfile = (profile, invalidValue, maxDelta) => {
    let cur = fillShortInvalidRuns(profile, invalidValue, maxInvalidRun);
    cur = medianFilterProfile(cur, invalidValue, window);
    cur = clampProfileDelta(cur, invalidValue, maxDelta);
    if (piecewiseLinear) {
      cur = piecewiseLinearRegularize(cur, invalidValue, piecewiseOptions);
    }
    return cur;
  };

  out.leftProfile = processProfile(out.leftProfile, width, maxDeltaX);
  out.rightProfile = processProfile(out.rightProfile, -1, maxDeltaX);
  out.topProfile = processProfile(out.topProfile, height, maxDeltaY);
  out.bottomProfile = processProfile(out.bottomProfile, -1, maxDeltaY);
  return out;
};

/**
 * Build a footprint mask from provided edge-scan profiles.
 * A pixel is inside the footprint if it falls within the first-wall
 * boundaries from all 4 edges.  This efficiently outlines the exterior
 * perimeter, correctly handling rectangular polygons with concavities
 * and 45-degree angles.
 */
const buildEdgeScanFootprintFromProfiles = (profiles, width, height) => {
  const { topProfile, bottomProfile, leftProfile, rightProfile } = profiles;
  const footprint = new Uint8Array(width * height);

  for (let y = 0; y < height; y += 1) {
    const xLeft = leftProfile[y];
    const xRight = rightProfile[y];
    if (xLeft >= width || xRight < 0 || xLeft > xRight) continue;
    for (let x = xLeft; x <= xRight; x += 1) {
      if (y >= topProfile[x] && y <= bottomProfile[x]) {
        footprint[y * width + x] = 1;
      }
    }
  }

  return footprint;
};

/**
 * Measure wall thickness at each exterior wall position by scanning inward
 * through the first dark pixel until the wall ends (transitions to white).
 *
 * Each edge profile records where the exterior wall begins; this function
 * continues scanning inward from those positions to measure how thick the
 * wall band is at each row/column.  Short measurements from windows, doors,
 * or dashes are included but can be filtered by the caller.
 *
 * @param {Uint8Array} wallMask  Binary wall mask (1 = dark/wall, 0 = light/space).
 * @param {number}     width     Mask width in pixels.
 * @param {number}     height    Mask height in pixels.
 * @param {object}     profiles  Edge-scan profiles from scanEdgeInward().
 * @returns {number[]} Array of per-row/column wall thickness measurements (px).
 */
export const measureWallThicknessFromEdge = (wallMask, width, height, profiles) => {
  const { topProfile, bottomProfile, leftProfile, rightProfile } = profiles;
  const measurements = [];

  // Top edge: scan downward from topProfile[x] through the wall.
  for (let x = 0; x < width; x += 1) {
    const y0 = topProfile[x];
    if (y0 >= height) continue;
    let t = 0;
    for (let y = y0; y < height; y += 1) {
      if (wallMask[y * width + x]) t += 1;
      else break;
    }
    if (t > 0) measurements.push(t);
  }

  // Bottom edge: scan upward from bottomProfile[x] through the wall.
  for (let x = 0; x < width; x += 1) {
    const y0 = bottomProfile[x];
    if (y0 < 0) continue;
    let t = 0;
    for (let y = y0; y >= 0; y -= 1) {
      if (wallMask[y * width + x]) t += 1;
      else break;
    }
    if (t > 0) measurements.push(t);
  }

  // Left edge: scan rightward from leftProfile[y] through the wall.
  for (let y = 0; y < height; y += 1) {
    const x0 = leftProfile[y];
    if (x0 >= width) continue;
    let t = 0;
    for (let x = x0; x < width; x += 1) {
      if (wallMask[y * width + x]) t += 1;
      else break;
    }
    if (t > 0) measurements.push(t);
  }

  // Right edge: scan leftward from rightProfile[y] through the wall.
  for (let y = 0; y < height; y += 1) {
    const x0 = rightProfile[y];
    if (x0 < 0) continue;
    let t = 0;
    for (let x = x0; x >= 0; x -= 1) {
      if (wallMask[y * width + x]) t += 1;
      else break;
    }
    if (t > 0) measurements.push(t);
  }

  return measurements;
};

// Minimum thickness (px) to treat a measurement as a solid wall section.
// Values below this are likely window/door gaps or thin decorative lines.
const MIN_WALL_THICKNESS_MEASUREMENT = 3;

/**
 * Derive a single robust wall-thickness estimate from an array of
 * per-row/column measurements, ignoring thin outliers (windows, doors).
 *
 * Filters out measurements below MIN_WALL_THICKNESS_MEASUREMENT, then
 * returns the mode (most frequent value) of the remaining distribution.
 * Ties are broken in favour of the larger value to prefer the dominant
 * thick-wall sections over incidental thin ones.
 *
 * @param {number[]} measurements  Output of measureWallThicknessFromEdge().
 * @param {number}   [fallback=2]  Returned when no measurements survive filtering.
 * @returns {number} Estimated wall thickness in pixels.
 */
export const computeRobustWallThickness = (measurements, fallback = 2) => {
  const thick = measurements.filter((t) => t >= MIN_WALL_THICKNESS_MEASUREMENT);
  if (thick.length === 0) return fallback;

  // Build frequency histogram.
  const hist = new Map();
  for (const t of thick) {
    hist.set(t, (hist.get(t) ?? 0) + 1);
  }

  // Return mode; ties broken in favour of the larger value.
  let modeVal = fallback;
  let modeCount = 0;
  for (const [val, count] of hist) {
    if (count > modeCount || (count === modeCount && val > modeVal)) {
      modeCount = count;
      modeVal = val;
    }
  }

  return modeVal;
};

export const traceFloorplanBoundaryCore = (imageData, options = {}) => {
  const preprocess = normalizeImageData(imageData, options.preprocess);
  const orientation = estimateDominantOrientations(
    preprocess.gray, preprocess.width, preprocess.height, options.orientation,
  );

  const w = preprocess.width;
  const h = preprocess.height;

  /* --- Edge-scan footprint using global brightness threshold ---
   * Use a simple global threshold on the grayscale image to identify
   * wall pixels.  Unlike adaptive thresholding, this correctly captures
   * the full thickness of walls (no hollow centers for thick walls) and
   * preserves thin lines such as window outlines (no morphological
   * erosion of fine features).
   *
   * Since the input is guaranteed black-on-white with no noise outside
   * the floorplan, a global threshold is robust and accurate.  The
   * edge-inward scan naturally ignores interior features because it
   * only records the first dark pixel from each image edge.            */
  const darkThreshold = options.darkThreshold ?? DARK_PIXEL_THRESHOLD;
  const edgeScanMask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i += 1) {
    edgeScanMask[i] = preprocess.gray[i] < darkThreshold ? 1 : 0;
  }

  // Build footprint from edge profiles, retaining profiles for wall thickness measurement.
  const rawEdgeProfiles = scanEdgeInward(edgeScanMask, w, h);
  const smoothingOptions = options.edgeProfileSmoothing;
  const useEdgeProfileSmoothing = smoothingOptions !== false;
  const edgeProfiles = useEdgeProfileSmoothing
    ? regularizeEdgeProfiles(
      rawEdgeProfiles,
      w,
      h,
      typeof smoothingOptions === 'object' ? smoothingOptions : {},
    )
    : rawEdgeProfiles;
  let footprint = buildEdgeScanFootprintFromProfiles(edgeProfiles, w, h);
  let usedEdgeScan = true;

  // Verify footprint is non-trivial.
  let fpSize = 0;
  for (let i = 0; i < footprint.length; i += 1) {
    if (footprint[i]) fpSize += 1;
  }

  if (fpSize < w * h * 0.02) {
    // Fallback: flood-fill from edges.
    footprint = getFloorplanFootprint(
      dilate(edgeScanMask, w, h, options.outerDilate ?? 2), w, h,
    );
    usedEdgeScan = false;
  }

  /* --- Step 4: Extract outer and inner boundary polygons ---
   * Measure actual wall thickness from edge profiles so the inner boundary
   * reflects the true interior wall face, not just a fixed 2-pixel erosion.  */
  const wallThicknessMeasurements = measureWallThicknessFromEdge(edgeScanMask, w, h, edgeProfiles);
  const wallThickness = options.innerErode != null
    ? options.innerErode
    : computeRobustWallThickness(wallThicknessMeasurements);

  const outerResult = getLargestComponentPolygon(
    footprint, preprocess, orientation, options,
  );
  const innerFootprint = erode(footprint, w, h, wallThickness);
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
      usedEdgeScan,
      wallThickness,
      rawProfiles: {
        topProfile: profileToArray(rawEdgeProfiles.topProfile),
        bottomProfile: profileToArray(rawEdgeProfiles.bottomProfile),
        leftProfile: profileToArray(rawEdgeProfiles.leftProfile),
        rightProfile: profileToArray(rawEdgeProfiles.rightProfile),
      },
      regularizedProfiles: {
        topProfile: profileToArray(edgeProfiles.topProfile),
        bottomProfile: profileToArray(edgeProfiles.bottomProfile),
        leftProfile: profileToArray(edgeProfiles.leftProfile),
        rightProfile: profileToArray(edgeProfiles.rightProfile),
      },
      edgeProfileSmoothing: useEdgeProfileSmoothing,
    },
  };
};

export const boundaryByMode = (result, wallMode = 'inner') => {
  if (!result) return null;
  if (wallMode === 'outer') return result.outer ?? result.inner;
  return result.inner ?? result.outer;
};
