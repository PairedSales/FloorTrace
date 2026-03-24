const DEFAULT_OPTIONS = {
  downsampleMaxDimension: 1400,
  darknessBias: 24,
  minSegmentLength: 18,
  maxBridgeGap: 3,
  bandMergeTolerance: 3,
  cornerSearchRadius: 6,
  maxCorners: 4000,
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const loadImageElement = (src) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = reject;
  img.src = src;
});

const mergeBands = (segments, axisKey, options) => {
  if (!segments.length) return [];

  const sorted = [...segments].sort((a, b) => a[axisKey] - b[axisKey]);
  const merged = [];

  for (const segment of sorted) {
    const previous = merged[merged.length - 1];
    if (
      previous &&
      Math.abs(previous[axisKey] - segment[axisKey]) <= options.bandMergeTolerance &&
      segment.start <= previous.end + options.maxBridgeGap
    ) {
      previous.end = Math.max(previous.end, segment.end);
      previous.totalAxis += segment[axisKey];
      previous.count += 1;
      previous[axisKey] = previous.totalAxis / previous.count;
      continue;
    }

    merged.push({
      ...segment,
      totalAxis: segment[axisKey],
      count: 1,
    });
  }

  return merged.map((entry) => ({
    y: entry.y,
    x: entry.x,
    start: entry.start,
    end: entry.end,
    center: entry[axisKey],
    thickness: entry.count,
  }));
};

const collectSegments = (darkMask, width, height, orientation, options) => {
  const segments = [];
  const primaryLimit = orientation === 'horizontal' ? height : width;
  const secondaryLimit = orientation === 'horizontal' ? width : height;

  for (let primary = 0; primary < primaryLimit; primary += 1) {
    let runStart = -1;
    let gapCount = 0;

    for (let secondary = 0; secondary < secondaryLimit; secondary += 1) {
      const x = orientation === 'horizontal' ? secondary : primary;
      const y = orientation === 'horizontal' ? primary : secondary;
      const dark = darkMask[y * width + x] === 1;

      if (dark) {
        if (runStart < 0) runStart = secondary;
        gapCount = 0;
      } else if (runStart >= 0) {
        gapCount += 1;
        if (gapCount > options.maxBridgeGap) {
          const runEnd = secondary - gapCount;
          if (runEnd - runStart + 1 >= options.minSegmentLength) {
            segments.push(
              orientation === 'horizontal'
                ? { y: primary, start: runStart, end: runEnd }
                : { x: primary, start: runStart, end: runEnd }
            );
          }
          runStart = -1;
          gapCount = 0;
        }
      }
    }

    if (runStart >= 0) {
      const runEnd = secondaryLimit - 1;
      if (runEnd - runStart + 1 >= options.minSegmentLength) {
        segments.push(
          orientation === 'horizontal'
            ? { y: primary, start: runStart, end: runEnd }
            : { x: primary, start: runStart, end: runEnd }
        );
      }
    }
  }

  return mergeBands(segments, orientation === 'horizontal' ? 'y' : 'x', options);
};

const hasDarkPixelNearby = (darkMask, width, height, x, y, radius) => {
  for (let dy = -radius; dy <= radius; dy += 1) {
    const py = y + dy;
    if (py < 0 || py >= height) continue;
    for (let dx = -radius; dx <= radius; dx += 1) {
      const px = x + dx;
      if (px < 0 || px >= width) continue;
      if (darkMask[py * width + px]) {
        return true;
      }
    }
  }
  return false;
};

const dedupePoints = (points, tolerance) => {
  const deduped = [];

  for (const point of points) {
    const duplicate = deduped.some((candidate) => (
      Math.abs(candidate.x - point.x) <= tolerance &&
      Math.abs(candidate.y - point.y) <= tolerance
    ));

    if (!duplicate) {
      deduped.push(point);
    }
  }

  return deduped;
};

const detectCornersFromLines = (horizontalLines, verticalLines, darkMask, width, height, options) => {
  const corners = [];

  for (const horizontal of horizontalLines) {
    for (const vertical of verticalLines) {
      if (vertical.x < horizontal.start - options.cornerSearchRadius || vertical.x > horizontal.end + options.cornerSearchRadius) {
        continue;
      }
      if (horizontal.y < vertical.start - options.cornerSearchRadius || horizontal.y > vertical.end + options.cornerSearchRadius) {
        continue;
      }

      const x = Math.round(vertical.x);
      const y = Math.round(horizontal.y);

      if (!hasDarkPixelNearby(darkMask, width, height, x, y, options.cornerSearchRadius)) {
        continue;
      }

      corners.push({ x, y });
    }
  }

  return dedupePoints(corners, options.cornerSearchRadius);
};

export const detectSnappingFeatures = async (imageSrc, userOptions = {}) => {
  if (!imageSrc) {
    return {
      cornerPoints: [],
      lineData: { horizontal: [], vertical: [] },
    };
  }

  const options = { ...DEFAULT_OPTIONS, ...userOptions };
  const image = await loadImageElement(imageSrc);
  const scale = image.width > options.downsampleMaxDimension || image.height > options.downsampleMaxDimension
    ? Math.min(options.downsampleMaxDimension / image.width, options.downsampleMaxDimension / image.height)
    : 1;

  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, width, height);

  const { data } = ctx.getImageData(0, 0, width, height);
  const grayscale = new Uint8ClampedArray(width * height);
  let sum = 0;
  let min = 255;
  let max = 0;

  for (let i = 0; i < grayscale.length; i += 1) {
    const offset = i * 4;
    const value = Math.round(
      data[offset] * 0.299 +
      data[offset + 1] * 0.587 +
      data[offset + 2] * 0.114
    );

    grayscale[i] = value;
    sum += value;
    if (value < min) min = value;
    if (value > max) max = value;
  }

  const mean = sum / grayscale.length;
  const threshold = clamp(Math.min(mean - options.darknessBias, (mean + min) / 2), 35, 220);
  const darkMask = new Uint8Array(width * height);

  for (let i = 0; i < grayscale.length; i += 1) {
    darkMask[i] = grayscale[i] <= threshold ? 1 : 0;
  }

  const horizontal = collectSegments(darkMask, width, height, 'horizontal', options);
  const vertical = collectSegments(darkMask, width, height, 'vertical', options);
  const corners = detectCornersFromLines(horizontal, vertical, darkMask, width, height, options)
    .slice(0, options.maxCorners);

  const inverseScale = 1 / scale;
  const mapLine = (line, axis) => ({
    ...line,
    center: line.center * inverseScale,
    start: line.start * inverseScale,
    end: line.end * inverseScale,
    ...(axis === 'horizontal' ? { y: line.y * inverseScale } : { x: line.x * inverseScale }),
    thickness: line.thickness * inverseScale,
  });

  return {
    cornerPoints: corners.map((point) => ({
      x: point.x * inverseScale,
      y: point.y * inverseScale,
    })),
    lineData: {
      horizontal: horizontal.map((line) => mapLine(line, 'horizontal')),
      vertical: vertical.map((line) => mapLine(line, 'vertical')),
      threshold,
      sampledSize: { width, height },
      originalSize: { width: image.width, height: image.height },
    },
  };
};

const lineCoverageScore = (line, start, end) => {
  const overlapStart = Math.max(line.start, start);
  const overlapEnd = Math.min(line.end, end);
  if (overlapEnd < overlapStart) return 0;
  const overlap = overlapEnd - overlapStart;
  const span = Math.max(1, end - start);
  return overlap / span;
};

export const createImageSnapAnalyzer = async (imageSrc, userOptions = {}) => {
  const { cornerPoints, lineData } = await detectSnappingFeatures(imageSrc, userOptions);
  const horizontal = lineData?.horizontal ?? [];
  const vertical = lineData?.vertical ?? [];

  const findVertexSnap = (point, options = {}) => {
    const searchRadius = options.searchRadius ?? 14;
    const searchRadiusSq = searchRadius * searchRadius;
    let best = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const corner of cornerPoints) {
      const dx = corner.x - point.x;
      const dy = corner.y - point.y;
      const distanceSq = dx * dx + dy * dy;
      if (distanceSq <= searchRadiusSq && distanceSq < bestDistance) {
        best = corner;
        bestDistance = distanceSq;
      }
    }

    return best;
  };

  const findVerticalEdge = (targetX, y1, y2, options = {}) => {
    const searchRadius = options.searchRadius ?? 12;
    const start = Math.min(y1, y2);
    const end = Math.max(y1, y2);
    let best = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const line of vertical) {
      const coverage = lineCoverageScore(line, start, end);
      if (coverage < 0.45) continue;
      const distance = Math.abs(line.x - targetX);
      if (distance <= searchRadius && distance < bestDistance) {
        best = line.x;
        bestDistance = distance;
      }
    }

    return best;
  };

  const findHorizontalEdge = (targetY, x1, x2, options = {}) => {
    const searchRadius = options.searchRadius ?? 12;
    const start = Math.min(x1, x2);
    const end = Math.max(x1, x2);
    let best = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const line of horizontal) {
      const coverage = lineCoverageScore(line, start, end);
      if (coverage < 0.45) continue;
      const distance = Math.abs(line.y - targetY);
      if (distance <= searchRadius && distance < bestDistance) {
        best = line.y;
        bestDistance = distance;
      }
    }

    return best;
  };

  return {
    cornerPoints,
    lineData,
    findVertexSnap,
    findVerticalEdge,
    findHorizontalEdge,
  };
};
