import { normalizeImageData, mapPointToNormalized } from './preprocess';
import { estimateDominantOrientations } from './orientation';
import { prepareWallMask, erode, dilate } from './wallMask';
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

const areaOfBounds = (bounds) => (bounds.maxX - bounds.minX + 1) * (bounds.maxY - bounds.minY + 1);

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

export const detectRoomFromClickCore = (imageData, clickPoint, options = {}) => {
  const preprocess = normalizeImageData(imageData, options.preprocess);
  const orientation = estimateDominantOrientations(preprocess.gray, preprocess.width, preprocess.height, options.orientation);
  const wallMask = prepareWallMask(preprocess.wallMask, preprocess.width, preprocess.height, options.wallMask);
  const freeMask = invertMask(wallMask);
  const labeled = labelConnectedComponents(freeMask, preprocess.width, preprocess.height, 1);

  if (!labeled.components.length) return null;

  const nPoint = mapPointToNormalized(clickPoint, preprocess.scale);
  const clampedPoint = {
    x: Math.max(0, Math.min(preprocess.width - 1, nPoint.x)),
    y: Math.max(0, Math.min(preprocess.height - 1, nPoint.y)),
  };

  const pointIndex = clampedPoint.y * preprocess.width + clampedPoint.x;
  let targetComponentId = labeled.labels[pointIndex];

  if (targetComponentId < 0) {
    const candidates = labeled.components
      .filter((component) => areaOfBounds(component.bbox) > 400)
      .sort((a, b) => b.size - a.size);
    targetComponentId = candidates[0]?.id ?? -1;
  }

  if (targetComponentId < 0) return null;

  let polygon = componentToPolygon(labeled.labels, preprocess.width, preprocess.height, targetComponentId, {
    simplifyEpsilon: options.simplifyEpsilon ?? 2.2,
    angleBins: orientation.dominant,
  });

  if (!polygon.length) return null;
  if (polygon.length < 4) {
    polygon = componentToPolygon(labeled.labels, preprocess.width, preprocess.height, targetComponentId, {
      simplifyEpsilon: 1.1,
      angleBins: orientation.dominant,
    });
  }

  const selected = labeled.components.find((component) => component.id === targetComponentId);
  const confidenceBase = selected ? Math.min(1, selected.size / (preprocess.width * preprocess.height * 0.2)) : 0.2;
  const confidence = Math.max(0.2, Math.min(0.98, confidenceBase));

  return normalizedRoomResult(polygon, preprocess, confidence, {
    normalizedSize: { width: preprocess.width, height: preprocess.height },
    dominantAngles: orientation.dominant,
    componentSize: selected?.size ?? 0,
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

export const traceFloorplanBoundaryCore = (imageData, options = {}) => {
  const preprocess = normalizeImageData(imageData, options.preprocess);
  const orientation = estimateDominantOrientations(preprocess.gray, preprocess.width, preprocess.height, options.orientation);
  const baseWallMask = prepareWallMask(preprocess.wallMask, preprocess.width, preprocess.height, options.wallMask);

  // Close small wall gaps with dilation for robust footprint detection.
  const closedMask = dilate(baseWallMask, preprocess.width, preprocess.height, options.outerDilate ?? 2);

  // Outer boundary: flood-fill exterior from image edges, invert to get footprint,
  // then trace the contour of the footprint.
  const footprint = getFloorplanFootprint(closedMask, preprocess.width, preprocess.height);
  const outerResult = getLargestComponentPolygon(footprint, preprocess, orientation, options);

  // Inner boundary: erode the footprint inward to approximate the inner wall edge.
  // Radius 2 (vs previous default of 1) because we now erode the solid footprint
  // rather than the wall mask, and a larger offset produces a more visible
  // inner/outer distinction.
  const innerFootprint = erode(footprint, preprocess.width, preprocess.height, options.innerErode ?? 2);
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
    },
  };
};

export const boundaryByMode = (result, wallMode = 'inner') => {
  if (!result) return null;
  if (wallMode === 'outer') return result.outer ?? result.inner;
  return result.inner ?? result.outer;
};

export const isPointInsideNormalizedImage = (point, preprocess) => pointInBounds(point, preprocess.width, preprocess.height);
