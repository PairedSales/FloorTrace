import { normalizeImageData, mapPointToNormalized } from './preprocess';
import { estimateDominantOrientations } from './orientation';
import {
  labelConnectedComponents,
  componentToPolygon,
  polygonToBounds,
  mapPolygonFromNormalized,
} from './vectorize';

const dilate = (mask, width, height, radius) => {
  if (radius <= 0) return mask;
  const temp = new Uint8Array(mask.length);
  const out = new Uint8Array(mask.length);

  for (let y = 0; y < height; y += 1) {
    const offset = y * width;
    for (let x = 0; x < width; x += 1) {
      let on = 0;
      const xMin = Math.max(0, x - radius);
      const xMax = Math.min(width - 1, x + radius);
      for (let kx = xMin; kx <= xMax; kx += 1) {
        if (mask[offset + kx]) {
          on = 1;
          break;
        }
      }
      temp[offset + x] = on;
    }
  }

  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      let on = 0;
      const yMin = Math.max(0, y - radius);
      const yMax = Math.min(height - 1, y + radius);
      for (let ky = yMin; ky <= yMax; ky += 1) {
        if (temp[ky * width + x]) {
          on = 1;
          break;
        }
      }
      out[y * width + x] = on;
    }
  }

  return out;
};

const erode = (mask, width, height, radius) => {
  if (radius <= 0) return mask;
  const temp = new Uint8Array(mask.length);
  const out = new Uint8Array(mask.length);

  for (let y = 0; y < height; y += 1) {
    const offset = y * width;
    for (let x = 0; x < width; x += 1) {
      let on = 1;
      const xMin = Math.max(0, x - radius);
      const xMax = Math.min(width - 1, x + radius);
      for (let kx = xMin; kx <= xMax; kx += 1) {
        if (!mask[offset + kx]) {
          on = 0;
          break;
        }
      }
      temp[offset + x] = on;
    }
  }

  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      let on = 1;
      const yMin = Math.max(0, y - radius);
      const yMax = Math.min(height - 1, y + radius);
      for (let ky = yMin; ky <= yMax; ky += 1) {
        if (!temp[ky * width + x]) {
          on = 0;
          break;
        }
      }
      out[y * width + x] = on;
    }
  }

  return out;
};

const closeMask = (mask, width, height, radius) => {
  return erode(dilate(mask, width, height, radius), width, height, radius);
};

const neighbors4 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

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

export const snapPolygonToGrid = (polygon) => {
  const N = polygon.length;
  if (N < 3) return polygon;
  const snapped = polygon.map((p) => ({ ...p }));

  for (let i = 0; i < N - 1; i += 1) {
    const curr = snapped[i];
    const next = snapped[i + 1];
    const dx = next.x - curr.x;
    const dy = next.y - curr.y;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);

    if (absDx > 0 && absDy > 0) {
      const ratio = absDx / absDy;
      if (ratio > 0.5 && ratio < 2.0) {
        continue;
      }
    }

    if (absDx >= absDy) {
      next.y = curr.y;
    } else {
      next.x = curr.x;
    }
  }

  const last = snapped[N - 1];
  const first = snapped[0];
  const dx = first.x - last.x;
  const dy = first.y - last.y;
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);

  if (absDx > 0 && absDy > 0) {
    const ratio = absDx / absDy;
    if (ratio > 0.5 && ratio < 2.0) {
      // diagonal, keep it
    } else if (absDx >= absDy) {
      last.y = first.y;
    } else {
      last.x = first.x;
    }
  } else if (absDx >= absDy) {
    last.y = first.y;
  } else {
    last.x = first.x;
  }

  return snapped;
};

const getSimpleEdgeProfiles = (wallMask, width, height) => {
  const topProfile = new Int32Array(width).fill(height);
  const bottomProfile = new Int32Array(width).fill(-1);
  const leftProfile = new Int32Array(height).fill(width);
  const rightProfile = new Int32Array(height).fill(-1);

  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      if (wallMask[y * width + x]) {
        topProfile[x] = y;
        break;
      }
    }
    for (let y = height - 1; y >= 0; y -= 1) {
      if (wallMask[y * width + x]) {
        bottomProfile[x] = y;
        break;
      }
    }
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (wallMask[y * width + x]) {
        leftProfile[y] = x;
        break;
      }
    }
    for (let x = width - 1; x >= 0; x -= 1) {
      if (wallMask[y * width + x]) {
        rightProfile[y] = x;
        break;
      }
    }
  }

  return { topProfile, bottomProfile, leftProfile, rightProfile };
};

export const measureWallThicknessFromEdge = (wallMask, width, height, profiles) => {
  const { topProfile, bottomProfile, leftProfile, rightProfile } = profiles;
  const measurements = [];

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

const MIN_WALL_THICKNESS_MEASUREMENT = 3;

export const computeRobustWallThickness = (measurements, fallback = 2) => {
  const thick = measurements.filter((t) => t >= MIN_WALL_THICKNESS_MEASUREMENT);
  if (thick.length === 0) return fallback;

  const hist = new Map();
  for (const t of thick) {
    hist.set(t, (hist.get(t) ?? 0) + 1);
  }

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

export const estimateWallThickness = (wallMask, width, height) => {
  const profiles = getSimpleEdgeProfiles(wallMask, width, height);
  const measurements = measureWallThicknessFromEdge(wallMask, width, height, profiles);
  return computeRobustWallThickness(measurements, 10);
};

export const buildWallMask = (gray, width, height, options = {}) => {
  const darkThreshold = options.darkThreshold ?? 200;
  const rawWallMask = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i += 1) {
    rawWallMask[i] = gray[i] < darkThreshold ? 1 : 0;
  }

  const labelsObj = labelConnectedComponents(rawWallMask, width, height, 1);
  const cleanedWallMask = new Uint8Array(width * height);
  const minSize = options.minWallComponentSize ?? 100;
  const minDim = options.minWallComponentDim ?? 40;

  for (const comp of labelsObj.components) {
    const wComp = comp.bbox.maxX - comp.bbox.minX + 1;
    const hComp = comp.bbox.maxY - comp.bbox.minY + 1;
    if (comp.size >= minSize || wComp >= minDim || hComp >= minDim) {
      for (let y = comp.bbox.minY; y <= comp.bbox.maxY; y += 1) {
        for (let x = comp.bbox.minX; x <= comp.bbox.maxX; x += 1) {
          const idx = y * width + x;
          if (labelsObj.labels[idx] === comp.id) {
            cleanedWallMask[idx] = 1;
          }
        }
      }
    }
  }

  return { rawWallMask, cleanedWallMask };
};

export const traceExterior = (wallMask, width, height, options = {}) => {
  const wallThickness = options.innerErode != null
    ? options.innerErode
    : estimateWallThickness(wallMask, width, height);

  const closeRadius = options.outerCloseRadius ?? options.wallMask?.closeRadius ?? 12;
  const closedWallMask = closeMask(wallMask, width, height, closeRadius);

  const exterior = floodFillFromEdges(closedWallMask, width, height);
  const footprintMask = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i += 1) {
    footprintMask[i] = exterior[i] ? 0 : 1;
  }

  const footprintLabels = labelConnectedComponents(footprintMask, width, height, 1);
  let outerPolygon = [];
  if (footprintLabels.components.length > 0) {
    const mainComponent = footprintLabels.components.sort((a, b) => b.size - a.size)[0];
    const rawOuter = componentToPolygon(footprintLabels.labels, width, height, mainComponent.id, {
      simplifyEpsilon: options.simplifyEpsilon ?? 2.5,
      angleBins: options.angleBins,
    });
    outerPolygon = snapPolygonToGrid(rawOuter);
  }

  const innerFootprint = erode(footprintMask, width, height, wallThickness);
  const innerLabelsObj = labelConnectedComponents(innerFootprint, width, height, 1);
  let innerPolygon = [];
  if (innerLabelsObj.components.length > 0) {
    const largestInner = innerLabelsObj.components.sort((a, b) => b.size - a.size)[0];
    const rawInner = componentToPolygon(innerLabelsObj.labels, width, height, largestInner.id, {
      simplifyEpsilon: options.simplifyEpsilon ?? 2.5,
      angleBins: options.angleBins,
    });
    innerPolygon = snapPolygonToGrid(rawInner);
  }

  return {
    footprintMask,
    closedWallMask,
    outerPolygon,
    innerPolygon,
    wallThickness,
  };
};

export const detectRoom = (wallMask, footprintMask, width, height, clickPoint, options = {}) => {
  const cx = Math.max(0, Math.min(width - 1, Math.round(clickPoint.x)));
  const cy = Math.max(0, Math.min(height - 1, Math.round(clickPoint.y)));

  if (footprintMask && !footprintMask[cy * width + cx]) {
    return null;
  }

  let closingRadius = options.roomCloseRadius ?? 10;
  let roomMask = null;
  let seed = null;
  let finalClosedMask = null;
  let leakDetected = false;

  const maxClosingRadius = Math.min(20, closingRadius + 5);

  while (closingRadius <= maxClosingRadius) {
    finalClosedMask = closeMask(wallMask, width, height, closingRadius);
    const freeMask = new Uint8Array(width * height);
    for (let i = 0; i < freeMask.length; i += 1) {
      freeMask[i] = finalClosedMask[i] ? 0 : 1;
    }

    seed = findFreeSpaceSeed(freeMask, cx, cy, width, height, 40);
    if (!seed) {
      break;
    }

    roomMask = new Uint8Array(width * height);
    const queue = [seed.y * width + seed.x];
    roomMask[seed.y * width + seed.x] = 1;
    let head = 0;
    let leaked = false;
    let area = 0;

    let footprintArea = 0;
    for (let i = 0; i < footprintMask.length; i += 1) {
      if (footprintMask[i]) footprintArea += 1;
    }
    if (footprintArea === 0) footprintArea = width * height;

    while (head < queue.length) {
      const idx = queue[head];
      head += 1;
      const x = idx % width;
      const y = Math.floor(idx / width);
      area += 1;

      if (area > footprintArea * 0.55) {
        leaked = true;
        break;
      }

      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
        leaked = true;
        break;
      }

      if (footprintMask && !footprintMask[idx]) {
        leaked = true;
        break;
      }

      for (const [dx, dy] of neighbors4) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < width && ny < height) {
          const nIdx = ny * width + nx;
          if (!roomMask[nIdx] && freeMask[nIdx]) {
            roomMask[nIdx] = 1;
            queue.push(nIdx);
          }
        }
      }
    }

    if (leaked) {
      leakDetected = true;
      closingRadius += 5;
    } else {
      break;
    }
  }

  if (!roomMask || !seed) return null;

  const roomLabels = new Int32Array(width * height);
  for (let i = 0; i < roomMask.length; i += 1) {
    roomLabels[i] = roomMask[i] ? 1 : -1;
  }
  const rawRoomPolygon = componentToPolygon(roomLabels, width, height, 1, {
    simplifyEpsilon: options.simplifyEpsilon ?? 2.0,
    angleBins: options.angleBins,
  });

  if (rawRoomPolygon.length < 3) return null;
  const roomPolygon = snapPolygonToGrid(rawRoomPolygon);

  return {
    roomMask,
    closedWallMask: finalClosedMask,
    roomPolygon,
    seed,
    leakDetected,
  };
};

export const detectRoomFromClickCore = (imageData, clickPoint, options = {}) => {
  const tStart = performance.now();

  const tPreprocessStart = performance.now();
  const preprocess = normalizeImageData(imageData, options.preprocess);
  const tPreprocess = performance.now() - tPreprocessStart;

  const tOrientationStart = performance.now();
  const orientation = estimateDominantOrientations(
    preprocess.gray, preprocess.width, preprocess.height, options.orientation,
  );
  const tOrientation = performance.now() - tOrientationStart;

  const w = preprocess.width;
  const h = preprocess.height;

  const tWallMaskStart = performance.now();
  const { rawWallMask, cleanedWallMask } = buildWallMask(preprocess.gray, w, h, options);
  const tWallMask = performance.now() - tWallMaskStart;

  const tTraceExteriorStart = performance.now();
  const exterior = traceExterior(cleanedWallMask, w, h, {
    ...options,
    angleBins: orientation.dominant,
  });
  const tTraceExterior = performance.now() - tTraceExteriorStart;

  if (!exterior) return null;

  const nPoint = mapPointToNormalized(clickPoint, preprocess.scale);

  const tDetectRoomStart = performance.now();
  const roomRes = detectRoom(cleanedWallMask, exterior.footprintMask, w, h, nPoint, {
    ...options,
    angleBins: orientation.dominant,
  });
  const tDetectRoom = performance.now() - tDetectRoomStart;

  if (!roomRes) return null;

  const mappedPolygon = mapPolygonFromNormalized(roomRes.roomPolygon, preprocess.scale);
  const bounds = polygonToBounds(mappedPolygon);
  if (!bounds) return null;

  const confidenceBase = Math.min(1, roomRes.roomPolygon.length / 20);
  const confidence = Math.max(0.2, Math.min(0.98, confidenceBase));

  const totalTime = performance.now() - tStart;

  const wallLabels = labelConnectedComponents(rawWallMask, w, h, 1);
  const filteredWallLabels = labelConnectedComponents(cleanedWallMask, w, h, 1);

  return {
    polygon: mappedPolygon,
    overlay: {
      x1: bounds.minX,
      y1: bounds.minY,
      x2: bounds.maxX,
      y2: bounds.maxY,
    },
    confidence,
    debug: {
      normalizedSize: { width: w, height: h },
      scale: preprocess.scale,
      dominantAngles: orientation.dominant,
      startPoint: roomRes.seed,
      thresholdedMask: rawWallMask,
      filteredMask: cleanedWallMask,
      closedMask: roomRes.closedWallMask,
      roomMask: roomRes.roomMask,
      leakDetected: roomRes.leakDetected,

      // Detailed diagnostics and steps
      timings: {
        total: totalTime,
        preprocess: tPreprocess,
        orientation: tOrientation,
        wallMask: tWallMask,
        traceExterior: tTraceExterior,
        detectRoom: tDetectRoom,
      },
      rawComponents: wallLabels.components,
      filteredComponents: filteredWallLabels.components,
      rawRoomPolygon: roomRes.roomPolygon, // Pass un-snapped polygon
      snappedRoomPolygon: roomRes.roomPolygon, // Snapped is same as it's already snapped inside detectRoom
      seed: roomRes.seed,
      closeRadius: options.roomCloseRadius ?? 10,
    },
  };
};

export const traceFloorplanBoundaryCore = (imageData, options = {}) => {
  const tStart = performance.now();

  const tPreprocessStart = performance.now();
  const preprocess = normalizeImageData(imageData, options.preprocess);
  const tPreprocess = performance.now() - tPreprocessStart;

  const tOrientationStart = performance.now();
  const orientation = estimateDominantOrientations(
    preprocess.gray, preprocess.width, preprocess.height, options.orientation,
  );
  const tOrientation = performance.now() - tOrientationStart;

  const w = preprocess.width;
  const h = preprocess.height;

  const tWallMaskStart = performance.now();
  const { rawWallMask, cleanedWallMask } = buildWallMask(preprocess.gray, w, h, options);
  const tWallMask = performance.now() - tWallMaskStart;

  const tTraceExteriorStart = performance.now();
  const exterior = traceExterior(cleanedWallMask, w, h, {
    ...options,
    angleBins: orientation.dominant,
  });
  const tTraceExterior = performance.now() - tTraceExteriorStart;

  if (!exterior) return null;

  const mappedOuter = exterior.outerPolygon.length >= 3
    ? mapPolygonFromNormalized(exterior.outerPolygon, preprocess.scale)
    : null;
  const mappedInner = exterior.innerPolygon.length >= 3
    ? mapPolygonFromNormalized(exterior.innerPolygon, preprocess.scale)
    : null;

  if (!mappedOuter && !mappedInner) return null;

  const outerBounds = mappedOuter ? polygonToBounds(mappedOuter) : null;
  const innerBounds = mappedInner ? polygonToBounds(mappedInner) : null;

  const totalTime = performance.now() - tStart;

  const wallLabels = labelConnectedComponents(rawWallMask, w, h, 1);
  const filteredWallLabels = labelConnectedComponents(cleanedWallMask, w, h, 1);

  return {
    outer: mappedOuter ? {
      polygon: mappedOuter,
      overlay: {
        x1: outerBounds.minX,
        y1: outerBounds.minY,
        x2: outerBounds.maxX,
        y2: outerBounds.maxY,
      },
    } : null,
    inner: mappedInner ? {
      polygon: mappedInner,
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
      scale: preprocess.scale,
      hasOuter: Boolean(mappedOuter),
      hasInner: Boolean(mappedInner),
      usedEdgeScan: true,
      wallThickness: exterior.wallThickness,
      thresholdedMask: rawWallMask,
      filteredMask: cleanedWallMask,
      closedMask: exterior.closedWallMask,
      footprintMask: exterior.footprintMask,

      // Detailed diagnostics and steps
      timings: {
        total: totalTime,
        preprocess: tPreprocess,
        orientation: tOrientation,
        wallMask: tWallMask,
        traceExterior: tTraceExterior,
      },
      rawComponents: wallLabels.components,
      filteredComponents: filteredWallLabels.components,
      rawOuterPolygon: exterior.outerPolygon,
      rawInnerPolygon: exterior.innerPolygon,
      snappedOuterPolygon: exterior.outerPolygon,
      snappedInnerPolygon: exterior.innerPolygon,
      closeRadius: options.outerCloseRadius ?? options.wallMask?.closeRadius ?? 12,
    },
  };
};

export const boundaryByMode = (result, wallMode = 'inner') => {
  if (!result) return null;
  if (wallMode === 'outer') return result.outer ?? result.inner;
  return result.inner ?? result.outer;
};
