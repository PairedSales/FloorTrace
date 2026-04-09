import { toGrayscale, boxBlurGray, resizeNearest } from './preprocess';
import { closeMask, openMask } from './wallMask';
import { labelConnectedComponents, mooreBoundaryTrace, simplifyRdp } from './vectorize';
import { segmentRooms, extractRoomFeatures, pointInPolygon, pointInBbox } from './roomSegmentation';
import { assignTextToRooms, computeScale } from './ocrMapping';

/**
 * Detect the room enclosure at a given click point.
 *
 * Runs room segmentation on the image, then finds which room
 * contains the click point using point-in-polygon / bbox tests.
 *
 * @param {ImageData}    imageData   RGBA image
 * @param {{x,y}}        clickPoint  Click coordinates in image space
 * @param {object}       [options]
 * @returns {object|null}  { overlay, polygon, confidence, debug }
 */
export const detectRoomFromClickCore = (imageData, clickPoint, options = {}) => {
  if (!imageData?.data || !imageData.width || !imageData.height || !clickPoint) return null;

  const { width, height } = imageData;

  // Step 1 – Preprocess to get binary wall mask
  const { binary } = preprocessImage(imageData, options);

  // Step 2 – Prepare wall mask for room segmentation (closing only, no opening)
  const roomCloseR = options.roomCloseRadius ?? 2;
  const roomMinArea = options.roomMinComponentArea ?? Math.max(50, Math.round(width * height * 0.0005));
  let roomWallMask = closeMask(binary, width, height, roomCloseR);
  roomWallMask = removeSmallComponents(roomWallMask, width, height, roomMinArea);

  // Step 3 – Segment rooms
  const gapCloseRadius = options.gapCloseRadius ?? Math.max(3, Math.round(Math.min(width, height) * 0.01));
  const { labels: roomLabels, rooms: roomComponents } = segmentRooms(
    roomWallMask, width, height, { gapCloseRadius, ...options },
  );

  // Step 4 – Extract room features (contours, bboxes)
  const rooms = extractRoomFeatures(roomLabels, roomComponents, width, height, options);
  if (rooms.length === 0) return null;

  // Step 5 – Find the room containing the click point
  let bestRoom = null;

  // First try precise point-in-polygon test
  for (const room of rooms) {
    if (pointInPolygon(room.contour, clickPoint)) {
      if (!bestRoom || room.area < bestRoom.area) {
        bestRoom = room;
      }
    }
  }

  // Fallback to bounding-box test if polygon test fails
  if (!bestRoom) {
    for (const room of rooms) {
      if (pointInBbox(room.bbox, clickPoint)) {
        if (!bestRoom || room.area < bestRoom.area) {
          bestRoom = room;
        }
      }
    }
  }

  if (!bestRoom) return null;

  const { bbox, contour } = bestRoom;
  return {
    overlay: {
      x1: bbox.minX,
      y1: bbox.minY,
      x2: bbox.maxX,
      y2: bbox.maxY,
    },
    polygon: contour,
    confidence: contour.length >= 3 ? 0.8 : 0.4,
    debug: {
      roomCount: rooms.length,
      selectedRoomId: bestRoom.id,
      selectedRoomArea: bestRoom.area,
    },
  };
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
  const polygon = wallMode === 'outer'
    ? (result.outer ?? result.inner)
    : (result.inner ?? result.outer);
  return polygon ? { polygon } : null;
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
