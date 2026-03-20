const DEFAULT_OPTIONS = {
  vertexSearchRadius: 15,
  vertexArmLength: 6,
  edgeSearchRadius: 12,
  edgeBandHalfWidth: 2,
  minEdgeSamples: 6,
  darknessBias: 24,
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const loadImageElement = (src) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = reject;
  img.src = src;
});

const getIndex = (x, y, width) => y * width + x;

const average = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 255;

export const createImageSnapAnalyzer = async (imageSrc, userOptions = {}) => {
  if (!imageSrc) {
    return null;
  }

  const options = { ...DEFAULT_OPTIONS, ...userOptions };
  const image = await loadImageElement(imageSrc);
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0);

  const { data } = ctx.getImageData(0, 0, image.width, image.height);
  const grayscale = new Uint8ClampedArray(image.width * image.height);
  let sum = 0;
  let min = 255;

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
  }

  const globalMean = sum / grayscale.length;
  const globalThreshold = clamp(Math.min(globalMean - options.darknessBias, (globalMean + min) / 2), 35, 220);

  const getGray = (x, y) => {
    const px = clamp(Math.round(x), 0, image.width - 1);
    const py = clamp(Math.round(y), 0, image.height - 1);
    return grayscale[getIndex(px, py, image.width)];
  };

  const getLocalThreshold = (centerX, centerY, radius) => {
    const samples = [];
    const startX = clamp(Math.floor(centerX - radius), 0, image.width - 1);
    const endX = clamp(Math.ceil(centerX + radius), 0, image.width - 1);
    const startY = clamp(Math.floor(centerY - radius), 0, image.height - 1);
    const endY = clamp(Math.ceil(centerY + radius), 0, image.height - 1);

    for (let y = startY; y <= endY; y += 1) {
      for (let x = startX; x <= endX; x += 1) {
        samples.push(grayscale[getIndex(x, y, image.width)]);
      }
    }

    const localMean = average(samples);
    const localMin = samples.length ? Math.min(...samples) : globalThreshold;
    return clamp(Math.min(localMean - options.darknessBias, (localMean + localMin) / 2), 25, globalThreshold);
  };

  const isDark = (x, y, threshold) => getGray(x, y) <= threshold;

  const runLength = (x, y, dx, dy, threshold, maxSteps) => {
    let count = 0;

    for (let step = 1; step <= maxSteps; step += 1) {
      const px = x + (dx * step);
      const py = y + (dy * step);
      if (px < 0 || px >= image.width || py < 0 || py >= image.height) {
        break;
      }
      if (!isDark(px, py, threshold)) {
        break;
      }
      count += 1;
    }

    return count;
  };

  const findVertexSnap = (point, overrideOptions = {}) => {
    if (!point) return null;

    const searchRadius = overrideOptions.searchRadius ?? options.vertexSearchRadius;
    const armLength = overrideOptions.armLength ?? options.vertexArmLength;
    const threshold = getLocalThreshold(point.x, point.y, searchRadius + 4);
    const startX = clamp(Math.floor(point.x - searchRadius), 0, image.width - 1);
    const endX = clamp(Math.ceil(point.x + searchRadius), 0, image.width - 1);
    const startY = clamp(Math.floor(point.y - searchRadius), 0, image.height - 1);
    const endY = clamp(Math.ceil(point.y + searchRadius), 0, image.height - 1);

    let bestCorner = null;
    let bestCornerScore = -Infinity;
    let bestDarkPixel = null;
    let bestDarkDistance = Infinity;

    for (let y = startY; y <= endY; y += 1) {
      for (let x = startX; x <= endX; x += 1) {
        if (!isDark(x, y, threshold)) {
          continue;
        }

        const dx = x - point.x;
        const dy = y - point.y;
        const distance = Math.sqrt((dx * dx) + (dy * dy));
        if (distance < bestDarkDistance) {
          bestDarkDistance = distance;
          bestDarkPixel = { x, y };
        }

        const left = runLength(x, y, -1, 0, threshold, armLength);
        const right = runLength(x, y, 1, 0, threshold, armLength);
        const up = runLength(x, y, 0, -1, threshold, armLength);
        const down = runLength(x, y, 0, 1, threshold, armLength);
        const horizontalReach = Math.max(left, right);
        const verticalReach = Math.max(up, down);

        if (horizontalReach < 2 || verticalReach < 2) {
          continue;
        }

        const elbowBonus = (
          (left >= 2 && up >= 2) ||
          (left >= 2 && down >= 2) ||
          (right >= 2 && up >= 2) ||
          (right >= 2 && down >= 2)
        ) ? 6 : 0;

        const score = (horizontalReach * 3) + (verticalReach * 3) + elbowBonus - distance;
        if (score > bestCornerScore) {
          bestCornerScore = score;
          bestCorner = { x, y };
        }
      }
    }

    return bestCorner || bestDarkPixel;
  };

  const scoreVerticalEdge = (candidateX, y1, y2, threshold, bandHalfWidth) => {
    let matches = 0;
    let totalContrast = 0;
    const startY = clamp(Math.floor(Math.min(y1, y2)), 0, image.height - 1);
    const endY = clamp(Math.ceil(Math.max(y1, y2)), 0, image.height - 1);

    for (let y = startY; y <= endY; y += 1) {
      const leftSamples = [];
      const rightSamples = [];

      for (let offset = 1; offset <= bandHalfWidth; offset += 1) {
        leftSamples.push(getGray(candidateX - offset, y));
        rightSamples.push(getGray(candidateX + offset, y));
      }

      const leftMean = average(leftSamples);
      const rightMean = average(rightSamples);
      const contrast = Math.abs(leftMean - rightMean);
      const hasDarkSide = Math.min(leftMean, rightMean) <= threshold;
      const hasLightSide = Math.max(leftMean, rightMean) > threshold;

      if (hasDarkSide && hasLightSide && contrast >= 18) {
        matches += 1;
        totalContrast += contrast;
      }
    }

    return { matches, totalContrast };
  };

  const scoreHorizontalEdge = (candidateY, x1, x2, threshold, bandHalfWidth) => {
    let matches = 0;
    let totalContrast = 0;
    const startX = clamp(Math.floor(Math.min(x1, x2)), 0, image.width - 1);
    const endX = clamp(Math.ceil(Math.max(x1, x2)), 0, image.width - 1);

    for (let x = startX; x <= endX; x += 1) {
      const topSamples = [];
      const bottomSamples = [];

      for (let offset = 1; offset <= bandHalfWidth; offset += 1) {
        topSamples.push(getGray(x, candidateY - offset));
        bottomSamples.push(getGray(x, candidateY + offset));
      }

      const topMean = average(topSamples);
      const bottomMean = average(bottomSamples);
      const contrast = Math.abs(topMean - bottomMean);
      const hasDarkSide = Math.min(topMean, bottomMean) <= threshold;
      const hasLightSide = Math.max(topMean, bottomMean) > threshold;

      if (hasDarkSide && hasLightSide && contrast >= 18) {
        matches += 1;
        totalContrast += contrast;
      }
    }

    return { matches, totalContrast };
  };

  const findVerticalEdge = (targetX, y1, y2, overrideOptions = {}) => {
    const searchRadius = overrideOptions.searchRadius ?? options.edgeSearchRadius;
    const bandHalfWidth = overrideOptions.bandHalfWidth ?? options.edgeBandHalfWidth;
    const spanHeight = Math.abs(y2 - y1);
    const threshold = getLocalThreshold(targetX, (y1 + y2) / 2, Math.max(searchRadius + 4, spanHeight / 2));
    const startX = clamp(Math.floor(targetX - searchRadius), 1, image.width - 2);
    const endX = clamp(Math.ceil(targetX + searchRadius), 1, image.width - 2);

    let best = null;

    for (let x = startX; x <= endX; x += 1) {
      const score = scoreVerticalEdge(x, y1, y2, threshold, bandHalfWidth);
      if (score.matches < (overrideOptions.minEdgeSamples ?? options.minEdgeSamples)) {
        continue;
      }

      const distance = Math.abs(x - targetX);
      if (!best || score.matches > best.matches || (score.matches === best.matches && score.totalContrast > best.totalContrast) || (score.matches === best.matches && score.totalContrast === best.totalContrast && distance < best.distance)) {
        best = { x, ...score, distance };
      }
    }

    return best ? best.x : null;
  };

  const findHorizontalEdge = (targetY, x1, x2, overrideOptions = {}) => {
    const searchRadius = overrideOptions.searchRadius ?? options.edgeSearchRadius;
    const bandHalfWidth = overrideOptions.bandHalfWidth ?? options.edgeBandHalfWidth;
    const spanWidth = Math.abs(x2 - x1);
    const threshold = getLocalThreshold((x1 + x2) / 2, targetY, Math.max(searchRadius + 4, spanWidth / 2));
    const startY = clamp(Math.floor(targetY - searchRadius), 1, image.height - 2);
    const endY = clamp(Math.ceil(targetY + searchRadius), 1, image.height - 2);

    let best = null;

    for (let y = startY; y <= endY; y += 1) {
      const score = scoreHorizontalEdge(y, x1, x2, threshold, bandHalfWidth);
      if (score.matches < (overrideOptions.minEdgeSamples ?? options.minEdgeSamples)) {
        continue;
      }

      const distance = Math.abs(y - targetY);
      if (!best || score.matches > best.matches || (score.matches === best.matches && score.totalContrast > best.totalContrast) || (score.matches === best.matches && score.totalContrast === best.totalContrast && distance < best.distance)) {
        best = { y, ...score, distance };
      }
    }

    return best ? best.y : null;
  };

  return {
    width: image.width,
    height: image.height,
    threshold: globalThreshold,
    findVertexSnap,
    findVerticalEdge,
    findHorizontalEdge,
  };
};
