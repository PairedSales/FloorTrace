/**
 * Wall Detection Pipeline — Brand-new, independent of existing wall-finding code.
 *
 * Stages:
 *  1. Preprocessing        – grayscale, binarization, noise reduction
 *  2. OCR Text Masking     – remove OCR bounding-box regions from wall mask
 *  3. Wall Candidate Extraction – edge detection, morphology, line segments
 *  4. Structural Interpretation – segment grouping, snapping, graph building
 *  5. Interior Room Detection   – closed polygons, OCR text → room match
 *  6. Exterior Perimeter        – outermost boundary
 *  7. Polygon Refinement        – gap closing, orthogonal snapping
 *  8. Validation / Scoring      – continuity, enclosure, orthogonality
 *
 * All intermediate results are returned in a `debug` object for overlay rendering.
 */

// ─── Tuneable parameters ────────────────────────────────────────────────────

const PARAMS = {
  // Stage 1
  maxDimension: 1400,
  blurRadius: 1,
  binaryThreshold: 180,        // Global brightness threshold (0–255)

  // Stage 2 – OCR masking
  ocrPaddingPx: 8,             // Extra pixels around OCR bboxes

  // Stage 3 – Wall candidates
  cannyLow: 30,
  cannyHigh: 80,
  morphCloseRadius: 3,         // Close gaps in edge map
  minSegmentLength: 20,        // Ignore tiny segments (Hough-style)
  houghAngleTolDeg: 5,         // Deviation from H/V for classification

  // Stage 4 – Structural
  snapTolerance: 8,            // Endpoint snap distance
  collinearAngleTol: 4,        // Degrees for merging collinear segments
  collinearGapTol: 12,         // Max gap between collinear endpoints

  // Stage 5 – Room detection
  roomCloseRadiusPct: 0.04,    // Close radius as fraction of min dimension (bridges door gaps)
  minRoomArea: 0.002,          // Fraction of image area
  maxRoomArea: 0.8,

  // Stage 6 – Exterior perimeter
  exteriorCloseRadius: 6,
  minExteriorArea: 0.05,

  // Stage 7 – Refinement
  orthogonalSnapDeg: 6,        // Snap near-H/V edges
  simplifyEpsilon: 2.0,        // RDP simplification

  // Stage 8 – Scoring weights
  scoreContinuity: 0.3,
  scoreEnclosure: 0.3,
  scoreOrthogonality: 0.2,
  scoreThicknessConsistency: 0.2,
};

// Iteration limits for Moore boundary tracing (prevent infinite loops on complex contours)
const ROOM_CONTOUR_ITER_MULTIPLIER = 8;   // max iterations = perim × this
const ROOM_CONTOUR_ITER_MIN = 50000;
const EXTERIOR_CONTOUR_ITER_MULTIPLIER = 8;
const EXTERIOR_CONTOUR_ITER_MIN = 100000;
const MIN_MORPH_CLOSE_RADIUS = 3;         // minimum pixel radius for morphological close

// ─── Stage 1: Preprocessing ─────────────────────────────────────────────────

/**
 * Convert RGBA ImageData to grayscale Uint8ClampedArray.
 * Uses ITU-R BT.601 luma coefficients: 0.299·R + 0.587·G + 0.114·B.
 */
export function toGrayscale(rgba, width, height) {
  const gray = new Uint8ClampedArray(width * height);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j++) {
    gray[j] = Math.round((rgba[i] * 299 + rgba[i + 1] * 587 + rgba[i + 2] * 114) / 1000);
  }
  return gray;
}

/**
 * Box blur on grayscale array.
 */
export function boxBlur(gray, width, height, radius) {
  if (radius <= 0) return gray;
  const out = new Uint8ClampedArray(gray.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0, count = 0;
      for (let ky = -radius; ky <= radius; ky++) {
        const py = y + ky;
        if (py < 0 || py >= height) continue;
        for (let kx = -radius; kx <= radius; kx++) {
          const px = x + kx;
          if (px < 0 || px >= width) continue;
          sum += gray[py * width + px];
          count++;
        }
      }
      out[y * width + x] = Math.round(sum / count);
    }
  }
  return out;
}

/**
 * Global threshold → binary mask (1 = wall/dark, 0 = background).
 */
export function globalThreshold(gray, width, height, threshold) {
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < gray.length; i++) {
    mask[i] = gray[i] < threshold ? 1 : 0;
  }
  return mask;
}

/**
 * Nearest-neighbour resize for grayscale or binary arrays.
 */
export function resizeNearest(source, srcW, srcH, dstW, dstH) {
  const dst = new Uint8Array(dstW * dstH);
  const sx = srcW / dstW;
  const sy = srcH / dstH;
  for (let y = 0; y < dstH; y++) {
    const oy = Math.min(srcH - 1, Math.floor(y * sy));
    for (let x = 0; x < dstW; x++) {
      const ox = Math.min(srcW - 1, Math.floor(x * sx));
      dst[y * dstW + x] = source[oy * srcW + ox];
    }
  }
  return dst;
}

/**
 * Full preprocessing: normalize size, grayscale, blur, binarize.
 * Returns { gray, wallMask, width, height, scale }.
 */
export function preprocess(imageData, params = PARAMS) {
  const origW = imageData.width;
  const origH = imageData.height;
  const longest = Math.max(origW, origH);
  const scale = longest > params.maxDimension ? params.maxDimension / longest : 1;
  const w = Math.max(1, Math.round(origW * scale));
  const h = Math.max(1, Math.round(origH * scale));

  let gray = toGrayscale(imageData.data, origW, origH);
  gray = boxBlur(gray, origW, origH, params.blurRadius);
  if (scale !== 1) gray = resizeNearest(gray, origW, origH, w, h);
  const wallMask = globalThreshold(gray, w, h, params.binaryThreshold);
  return { gray, wallMask, width: w, height: h, scale, origW, origH };
}

// ─── Stage 2: OCR Text Masking ──────────────────────────────────────────────

/**
 * Zero-out wall pixels inside (padded) OCR bounding boxes.
 * Modifies `wallMask` in place and returns list of masked regions.
 */
export function maskOcrRegions(wallMask, width, height, scale, ocrBoxes, params = PARAMS) {
  const padding = params.ocrPaddingPx;
  const regions = [];
  if (!ocrBoxes || ocrBoxes.length === 0) return { wallMask, regions };

  for (const dim of ocrBoxes) {
    const bbox = dim.bbox;
    if (!bbox) continue;
    const x0 = Math.max(0, Math.floor(bbox.x * scale) - padding);
    const y0 = Math.max(0, Math.floor(bbox.y * scale) - padding);
    const x1 = Math.min(width - 1, Math.ceil((bbox.x + bbox.width) * scale) + padding);
    const y1 = Math.min(height - 1, Math.ceil((bbox.y + bbox.height) * scale) + padding);
    regions.push({ x0, y0, x1, y1 });
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        wallMask[y * width + x] = 0;
      }
    }
  }
  return { wallMask, regions };
}

// ─── Stage 3: Wall Candidate Extraction ─────────────────────────────────────

/**
 * Simple Sobel-based edge magnitude.
 */
export function sobelEdges(gray, width, height) {
  const mag = new Float32Array(width * height);
  const dirX = new Float32Array(width * height);
  const dirY = new Float32Array(width * height);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const gx =
        -gray[(y - 1) * width + (x - 1)] - 2 * gray[y * width + (x - 1)] - gray[(y + 1) * width + (x - 1)] +
         gray[(y - 1) * width + (x + 1)] + 2 * gray[y * width + (x + 1)] + gray[(y + 1) * width + (x + 1)];
      const gy =
        -gray[(y - 1) * width + (x - 1)] - 2 * gray[(y - 1) * width + x] - gray[(y - 1) * width + (x + 1)] +
         gray[(y + 1) * width + (x - 1)] + 2 * gray[(y + 1) * width + x] + gray[(y + 1) * width + (x + 1)];
      mag[idx] = Math.sqrt(gx * gx + gy * gy);
      dirX[idx] = gx;
      dirY[idx] = gy;
    }
  }
  return { mag, dirX, dirY };
}

/**
 * Double-threshold Canny-style edge thinning (simplified: no non-max suppression).
 * Returns binary edge mask.
 */
export function cannyEdges(gray, width, height, params = PARAMS) {
  const { mag } = sobelEdges(gray, width, height);
  const edge = new Uint8Array(width * height);

  // Normalize magnitude
  let maxMag = 0;
  for (let i = 0; i < mag.length; i++) if (mag[i] > maxMag) maxMag = mag[i];
  if (maxMag === 0) return edge;

  const low = params.cannyLow / 255 * maxMag;
  const high = params.cannyHigh / 255 * maxMag;

  // Strong and weak edges
  const STRONG = 2, WEAK = 1;
  for (let i = 0; i < mag.length; i++) {
    if (mag[i] >= high) edge[i] = STRONG;
    else if (mag[i] >= low) edge[i] = WEAK;
  }

  // Hysteresis: promote weak edges connected to strong
  let changed = true;
  while (changed) {
    changed = false;
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        if (edge[idx] !== WEAK) continue;
        // Check 8-neighbours for strong
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (edge[(y + dy) * width + (x + dx)] === STRONG) {
              edge[idx] = STRONG;
              changed = true;
              break;
            }
          }
          if (edge[idx] === STRONG) break;
        }
      }
    }
  }

  // Only keep strong edges
  for (let i = 0; i < edge.length; i++) edge[i] = edge[i] === STRONG ? 1 : 0;
  return edge;
}

/**
 * Morphological close on binary mask: dilate then erode.
 */
export function morphClose(mask, width, height, radius) {
  if (radius <= 0) return mask;
  const dilated = dilate(mask, width, height, radius);
  return erode(dilated, width, height, radius);
}

/**
 * Dilate binary mask.
 */
export function dilate(mask, width, height, radius) {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let found = false;
      for (let dy = -radius; dy <= radius && !found; dy++) {
        const py = y + dy;
        if (py < 0 || py >= height) continue;
        for (let dx = -radius; dx <= radius && !found; dx++) {
          const px = x + dx;
          if (px < 0 || px >= width) continue;
          if (mask[py * width + px]) found = true;
        }
      }
      out[y * width + x] = found ? 1 : 0;
    }
  }
  return out;
}

/**
 * Erode binary mask.
 */
export function erode(mask, width, height, radius) {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let allSet = true;
      for (let dy = -radius; dy <= radius && allSet; dy++) {
        const py = y + dy;
        if (py < 0 || py >= height) { allSet = false; continue; }
        for (let dx = -radius; dx <= radius && allSet; dx++) {
          const px = x + dx;
          if (px < 0 || px >= width) { allSet = false; continue; }
          if (!mask[py * width + px]) allSet = false;
        }
      }
      out[y * width + x] = allSet ? 1 : 0;
    }
  }
  return out;
}

/**
 * Extract horizontal and vertical line segments from a binary wall/edge mask
 * using run-length encoding approach.
 *
 * Returns { horizontal: [...], vertical: [...] } where each segment is
 * { x0, y0, x1, y1 }.
 */
export function extractLineSegments(mask, width, height, params = PARAMS) {
  const minLen = params.minSegmentLength;
  const horizontal = [];
  const vertical = [];

  // Horizontal runs
  for (let y = 0; y < height; y++) {
    let runStart = -1;
    for (let x = 0; x <= width; x++) {
      const on = x < width && mask[y * width + x];
      if (on && runStart < 0) runStart = x;
      else if (!on && runStart >= 0) {
        if (x - runStart >= minLen) {
          horizontal.push({ x0: runStart, y0: y, x1: x - 1, y1: y });
        }
        runStart = -1;
      }
    }
  }

  // Vertical runs
  for (let x = 0; x < width; x++) {
    let runStart = -1;
    for (let y = 0; y <= height; y++) {
      const on = y < height && mask[y * width + x];
      if (on && runStart < 0) runStart = y;
      else if (!on && runStart >= 0) {
        if (y - runStart >= minLen) {
          vertical.push({ x0: x, y0: runStart, x1: x, y1: y - 1 });
        }
        runStart = -1;
      }
    }
  }

  return { horizontal, vertical };
}

/**
 * Combine wall mask + edge detection → cleaned wall candidate mask.
 * Applies morphological close to bridge small gaps.
 */
export function extractWallCandidates(wallMask, gray, width, height, params = PARAMS) {
  // Get edge map
  const edgeMap = cannyEdges(gray, width, height, params);

  // Combine: union of wall mask and edge map
  const combined = new Uint8Array(width * height);
  for (let i = 0; i < combined.length; i++) {
    combined[i] = wallMask[i] || edgeMap[i] ? 1 : 0;
  }

  // Morphological close to bridge gaps
  const closed = morphClose(combined, width, height, params.morphCloseRadius);

  // Extract line segments from closed mask
  const segments = extractLineSegments(closed, width, height, params);

  return { edgeMap, combined, closed, segments };
}

// ─── Stage 4: Structural Interpretation ─────────────────────────────────────

/**
 * Snap endpoints that are within tolerance to each other.
 */
export function snapEndpoints(segments, tolerance) {
  const allSegs = [...segments];
  const points = [];
  for (const seg of allSegs) {
    points.push({ x: seg.x0, y: seg.y0, seg, which: 'start' });
    points.push({ x: seg.x1, y: seg.y1, seg, which: 'end' });
  }

  // Cluster points within tolerance
  const visited = new Set();
  const clusters = [];
  for (let i = 0; i < points.length; i++) {
    if (visited.has(i)) continue;
    const cluster = [i];
    visited.add(i);
    for (let j = i + 1; j < points.length; j++) {
      if (visited.has(j)) continue;
      const dx = points[i].x - points[j].x;
      const dy = points[i].y - points[j].y;
      if (Math.sqrt(dx * dx + dy * dy) <= tolerance) {
        cluster.push(j);
        visited.add(j);
      }
    }
    clusters.push(cluster);
  }

  // Move all points in a cluster to their centroid
  for (const cluster of clusters) {
    if (cluster.length < 2) continue;
    let cx = 0, cy = 0;
    for (const idx of cluster) { cx += points[idx].x; cy += points[idx].y; }
    cx = Math.round(cx / cluster.length);
    cy = Math.round(cy / cluster.length);
    for (const idx of cluster) {
      const p = points[idx];
      if (p.which === 'start') { p.seg.x0 = cx; p.seg.y0 = cy; }
      else { p.seg.x1 = cx; p.seg.y1 = cy; }
    }
  }

  return allSegs;
}

/**
 * Merge collinear segments that are close together.
 */
export function mergeCollinear(segments, angleTol, gapTol) {
  const angleOf = (s) => Math.atan2(s.y1 - s.y0, s.x1 - s.x0) * 180 / Math.PI;
  const lenOf = (s) => Math.sqrt((s.x1 - s.x0) ** 2 + (s.y1 - s.y0) ** 2);

  const merged = [];
  const used = new Set();

  // Sort by angle then position for efficient grouping
  const indexed = segments.map((s, i) => ({ s, i, angle: angleOf(s) }));
  indexed.sort((a, b) => a.angle - b.angle);

  for (let i = 0; i < indexed.length; i++) {
    if (used.has(indexed[i].i)) continue;
    let current = { ...indexed[i].s };
    used.add(indexed[i].i);
    const curAngle = indexed[i].angle;

    for (let j = i + 1; j < indexed.length; j++) {
      if (used.has(indexed[j].i)) continue;
      const a2 = indexed[j].angle;
      let angleDiff = Math.abs(curAngle - a2);
      if (angleDiff > 90) angleDiff = 180 - angleDiff;
      if (angleDiff > angleTol) continue;

      const other = indexed[j].s;
      // Check if segments are close enough to merge
      const isHorizontal = Math.abs(curAngle) < 45 || Math.abs(curAngle) > 135;
      if (isHorizontal) {
        // Horizontal: similar y, overlapping or close in x
        const yDiff = Math.abs((current.y0 + current.y1) / 2 - (other.y0 + other.y1) / 2);
        if (yDiff > gapTol) continue;
        const minX = Math.min(current.x0, current.x1, other.x0, other.x1);
        const maxX = Math.max(current.x0, current.x1, other.x0, other.x1);
        const combinedLen = lenOf(current) + lenOf(other);
        const spanLen = maxX - minX;
        if (spanLen - combinedLen > gapTol) continue;
        // Merge
        const avgY = Math.round((current.y0 + current.y1 + other.y0 + other.y1) / 4);
        current = { x0: minX, y0: avgY, x1: maxX, y1: avgY };
      } else {
        // Vertical: similar x, overlapping or close in y
        const xDiff = Math.abs((current.x0 + current.x1) / 2 - (other.x0 + other.x1) / 2);
        if (xDiff > gapTol) continue;
        const minY = Math.min(current.y0, current.y1, other.y0, other.y1);
        const maxY = Math.max(current.y0, current.y1, other.y0, other.y1);
        const combinedLen = lenOf(current) + lenOf(other);
        const spanLen = maxY - minY;
        if (spanLen - combinedLen > gapTol) continue;
        const avgX = Math.round((current.x0 + current.x1 + other.x0 + other.x1) / 4);
        current = { x0: avgX, y0: minY, x1: avgX, y1: maxY };
      }
      used.add(indexed[j].i);
    }
    merged.push(current);
  }
  return merged;
}

/**
 * Detect junctions (T, L, +) where segments meet.
 * Returns array of { x, y, type, segmentIndices }.
 */
export function detectJunctions(segments, tolerance) {
  const junctions = [];
  const endpoints = [];
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    endpoints.push({ x: s.x0, y: s.y0, segIdx: i });
    endpoints.push({ x: s.x1, y: s.y1, segIdx: i });
  }

  // Cluster endpoints
  const visited = new Set();
  for (let i = 0; i < endpoints.length; i++) {
    if (visited.has(i)) continue;
    const cluster = [i];
    visited.add(i);
    for (let j = i + 1; j < endpoints.length; j++) {
      if (visited.has(j)) continue;
      const dx = endpoints[i].x - endpoints[j].x;
      const dy = endpoints[i].y - endpoints[j].y;
      if (Math.sqrt(dx * dx + dy * dy) <= tolerance) {
        cluster.push(j);
        visited.add(j);
      }
    }
    if (cluster.length >= 2) {
      let cx = 0, cy = 0;
      const segIndices = new Set();
      for (const idx of cluster) {
        cx += endpoints[idx].x;
        cy += endpoints[idx].y;
        segIndices.add(endpoints[idx].segIdx);
      }
      cx = Math.round(cx / cluster.length);
      cy = Math.round(cy / cluster.length);

      let type;
      if (segIndices.size === 2) type = 'L';
      else if (segIndices.size === 3) type = 'T';
      else if (segIndices.size >= 4) type = '+';
      else type = 'L';

      junctions.push({ x: cx, y: cy, type, segmentIndices: [...segIndices] });
    }
  }
  return junctions;
}

/**
 * Build a graph representation from segments.
 * Returns { nodes: [{x, y}], adjacency: Map<nodeIdx, [nodeIdx]> }
 */
export function buildWallGraph(segments, junctions) {
  const nodeMap = new Map();
  const nodes = [];
  const adjacency = new Map();

  const getOrCreateNode = (x, y) => {
    const key = `${x},${y}`;
    if (nodeMap.has(key)) return nodeMap.get(key);
    const idx = nodes.length;
    nodes.push({ x, y });
    nodeMap.set(key, idx);
    adjacency.set(idx, []);
    return idx;
  };

  // Add junction nodes
  for (const j of junctions) {
    getOrCreateNode(j.x, j.y);
  }

  // Add segment endpoints and edges
  for (const seg of segments) {
    const n0 = getOrCreateNode(seg.x0, seg.y0);
    const n1 = getOrCreateNode(seg.x1, seg.y1);
    if (n0 !== n1) {
      adjacency.get(n0).push(n1);
      adjacency.get(n1).push(n0);
    }
  }

  return { nodes, adjacency };
}

/**
 * Run full structural interpretation pipeline.
 */
export function interpretStructure(rawSegments, params = PARAMS) {
  const allSegs = [...rawSegments.horizontal, ...rawSegments.vertical];
  const snapped = snapEndpoints(allSegs, params.snapTolerance);
  const merged = mergeCollinear(snapped, params.collinearAngleTol, params.collinearGapTol);
  const junctions = detectJunctions(merged, params.snapTolerance);
  const graph = buildWallGraph(merged, junctions);
  return { snapped, merged, junctions, graph };
}

// ─── Stage 5: Interior Room Detection ───────────────────────────────────────

/**
 * Find closed polygonal regions from the wall mask using connected-component
 * analysis on the inverted mask (flood-fill background regions).
 *
 * Applies morphological closing before CC detection to bridge door gaps.
 *
 * Returns { regions: [{ id, polygon, area, areaFrac, centroid, bbox }], labels, closedMask }.
 */
export function findClosedRegions(wallMask, width, height, params = PARAMS) {
  // Close door gaps with aggressive morphological close
  // Use 4% of smaller dimension by default — this bridges typical door gaps
  const closeRadius = params.roomCloseRadius ??
    Math.max(MIN_MORPH_CLOSE_RADIUS, Math.round((params.roomCloseRadiusPct ?? 0.04) * Math.min(width, height)));
  const closedMask = closeRadius > 0 ? morphClose(wallMask, width, height, closeRadius) : wallMask;

  // Invert: background (non-wall) becomes foreground
  const inverted = new Uint8Array(width * height);
  for (let i = 0; i < inverted.length; i++) inverted[i] = closedMask[i] ? 0 : 1;

  // Connected-component labeling (4-connected)
  const labels = new Int32Array(width * height);
  let nextLabel = 1;
  const totalPixels = width * height;

  // Collect region info during single BFS pass
  const regionMap = new Map();

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (!inverted[idx] || labels[idx]) continue;

      const label = nextLabel++;
      const queue = [idx];
      labels[idx] = label;
      let area = 0, sumX = 0, sumY = 0;
      let minX = x, maxX = x, minY = y, maxY = y;
      let touchesBorder = false;

      while (queue.length > 0) {
        const ci = queue.shift();
        const cx = ci % width;
        const cy = (ci - cx) / width;
        area++;
        sumX += cx;
        sumY += cy;
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;
        if (cx === 0 || cy === 0 || cx === width - 1 || cy === height - 1) touchesBorder = true;

        if (cx > 0 && inverted[ci - 1] && !labels[ci - 1]) { labels[ci - 1] = label; queue.push(ci - 1); }
        if (cx < width - 1 && inverted[ci + 1] && !labels[ci + 1]) { labels[ci + 1] = label; queue.push(ci + 1); }
        if (cy > 0 && inverted[ci - width] && !labels[ci - width]) { labels[ci - width] = label; queue.push(ci - width); }
        if (cy < height - 1 && inverted[ci + width] && !labels[ci + width]) { labels[ci + width] = label; queue.push(ci + width); }
      }

      regionMap.set(label, { area, sumX, sumY, minX, maxX, minY, maxY, touchesBorder });
    }
  }

  const regions = [];
  for (const [lbl, r] of regionMap) {
    if (r.touchesBorder) continue;
    const areaFrac = r.area / totalPixels;
    if (areaFrac < params.minRoomArea || areaFrac > params.maxRoomArea) continue;
    const polygon = traceRegionContour(labels, width, height, lbl, r.minX, r.minY, r.maxX, r.maxY);
    if (polygon.length >= 3) {
      regions.push({
        id: lbl,
        polygon,
        area: r.area,
        areaFrac,
        centroid: { x: Math.round(r.sumX / r.area), y: Math.round(r.sumY / r.area) },
        bbox: { x0: r.minX, y0: r.minY, x1: r.maxX, y1: r.maxY },
      });
    }
  }

  return { regions, labels, closedMask };
}

/**
 * Trace the outer contour of a labelled region using Moore neighbourhood tracing.
 * Returns array of {x, y} points.
 */
export function traceRegionContour(labels, width, height, label, minX, minY, maxX, maxY) {
  // Find start pixel: topmost, then leftmost
  let startX = -1, startY = -1;
  outer:
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (labels[y * width + x] === label) {
        startX = x;
        startY = y;
        break outer;
      }
    }
  }
  if (startX < 0) return [];

  const contour = [];
  // Moore neighbourhood: 8 directions starting from W
  const dx8 = [-1, -1, 0, 1, 1, 1, 0, -1];
  const dy8 = [0, -1, -1, -1, 0, 1, 1, 1];

  let cx = startX, cy = startY;
  // We found the topmost-leftmost pixel, so we "entered" from the west.
  // dir = direction of last move. Since start pixel is leftmost, backtrack
  // is to the west, so we "moved east" to get here → dir = 4 (E).
  let dir = 4;
  const perim = 2 * ((maxX - minX) + (maxY - minY));
  const maxIter = Math.max(perim * ROOM_CONTOUR_ITER_MULTIPLIER, ROOM_CONTOUR_ITER_MIN);
  let iter = 0;

  do {
    contour.push({ x: cx, y: cy });
    // Look for next contour pixel
    let found = false;
    const startDir = (dir + 5) % 8; // backtrack direction + 1
    for (let i = 0; i < 8; i++) {
      const d = (startDir + i) % 8;
      const nx = cx + dx8[d];
      const ny = cy + dy8[d];
      if (nx >= 0 && nx < width && ny >= 0 && ny < height && labels[ny * width + nx] === label) {
        dir = d;
        cx = nx;
        cy = ny;
        found = true;
        break;
      }
    }
    if (!found) break;
    iter++;
  } while ((cx !== startX || cy !== startY) && iter < maxIter);

  // Simplify contour (subsample for performance)
  return simplifyRdp(contour, 2.0);
}

/**
 * Ramer-Douglas-Peucker polygon simplification.
 */
export function simplifyRdp(points, epsilon) {
  if (points.length <= 2) return points;

  // Find point with max distance from line between first and last
  let maxDist = 0;
  let maxIdx = 0;
  const first = points[0];
  const last = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i++) {
    const d = pointToLineDistSq(points[i], first, last);
    if (d > maxDist) {
      maxDist = d;
      maxIdx = i;
    }
  }

  if (Math.sqrt(maxDist) > epsilon) {
    const left = simplifyRdp(points.slice(0, maxIdx + 1), epsilon);
    const right = simplifyRdp(points.slice(maxIdx), epsilon);
    return [...left.slice(0, -1), ...right];
  }
  return [first, last];
}

function pointToLineDistSq(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return (p.x - a.x) ** 2 + (p.y - a.y) ** 2;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;
  return (p.x - projX) ** 2 + (p.y - projY) ** 2;
}

/**
 * Match OCR text position to containing region.
 * Returns the region whose bbox contains the OCR centroid, or null.
 */
export function matchOcrToRegion(regions, ocrBoxes, scale) {
  if (!ocrBoxes || ocrBoxes.length === 0 || regions.length === 0) return null;

  for (const dim of ocrBoxes) {
    const bbox = dim.bbox;
    if (!bbox) continue;
    const cx = Math.round((bbox.x + bbox.width / 2) * scale);
    const cy = Math.round((bbox.y + bbox.height / 2) * scale);

    // Find region containing this point
    for (const region of regions) {
      if (cx >= region.bbox.x0 && cx <= region.bbox.x1 &&
          cy >= region.bbox.y0 && cy <= region.bbox.y1) {
        return { region, ocrBox: dim, ocrCenter: { x: cx, y: cy } };
      }
    }
  }

  // Fallback: find closest region centroid
  let best = null;
  let bestDist = Infinity;
  for (const dim of ocrBoxes) {
    const bbox = dim.bbox;
    if (!bbox) continue;
    const cx = Math.round((bbox.x + bbox.width / 2) * scale);
    const cy = Math.round((bbox.y + bbox.height / 2) * scale);
    for (const region of regions) {
      const dx = cx - region.centroid.x;
      const dy = cy - region.centroid.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < bestDist) {
        bestDist = dist;
        best = { region, ocrBox: dim, ocrCenter: { x: cx, y: cy } };
      }
    }
  }
  return best;
}

// ─── Stage 6: Exterior Perimeter Detection ──────────────────────────────────

/**
 * Find the outermost boundary of the floorplan using morphological operations
 * and contour extraction on the wall mask.
 *
 * Strategy: close small gaps, flood-fill from borders to find exterior,
 * then extract the boundary between exterior and interior.
 */
export function findExteriorPerimeter(wallMask, width, height, params = PARAMS) {
  // Close gaps (doors/windows)
  const closed = morphClose(wallMask, width, height, params.exteriorCloseRadius);

  // Flood fill from all border pixels that are background
  const filled = new Uint8Array(width * height);
  const queue = [];

  // Seed from all four borders
  for (let x = 0; x < width; x++) {
    if (!closed[x]) { filled[x] = 1; queue.push(x); }
    const idx = (height - 1) * width + x;
    if (!closed[idx]) { filled[idx] = 1; queue.push(idx); }
  }
  for (let y = 0; y < height; y++) {
    const idx1 = y * width;
    if (!closed[idx1] && !filled[idx1]) { filled[idx1] = 1; queue.push(idx1); }
    const idx2 = y * width + width - 1;
    if (!closed[idx2] && !filled[idx2]) { filled[idx2] = 1; queue.push(idx2); }
  }

  // BFS flood fill exterior
  while (queue.length > 0) {
    const ci = queue.shift();
    const cx = ci % width;
    const cy = (ci - cx) / width;
    const neighbours = [];
    if (cx > 0) neighbours.push(ci - 1);
    if (cx < width - 1) neighbours.push(ci + 1);
    if (cy > 0) neighbours.push(ci - width);
    if (cy < height - 1) neighbours.push(ci + width);
    for (const ni of neighbours) {
      if (!closed[ni] && !filled[ni]) {
        filled[ni] = 1;
        queue.push(ni);
      }
    }
  }

  // Interior mask = not exterior and not wall
  // Building footprint = everything not in exterior flood fill (i.e., walls + rooms)
  const footprint = new Uint8Array(width * height);
  for (let i = 0; i < footprint.length; i++) {
    footprint[i] = filled[i] ? 0 : 1;
  }

  // Find largest connected component of footprint
  const ccLabels = new Int32Array(width * height);
  let nextLabel = 1;
  let largestLabel = 0, largestArea = 0;
  const ccAreas = new Map();

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (!footprint[idx] || ccLabels[idx]) continue;
      const label = nextLabel++;
      let area = 0;
      const q = [idx];
      ccLabels[idx] = label;
      while (q.length > 0) {
        const ci = q.shift();
        area++;
        const cx2 = ci % width;
        const cy2 = (ci - cx2) / width;
        if (cx2 > 0 && footprint[ci - 1] && !ccLabels[ci - 1]) { ccLabels[ci - 1] = label; q.push(ci - 1); }
        if (cx2 < width - 1 && footprint[ci + 1] && !ccLabels[ci + 1]) { ccLabels[ci + 1] = label; q.push(ci + 1); }
        if (cy2 > 0 && footprint[ci - width] && !ccLabels[ci - width]) { ccLabels[ci - width] = label; q.push(ci - width); }
        if (cy2 < height - 1 && footprint[ci + width] && !ccLabels[ci + width]) { ccLabels[ci + width] = label; q.push(ci + width); }
      }
      ccAreas.set(label, area);
      if (area > largestArea) { largestArea = area; largestLabel = label; }
    }
  }

  if (largestArea < params.minExteriorArea * width * height) {
    return { polygon: null, footprint, closed };
  }

  // Create mask of largest component only
  const largestMask = new Uint8Array(width * height);
  for (let i = 0; i < ccLabels.length; i++) {
    largestMask[i] = ccLabels[i] === largestLabel ? 1 : 0;
  }

  // Find bounding box of largest component
  let bMinX = width, bMinY = height, bMaxX = 0, bMaxY = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (largestMask[y * width + x]) {
        if (x < bMinX) bMinX = x;
        if (x > bMaxX) bMaxX = x;
        if (y < bMinY) bMinY = y;
        if (y > bMaxY) bMaxY = y;
      }
    }
  }

  // Moore boundary trace on largest component
  const polygon = mooreBoundaryTrace(largestMask, width, height, bMinX, bMinY, bMaxX, bMaxY);

  return { polygon: polygon.length >= 3 ? polygon : null, footprint, closed, largestMask };
}

/**
 * Moore neighbourhood boundary tracing for a binary mask.
 */
function mooreBoundaryTrace(mask, width, height, minX, minY, maxX, maxY) {
  // Find start pixel
  let startX = -1, startY = -1;
  outer:
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (mask[y * width + x]) {
        startX = x;
        startY = y;
        break outer;
      }
    }
  }
  if (startX < 0) return [];

  const dx8 = [-1, -1, 0, 1, 1, 1, 0, -1];
  const dy8 = [0, -1, -1, -1, 0, 1, 1, 1];
  const contour = [];
  let cx = startX, cy = startY, dir = 4; // entered from west → moved east
  // Use perimeter-based limit: boundary can be at most 2*(W+H) for convex, but
  // for complex shapes allow up to 8× the perimeter of the bounding box
  const perim = 2 * ((maxX - minX) + (maxY - minY));
  const maxIter = Math.max(perim * EXTERIOR_CONTOUR_ITER_MULTIPLIER, EXTERIOR_CONTOUR_ITER_MIN);
  let iter = 0;

  do {
    contour.push({ x: cx, y: cy });
    let found = false;
    const startDir = (dir + 5) % 8;
    for (let i = 0; i < 8; i++) {
      const d = (startDir + i) % 8;
      const nx = cx + dx8[d];
      const ny = cy + dy8[d];
      if (nx >= 0 && nx < width && ny >= 0 && ny < height && mask[ny * width + nx]) {
        dir = d;
        cx = nx;
        cy = ny;
        found = true;
        break;
      }
    }
    if (!found) break;
    iter++;
  } while ((cx !== startX || cy !== startY) && iter < maxIter);

  return simplifyRdp(contour, 3.0);
}

// ─── Stage 7: Polygon Refinement ────────────────────────────────────────────

/**
 * Enforce orthogonality: snap near-horizontal/vertical edges to exact H/V.
 */
export function enforceOrthogonality(polygon, tolDeg) {
  if (!polygon || polygon.length < 3) return polygon;
  const result = polygon.map(p => ({ ...p }));
  for (let i = 0; i < result.length; i++) {
    const j = (i + 1) % result.length;
    const dx = result[j].x - result[i].x;
    const dy = result[j].y - result[i].y;
    const angle = Math.abs(Math.atan2(dy, dx) * 180 / Math.PI);

    // Near-horizontal
    if (angle < tolDeg || angle > 180 - tolDeg) {
      const avgY = Math.round((result[i].y + result[j].y) / 2);
      result[i].y = avgY;
      result[j].y = avgY;
    }
    // Near-vertical
    else if (Math.abs(angle - 90) < tolDeg) {
      const avgX = Math.round((result[i].x + result[j].x) / 2);
      result[i].x = avgX;
      result[j].x = avgX;
    }
  }
  return result;
}

/**
 * Remove duplicate consecutive vertices and very short edges.
 */
export function cleanPolygon(polygon, minEdgeLen = 3) {
  if (!polygon || polygon.length < 3) return polygon;
  const clean = [polygon[0]];
  for (let i = 1; i < polygon.length; i++) {
    const prev = clean[clean.length - 1];
    const dx = polygon[i].x - prev.x;
    const dy = polygon[i].y - prev.y;
    if (Math.sqrt(dx * dx + dy * dy) >= minEdgeLen) {
      clean.push(polygon[i]);
    }
  }
  // Check closing edge
  if (clean.length >= 3) {
    const first = clean[0];
    const last = clean[clean.length - 1];
    const dx = first.x - last.x;
    const dy = first.y - last.y;
    if (Math.sqrt(dx * dx + dy * dy) < minEdgeLen) {
      clean.pop();
    }
  }
  return clean.length >= 3 ? clean : polygon;
}

/**
 * Full polygon refinement.
 */
export function refinePolygon(polygon, params = PARAMS) {
  if (!polygon) return null;
  let refined = simplifyRdp(polygon, params.simplifyEpsilon);
  refined = enforceOrthogonality(refined, params.orthogonalSnapDeg);
  refined = cleanPolygon(refined);
  return refined;
}

// ─── Stage 8: Validation / Scoring ──────────────────────────────────────────

/**
 * Compute signed polygon area using the shoelace formula.
 */
export function polygonArea(polygon) {
  if (!polygon || polygon.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < polygon.length; i++) {
    const j = (i + 1) % polygon.length;
    area += polygon[i].x * polygon[j].y;
    area -= polygon[j].x * polygon[i].y;
  }
  return Math.abs(area) / 2;
}

/**
 * Check if polygon is self-intersecting.
 */
export function isSelfIntersecting(polygon) {
  if (!polygon || polygon.length < 4) return false;
  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (j === (i + n - 1) % n) continue; // skip adjacent edges
      const c = polygon[j];
      const d = polygon[(j + 1) % n];
      if (segmentsIntersect(a, b, c, d)) return true;
    }
  }
  return false;
}

function segmentsIntersect(a, b, c, d) {
  const cross = (o, p, q) => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
      ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  return false;
}

/**
 * Score a polygon candidate based on quality metrics.
 */
export function scorePolygon(polygon, imageArea, params = PARAMS) {
  if (!polygon || polygon.length < 3) return 0;

  const area = polygonArea(polygon);
  const areaRatio = area / imageArea;

  // Continuity: penalise very small or overly large
  const continuity = areaRatio > 0.01 && areaRatio < 0.9 ? 1 : 0.3;

  // Enclosure: closed polygon (first ≈ last or implicit close)
  const enclosure = polygon.length >= 4 ? 1 : 0.5;

  // Orthogonality: fraction of edges that are near H/V
  let orthoEdges = 0;
  for (let i = 0; i < polygon.length; i++) {
    const j = (i + 1) % polygon.length;
    const angle = Math.abs(Math.atan2(polygon[j].y - polygon[i].y, polygon[j].x - polygon[i].x) * 180 / Math.PI);
    if (angle < 10 || angle > 170 || Math.abs(angle - 90) < 10) orthoEdges++;
  }
  const orthogonality = polygon.length > 0 ? orthoEdges / polygon.length : 0;

  // Self-intersection penalty
  const selfIntersect = isSelfIntersecting(polygon) ? 0.3 : 1.0;

  const score =
    params.scoreContinuity * continuity +
    params.scoreEnclosure * enclosure +
    params.scoreOrthogonality * orthogonality +
    params.scoreThicknessConsistency * selfIntersect;

  return Math.max(0, Math.min(1, score));
}

// ─── Full Pipeline ──────────────────────────────────────────────────────────

/**
 * Run the complete wall detection pipeline.
 *
 * @param {ImageData} imageData - Raw RGBA image data
 * @param {Object} options
 * @param {Array} options.ocrBoxes - OCR detected dimensions [{bbox:{x,y,width,height}, ...}]
 * @param {Object} options.params - Override PARAMS
 * @returns {Object} Full results with debug data for every stage
 */
export function runWallDetectionPipeline(imageData, options = {}) {
  const params = { ...PARAMS, ...options.params };
  const ocrBoxes = options.ocrBoxes || [];

  // Stage 1: Preprocessing
  const preprocessed = preprocess(imageData, params);
  const { gray, width, height, scale } = preprocessed;

  // Stage 2: OCR masking
  const wallMaskCopy = new Uint8Array(preprocessed.wallMask);
  const { regions: ocrRegions } = maskOcrRegions(wallMaskCopy, width, height, scale, ocrBoxes, params);

  // Stage 3: Wall candidate extraction
  const wallCandidates = extractWallCandidates(wallMaskCopy, gray, width, height, params);

  // Stage 4: Structural interpretation
  const structure = interpretStructure(wallCandidates.segments, params);

  // Stage 5: Interior room detection
  const roomResult = findClosedRegions(wallMaskCopy, width, height, params);
  const ocrMatch = matchOcrToRegion(roomResult.regions, ocrBoxes, scale);

  // Refine matched room polygon
  let roomPolygon = ocrMatch ? ocrMatch.region.polygon : null;
  let roomPolygonRefined = roomPolygon ? refinePolygon(roomPolygon, params) : null;

  // Stage 6: Exterior perimeter
  const exteriorResult = findExteriorPerimeter(preprocessed.wallMask, width, height, params);
  let exteriorPolygon = exteriorResult.polygon;
  let exteriorPolygonRefined = exteriorPolygon ? refinePolygon(exteriorPolygon, params) : null;

  // Stage 7 already applied via refinePolygon above

  // Stage 8: Scoring
  const normalizedImageArea = width * height;
  const roomScore = roomPolygonRefined ? scorePolygon(roomPolygonRefined, normalizedImageArea, params) : 0;
  const exteriorScore = exteriorPolygonRefined ? scorePolygon(exteriorPolygonRefined, normalizedImageArea, params) : 0;

  // Scale polygons back to original image coordinates
  const unscalePoly = (poly) => {
    if (!poly) return null;
    return poly.map(p => ({ x: p.x / scale, y: p.y / scale }));
  };

  return {
    // Final results
    roomPolygon: unscalePoly(roomPolygonRefined),
    exteriorPolygon: unscalePoly(exteriorPolygonRefined),
    roomScore,
    exteriorScore,
    scale,
    width,
    height,

    // Debug data for each stage
    debug: {
      // Stage 1
      preprocessed: {
        gray,
        wallMask: preprocessed.wallMask,
        width,
        height,
        scale,
      },
      // Stage 2
      ocrMasking: {
        maskedWallMask: wallMaskCopy,
        ocrRegions,
      },
      // Stage 3
      wallCandidates: {
        edgeMap: wallCandidates.edgeMap,
        combined: wallCandidates.combined,
        closed: wallCandidates.closed,
        segments: wallCandidates.segments,
      },
      // Stage 4
      structure: {
        snapped: structure.snapped,
        merged: structure.merged,
        junctions: structure.junctions,
        graph: structure.graph,
      },
      // Stage 5
      roomDetection: {
        regions: roomResult.regions,
        ocrMatch,
        roomPolygon: roomPolygonRefined,
        roomPolygonOrigScale: unscalePoly(roomPolygonRefined),
      },
      // Stage 6
      exterior: {
        footprint: exteriorResult.footprint,
        closedMask: exteriorResult.closed,
        largestMask: exteriorResult.largestMask,
        polygon: exteriorPolygonRefined,
        polygonOrigScale: unscalePoly(exteriorPolygonRefined),
      },
      // Stage 8
      scoring: {
        roomScore,
        exteriorScore,
      },
    },
  };
}

export { PARAMS };
