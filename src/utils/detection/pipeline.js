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

  // Outer boundary tracks the outer shell by slightly dilating walls.
  const outerMask = dilate(baseWallMask, preprocess.width, preprocess.height, options.outerDilate ?? 2);
  const outerResult = getLargestComponentPolygon(outerMask, preprocess, orientation, options);

  // Inner boundary approximates inside-wall tracing by eroding walls, then contouring free space.
  const innerWallMask = erode(baseWallMask, preprocess.width, preprocess.height, options.innerErode ?? 1);
  const innerFreeMask = invertMask(innerWallMask);
  const innerResult = getLargestComponentPolygon(innerFreeMask, preprocess, orientation, options);

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
