import { labelConnectedComponents, mooreBoundaryTrace, simplifyRdp } from './vectorize';
import { closeMask } from './wallMask';

/* ------------------------------------------------------------------ */
/*  Room segmentation from a binary wall mask                          */
/* ------------------------------------------------------------------ */

/**
 * Segment rooms from a cleaned binary wall mask.
 *
 * Walls = 1, background = 0 in the input mask.
 * The mask is inverted so that open space becomes the foreground, then
 * connected-component labelling finds individual room regions.
 *
 * @param {Uint8Array} wallMask  Binary mask (1 = wall, 0 = space)
 * @param {number}     width
 * @param {number}     height
 * @param {object}     [options]
 * @param {number}     [options.gapCloseRadius=5]   Morphological close to bridge door gaps
 * @param {number}     [options.minRoomArea]         Minimum pixel area for a room (default: 0.5 % of image)
 * @param {number}     [options.maxRoomAreaRatio=0.6] Max fraction of image area for a single room (background filter)
 * @returns {{ labels: Int32Array, rooms: Array<{id,size,bbox}> }}
 */
export const segmentRooms = (wallMask, width, height, options = {}) => {
  const gapCloseRadius = options.gapCloseRadius ?? 5;
  const minRoomArea = options.minRoomArea ?? Math.max(200, Math.round(width * height * 0.005));
  const maxRoomAreaRatio = options.maxRoomAreaRatio ?? 0.6;
  const maxRoomArea = Math.round(width * height * maxRoomAreaRatio);

  // Close small gaps (doors / windows) in wall mask
  const closedWalls = gapCloseRadius > 0
    ? closeMask(wallMask, width, height, gapCloseRadius)
    : wallMask;

  // Invert: open space → foreground (1)
  const inverted = new Uint8Array(width * height);
  for (let i = 0; i < inverted.length; i += 1) {
    inverted[i] = closedWalls[i] ? 0 : 1;
  }

  // Connected component labelling on inverted mask
  const { labels, components } = labelConnectedComponents(inverted, width, height, 1);

  // Filter out noise (too small) and background (too large)
  const rooms = components.filter(
    (c) => c.size >= minRoomArea && c.size <= maxRoomArea,
  );

  return { labels, rooms, closedWalls };
};

/* ------------------------------------------------------------------ */
/*  Extract features for each room                                     */
/* ------------------------------------------------------------------ */

/**
 * For each room component, compute contour, bounding box, centroid, and area.
 *
 * @param {Int32Array}  labels    Label image from segmentRooms
 * @param {Array}       rooms     Room component list from segmentRooms
 * @param {number}      width
 * @param {number}      height
 * @param {object}      [options]
 * @param {number}      [options.simplifyEpsilon=2]  RDP simplification epsilon
 * @returns {Array<Room>}
 */
export const extractRoomFeatures = (labels, rooms, width, height, options = {}) => {
  const epsilon = options.simplifyEpsilon ?? 2;

  return rooms.map((comp) => {
    // Contour via Moore boundary trace
    const rawBoundary = mooreBoundaryTrace(labels, width, height, comp.id);
    let contour = rawBoundary;
    if (rawBoundary.length >= 3) {
      const closed = rawBoundary.concat(rawBoundary[0]);
      const simplified = simplifyRdp(closed, epsilon).slice(0, -1);
      if (simplified.length >= 3) contour = simplified;
    }

    // Bounding box
    const bbox = comp.bbox; // { minX, minY, maxX, maxY }

    // Centroid (center of bounding box as a fast approximation)
    const centroid = {
      x: Math.round((bbox.minX + bbox.maxX) / 2),
      y: Math.round((bbox.minY + bbox.maxY) / 2),
    };

    return {
      id: comp.id,
      contour,
      bbox,
      centroid,
      area: comp.size,
      assignedTexts: [],
      parsedDimensions: null,
    };
  });
};

/* ------------------------------------------------------------------ */
/*  Point-in-polygon test (ray casting)                                */
/* ------------------------------------------------------------------ */

/**
 * Test whether a point lies inside or on a polygon contour.
 * Uses the ray-casting algorithm.
 *
 * @param {Array<{x,y}>} contour  Polygon vertices
 * @param {{x,y}}        point
 * @returns {boolean}
 */
export const pointInPolygon = (contour, point) => {
  if (!contour || contour.length < 3) return false;
  const { x, y } = point;
  let inside = false;
  for (let i = 0, j = contour.length - 1; i < contour.length; j = i, i += 1) {
    const xi = contour[i].x;
    const yi = contour[i].y;
    const xj = contour[j].x;
    const yj = contour[j].y;
    if (((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
};

/**
 * Fallback: check if point falls within a room's bounding box.
 */
export const pointInBbox = (bbox, point) => {
  const { x, y } = point;
  return x >= bbox.minX && x <= bbox.maxX && y >= bbox.minY && y <= bbox.maxY;
};
