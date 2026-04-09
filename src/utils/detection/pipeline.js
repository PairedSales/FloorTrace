import { toGrayscale, boxBlurGray, resizeNearest, normalizeImageData, mapPointToNormalized } from './preprocess';
import { estimateDominantOrientations } from './orientation';
import { closeMask, openMask } from './wallMask';
import { labelConnectedComponents, mooreBoundaryTrace, simplifyRdp, polygonToBounds, mapPolygonFromNormalized } from './vectorize';
import { segmentRooms, extractRoomFeatures } from './roomSegmentation';
import { assignTextToRooms, computeScale } from './ocrMapping';

/* ------------------------------------------------------------------ */
/*  Room Detection helpers                                             */
/* ------------------------------------------------------------------ */

const invertMask = (mask) => {
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i += 1) {
    out[i] = mask[i] ? 0 : 1;
  }
  return out;
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

/* ---------- Room Detection ----------
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
const MIN_WALL_THICKNESS_PIXELS = 20;
const WALL_THICKNESS_IMAGE_RATIO = 0.06;
const HORIZONTAL_WALL_WIDTH_RATIO = 0.4;
const MAX_ROOM_AREA_RATIO = 0.9;
const MAX_SCAN_BAND = 3;
const MIN_SCAN_BAND = 1;
const SCAN_BAND_DIVISOR = 2;

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

  for (let r = 1; r <= maxRadius; r += 1) {
    for (let dx = -r; dx <= r; dx += 1) {
      const hit = tryPixel(cx + dx, cy - r) ?? tryPixel(cx + dx, cy + r);
      if (hit) return hit;
    }
    for (let dy = -r + 1; dy < r; dy += 1) {
      const hit = tryPixel(cx - r, cy + dy) ?? tryPixel(cx + r, cy + dy);
      if (hit) return hit;
    }
  }
  return null;
};

export const detectRoomFromClickCore = (imageData, clickPoint, options = {}) => {
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

  const nPoint = mapPointToNormalized(clickPoint, preprocess.scale);
  const clampedPoint = {
    x: Math.max(0, Math.min(preprocess.width - 1, nPoint.x)),
    y: Math.max(0, Math.min(preprocess.height - 1, nPoint.y)),
  };

  const seed = findFreeSpaceSeed(
    freeMask, clampedPoint.x, clampedPoint.y, preprocess.width, preprocess.height,
  );
  if (!seed) return null;

  const w = preprocess.width;
  const h = preprocess.height;
  const gapTolerance = options.gapTolerance ?? 8;
  const minWallThickness = options.minWallThickness
    ?? Math.max(MIN_WALL_THICKNESS_PIXELS, Math.floor(Math.min(w, h) * WALL_THICKNESS_IMAGE_RATIO));
  const minRoomSize = options.minRoomSize ?? 400;
  const expandOpts = { gapTolerance, minWallThickness };

  const leftResult = expandToFindWall(roomWallMask, seed.x, seed.y, 'left', w, h, expandOpts);
  const rightResult = expandToFindWall(roomWallMask, seed.x, seed.y, 'right', w, h, expandOpts);

  const detectedWidth = rightResult.position - leftResult.position;
  const horzWallThreshold = Math.max(minWallThickness, Math.floor(detectedWidth * HORIZONTAL_WALL_WIDTH_RATIO));
  const horzExpandOpts = { gapTolerance, minWallThickness: horzWallThreshold };
  const upResult = expandToFindWall(roomWallMask, seed.x, seed.y, 'up', w, h, horzExpandOpts);
  const downResult = expandToFindWall(roomWallMask, seed.x, seed.y, 'down', w, h, horzExpandOpts);

  const left = leftResult.position;
  const right = rightResult.position;
  const top = upResult.position;
  const bottom = downResult.position;

  const roomWidth = right - left + 1;
  const roomHeight = bottom - top + 1;
  const roomArea = roomWidth * roomHeight;
  const imageArea = w * h;

  if (roomArea < minRoomSize) return null;
  if (roomArea > imageArea * MAX_ROOM_AREA_RATIO) return null;

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

/* ------------------------------------------------------------------ */
/*  Otsu threshold                                                     */
/* ------------------------------------------------------------------ */

/**
 * Compute the optimal threshold using Otsu's method.
 * Returns the threshold value that maximises inter-class variance.
 */
export const otsuThreshold = (gray) => {
  const histogram = new Array(256).fill(0);
  const total = gray.length;
  for (let i = 0; i < total; i += 1) histogram[gray[i]] += 1;

  let sum = 0;
  for (let i = 0; i < 256; i += 1) sum += i * histogram[i];

  let sumB = 0;
  let wB = 0;
  let maxVariance = 0;
  let threshold = 0;

  for (let t = 0; t < 256; t += 1) {
    wB += histogram[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * histogram[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const variance = wB * wF * (mB - mF) * (mB - mF);
    if (variance > maxVariance) {
      maxVariance = variance;
      threshold = t;
    }
  }

  return threshold;
};

/* ------------------------------------------------------------------ */
/*  Step 1 – Preprocess image                                          */
/* ------------------------------------------------------------------ */

/**
 * Convert to grayscale, optionally blur, then binarise with Otsu.
 * Walls (dark pixels ≤ threshold) → 1, background → 0.
 */
export const preprocessImage = (imageData, options = {}) => {
  const { width, height, data } = imageData;
  const blurRadius = options.blurRadius ?? 1;

  const gray = toGrayscale(data, width, height);
  const blurred = blurRadius > 0 ? boxBlurGray(gray, width, height, blurRadius) : gray;
  const threshold = otsuThreshold(blurred);

  const binary = new Uint8Array(width * height);
  for (let i = 0; i < binary.length; i += 1) {
    binary[i] = blurred[i] <= threshold ? 1 : 0;
  }

  return { gray, binary, threshold, width, height };
};

/* ------------------------------------------------------------------ */
/*  Step 2 – Clean binary mask                                         */
/* ------------------------------------------------------------------ */

/** Remove connected components whose pixel count is below `minArea`. */
const removeSmallComponents = (mask, width, height, minArea) => {
  const { labels, components } = labelConnectedComponents(mask, width, height, 1);
  const cleaned = new Uint8Array(width * height);
  for (const comp of components) {
    if (comp.size >= minArea) {
      for (let i = 0; i < labels.length; i += 1) {
        if (labels[i] === comp.id) cleaned[i] = 1;
      }
    }
  }
  return cleaned;
};

/**
 * Morphological closing (connect broken lines), opening (remove noise),
 * and small-component removal.
 */
export const cleanBinary = (binary, width, height, options = {}) => {
  const closeRadius = options.closeRadius ?? 3;
  const openRadius = options.openRadius ?? 2;
  const minArea = options.minComponentArea ?? Math.max(100, Math.round(width * height * 0.001));

  let cleaned = closeMask(binary, width, height, closeRadius);
  cleaned = openMask(cleaned, width, height, openRadius);
  cleaned = removeSmallComponents(cleaned, width, height, minArea);
  return cleaned;
};

/* ------------------------------------------------------------------ */
/*  Step 3 – Exterior flood-fill                                       */
/* ------------------------------------------------------------------ */

/**
 * Flood-fill background starting from image borders, then invert to
 * isolate the main floorplan mass (eliminates interior holes).
 */
export const fillExterior = (mask, width, height) => {
  const visited = new Uint8Array(width * height);
  const queue = [];

  // Seed from border pixels that are background (0)
  for (let x = 0; x < width; x += 1) {
    const top = x;
    if (!mask[top] && !visited[top]) { visited[top] = 1; queue.push(top); }
    const bottom = (height - 1) * width + x;
    if (!mask[bottom] && !visited[bottom]) { visited[bottom] = 1; queue.push(bottom); }
  }
  for (let y = 1; y < height - 1; y += 1) {
    const left = y * width;
    if (!mask[left] && !visited[left]) { visited[left] = 1; queue.push(left); }
    const right = y * width + width - 1;
    if (!mask[right] && !visited[right]) { visited[right] = 1; queue.push(right); }
  }

  // BFS
  for (let q = 0; q < queue.length; q += 1) {
    const idx = queue[q];
    const x = idx % width;
    const y = (idx - x) / width;

    if (x > 0)          { const n = idx - 1;     if (!visited[n] && !mask[n]) { visited[n] = 1; queue.push(n); } }
    if (x < width - 1)  { const n = idx + 1;     if (!visited[n] && !mask[n]) { visited[n] = 1; queue.push(n); } }
    if (y > 0)          { const n = idx - width;  if (!visited[n] && !mask[n]) { visited[n] = 1; queue.push(n); } }
    if (y < height - 1) { const n = idx + width;  if (!visited[n] && !mask[n]) { visited[n] = 1; queue.push(n); } }
  }

  // Everything NOT reached from the border is the floorplan mass
  const filled = new Uint8Array(width * height);
  for (let i = 0; i < filled.length; i += 1) {
    filled[i] = visited[i] ? 0 : 1;
  }
  return filled;
};

/* ------------------------------------------------------------------ */
/*  Step 4 – Extract outer contour                                     */
/* ------------------------------------------------------------------ */

/**
 * Find the largest connected component and return its boundary via
 * Moore neighbourhood tracing (RETR_EXTERNAL equivalent).
 */
export const extractOuterContour = (mask, width, height) => {
  const { labels, components } = labelConnectedComponents(mask, width, height, 1);
  if (components.length === 0) return null;

  const largest = components.reduce((a, b) => (a.size > b.size ? a : b));
  const boundary = mooreBoundaryTrace(labels, width, height, largest.id);
  return boundary.length >= 3 ? boundary : null;
};

/* ------------------------------------------------------------------ */
/*  Step 5 – Simplify contour                                          */
/* ------------------------------------------------------------------ */

/** Perimeter of a closed polygon. */
const computePerimeter = (points) => {
  let perimeter = 0;
  for (let i = 0; i < points.length; i += 1) {
    const next = points[(i + 1) % points.length];
    const dx = next.x - points[i].x;
    const dy = next.y - points[i].y;
    perimeter += Math.sqrt(dx * dx + dy * dy);
  }
  return perimeter;
};

/**
 * Simplify with Douglas-Peucker.  Epsilon defaults to 1.5 % of
 * perimeter (configurable via `options.epsilonPercent`).
 */
export const simplifyContour = (contour, options = {}) => {
  if (!contour || contour.length < 3) return contour ?? [];

  const epsilonPct = options.epsilonPercent ?? 0.015;
  const perimeter = computePerimeter(contour);
  const epsilon = perimeter * epsilonPct;

  const closed = contour.concat(contour[0]);
  const simplified = simplifyRdp(closed, epsilon).slice(0, -1);
  return simplified.length >= 3 ? simplified : contour;
};

/* ------------------------------------------------------------------ */
/*  Step 6 – Post-processing                                           */
/* ------------------------------------------------------------------ */

/** Signed area (positive ↔ clockwise in screen / image coordinates). */
const signedArea = (points) => {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const j = (i + 1) % points.length;
    area += points[i].x * points[j].y - points[j].x * points[i].y;
  }
  return area / 2;
};

/** Drop vertices whose perpendicular distance to the prev→next line
 *  is below `threshold`. */
const removeNearlyCollinear = (points, threshold) => {
  if (points.length < 3) return points;
  const result = [];
  for (let i = 0; i < points.length; i += 1) {
    const prev = points[(i - 1 + points.length) % points.length];
    const curr = points[i];
    const next = points[(i + 1) % points.length];
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1e-6) continue;
    const dist = Math.abs((curr.x - prev.x) * dy - (curr.y - prev.y) * dx) / len;
    if (dist >= threshold) result.push(curr);
  }
  return result.length >= 3 ? result : points;
};

/** Remove consecutive points closer than `threshold`. */
const removeDuplicates = (points, threshold) => {
  if (points.length < 2) return points;
  const result = [points[0]];
  for (let i = 1; i < points.length; i += 1) {
    const prev = result[result.length - 1];
    const dx = points[i].x - prev.x;
    const dy = points[i].y - prev.y;
    if (Math.sqrt(dx * dx + dy * dy) >= threshold) result.push(points[i]);
  }
  return result;
};

/**
 * Ensure clockwise winding, then remove nearly-collinear and duplicate
 * vertices.
 */
export const postProcessContour = (polygon, options = {}) => {
  if (!polygon || polygon.length < 3) return polygon ?? [];

  let points = [...polygon];
  if (signedArea(points) < 0) points.reverse();

  const collinearThreshold = options.collinearThreshold ?? 2.0;
  points = removeNearlyCollinear(points, collinearThreshold);
  points = removeDuplicates(points, options.duplicateThreshold ?? 2.0);
  return points;
};

/* ------------------------------------------------------------------ */
/*  Main pipeline                                                      */
/* ------------------------------------------------------------------ */

/**
 * Full exterior-wall-outline extraction pipeline.
 *
 * Returns `{ outer, inner, debug }` where `outer` is the ordered list
 * of polygon vertices, or `null` on failure.
 */
export const traceFloorplanBoundaryCore = (imageData, options = {}) => {
  if (!imageData?.data || !imageData.width || !imageData.height) return null;

  const { width, height } = imageData;

  // Step 1 – Preprocess (full resolution)
  const { binary } = preprocessImage(imageData, options);

  // Steps 2–3 run at reduced resolution so that morphological radii
  // can bridge door / window gaps without being prohibitively expensive.
  const maxWorkDim = options.maxWorkDimension ?? 500;
  const longest = Math.max(width, height);
  const workScale = longest > maxWorkDim ? maxWorkDim / longest : 1;
  const ww = Math.max(1, Math.round(width * workScale));
  const wh = Math.max(1, Math.round(height * workScale));

  const workBinary = workScale < 1
    ? resizeNearest(binary, width, height, ww, wh)
    : binary;

  // Adaptive radii relative to working resolution
  const closeR = options.closeRadius ?? Math.max(5, Math.round(Math.min(ww, wh) * 0.04));
  // Skip opening at reduced resolution – thin walls would be destroyed.
  // Noise is handled by CC removal and the exterior fill itself.
  const minArea = options.minComponentArea ?? Math.max(50, Math.round(ww * wh * 0.002));

  // Step 2 – Clean binary mask (close + remove small CCs, no opening)
  let workMask = closeMask(workBinary, ww, wh, closeR);
  workMask = removeSmallComponents(workMask, ww, wh, minArea);

  // Step 3 – Exterior flood-fill
  const filled = fillExterior(workMask, ww, wh);

  // Upscale back to full resolution
  const filledFull = workScale < 1
    ? resizeNearest(filled, ww, wh, width, height)
    : filled;

  // Step 4 – Extract outer contour (full resolution for detail)
  const contour = extractOuterContour(filledFull, width, height);
  if (!contour) return null;

  // Step 5 – Simplify
  const simplified = simplifyContour(contour, options);

  // Step 6 – Post-process
  const polygon = postProcessContour(simplified, options);
  if (polygon.length < 3) return null;

  const area = Math.abs(signedArea(polygon));
  const imageArea = width * height;

  return {
    outer: polygon,
    inner: null,
    debug: {
      area,
      vertices: polygon.length,
      areaRatio: area / imageArea,
    },
  };
};

export const boundaryByMode = (result, wallMode = 'inner') => {
  if (!result) return null;
  if (wallMode === 'outer') return result.outer ?? result.inner;
  return result.inner ?? result.outer;
};

/* ------------------------------------------------------------------ */
/*  Full pipeline: boundary + rooms + OCR + scale                      */
/* ------------------------------------------------------------------ */

/**
 * Run the complete floorplan processing pipeline.
 *
 * 1. Preprocess → binary mask (walls = 1)
 * 2. Clean binary mask (close + open + CC removal)
 * 3. Detect outer boundary
 * 4. Segment rooms from cleaned wall mask
 * 5. Extract room features (contours, bbox, centroid)
 * 6. Assign OCR text to rooms
 * 7. Compute scale
 *
 * @param {ImageData}   imageData   RGBA image
 * @param {Array}       [ocrResults=[]]  OCR items: { text, bbox: {x,y,w,h} }
 * @param {object}      [options]
 * @returns {object}    Full pipeline result
 */
export const runFullPipeline = (imageData, ocrResults = [], options = {}) => {
  if (!imageData?.data || !imageData.width || !imageData.height) return null;

  const { width, height } = imageData;
  const warnings = [];

  // Step 1 – Preprocess
  const { binary, threshold } = preprocessImage(imageData, options);

  // Step 2a – Clean binary for outer boundary (close + open + CC removal)
  const cleanedWalls = cleanBinary(binary, width, height, {
    closeRadius: options.closeRadius ?? 3,
    openRadius: options.openRadius ?? 2,
    minComponentArea: options.minComponentArea ?? Math.max(100, Math.round(width * height * 0.001)),
  });

  // Step 2b – Wall mask for room segmentation: closing only (no opening),
  //           so thin interior walls are preserved.
  const roomCloseR = options.roomCloseRadius ?? 2;
  const roomMinArea = options.roomMinComponentArea ?? Math.max(50, Math.round(width * height * 0.0005));
  let roomWallMask = closeMask(binary, width, height, roomCloseR);
  roomWallMask = removeSmallComponents(roomWallMask, width, height, roomMinArea);

  // Step 3 – Outer boundary (uses existing pipeline)
  const boundaryResult = traceFloorplanBoundaryCore(imageData, options);

  // Step 4 – Room segmentation (use wall mask that preserves interior walls)
  const gapCloseRadius = options.gapCloseRadius ?? Math.max(3, Math.round(Math.min(width, height) * 0.01));
  const { labels: roomLabels, rooms: roomComponents, closedWalls } = segmentRooms(
    roomWallMask, width, height, { gapCloseRadius, ...options },
  );

  // Step 5 – Extract room features
  const rooms = extractRoomFeatures(roomLabels, roomComponents, width, height, options);

  if (rooms.length === 0) {
    warnings.push('No rooms detected');
  } else if (rooms.length < 2) {
    warnings.push('Very few rooms detected — possible segmentation issue');
  }

  // Step 6 – OCR assignment
  const ocrResult = assignTextToRooms(rooms, ocrResults);
  if (ocrResults.length > 0 && ocrResult.unassigned.length > 0) {
    warnings.push(`${ocrResult.unassigned.length} OCR item(s) not assigned to any room`);
  }

  // Step 7 – Scale computation
  const scale = computeScale(rooms);

  // Logging
  const log = {
    roomCount: rooms.length,
    ocrAssigned: ocrResult.assigned,
    ocrUnassigned: ocrResult.unassigned.length,
    scale: scale ? { mean: scale.meanScale, std: scale.stdScale } : null,
    warnings,
  };

  return {
    binary,
    cleanedWalls,
    closedWalls,
    boundary: boundaryResult,
    roomLabels,
    rooms,
    ocrResult,
    scale,
    threshold,
    log,
    width,
    height,
  };
};
