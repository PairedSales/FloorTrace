const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const loadImageElement = (src) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = reject;
  img.src = src;
});

const CORNER_BOX_HALF = 15; // 30x30 search
const WALL_STRIP_HALF = 15; // 30 columns / rows
const QUADRANT_OFFSET = 4;
const MIN_CORNER_SCORE = 2.15;
const WALL_DARK_RATIO = 0.4;

/**
 * @param {Uint8Array} isDark
 * @param {number} width
 * @param {number} height
 */
const regionDarkFraction = (isDark, width, height, x0, x1, y0, y1) => {
  const xa = clamp(Math.min(x0, x1), 0, width - 1);
  const xb = clamp(Math.max(x0, x1), 0, width - 1);
  const ya = clamp(Math.min(y0, y1), 0, height - 1);
  const yb = clamp(Math.max(y0, y1), 0, height - 1);
  if (xb < xa || yb < ya) return null;

  let dark = 0;
  const total = (xb - xa + 1) * (yb - ya + 1);
  for (let y = ya; y <= yb; y += 1) {
    const row = y * width;
    for (let x = xa; x <= xb; x += 1) {
      if (isDark[row + x]) dark += 1;
    }
  }
  return dark / total;
};

/**
 * NW, NE, SW, SE dark fractions. Returns null if any quadrant has no pixels.
 */
const quadrantDarkFractions = (isDark, width, height, px, py, d) => {
  const nw = regionDarkFraction(isDark, width, height, px - d, px - 1, py - d, py - 1);
  const ne = regionDarkFraction(isDark, width, height, px + 1, px + d, py - d, py - 1);
  const sw = regionDarkFraction(isDark, width, height, px - d, px - 1, py + 1, py + d);
  const se = regionDarkFraction(isDark, width, height, px + 1, px + d, py + 1, py + d);
  if (nw === null || ne === null || sw === null || se === null) return null;
  return [nw, ne, sw, se];
};

const hasNeighborDark = (isDark, width, height, px, py) => {
  const neighbors = [[0, -1], [0, 1], [-1, 0], [1, 0]];
  for (const [dx, dy] of neighbors) {
    const x = px + dx;
    const y = py + dy;
    if (x < 0 || x >= width || y < 0 || y >= height) continue;
    if (isDark[y * width + x]) return true;
  }
  return false;
};

const cornerScoreFromQuadrants = (fracs) => {
  let score = 0;
  for (const f of fracs) {
    score += f > 0.5 ? f : (1 - f);
  }
  return score;
};

/**
 * @param {string} imageSrc
 * @returns {Promise<{ findCornerSnap: Function, findVerticalWall: Function, findHorizontalWall: Function }>}
 */
export const createImageSnapAnalyzer = async (imageSrc) => {
  if (!imageSrc) {
    const noop = () => null;
    return {
      findCornerSnap: noop,
      findVerticalWall: noop,
      findHorizontalWall: noop,
    };
  }

  const image = await loadImageElement(imageSrc);
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0);
  const { data } = ctx.getImageData(0, 0, width, height);

  const grayscale = new Uint8Array(width * height);
  let sum = 0;
  for (let i = 0; i < grayscale.length; i += 1) {
    const o = i * 4;
    const v = Math.round(
      data[o] * 0.299 +
      data[o + 1] * 0.587 +
      data[o + 2] * 0.114
    );
    grayscale[i] = v;
    sum += v;
  }

  const mean = sum / grayscale.length;
  const threshold = clamp(mean - 24, 35, 220);
  const isDark = new Uint8Array(width * height);
  for (let i = 0; i < grayscale.length; i += 1) {
    isDark[i] = grayscale[i] <= threshold ? 1 : 0;
  }

  const findCornerSnap = (point) => {
    if (!point || width < 1 || height < 1) return null;

    const cx = Math.round(point.x);
    const cy = Math.round(point.y);
    const x0 = clamp(cx - CORNER_BOX_HALF, 0, width - 1);
    const y0 = clamp(cy - CORNER_BOX_HALF, 0, height - 1);
    const x1 = clamp(cx + CORNER_BOX_HALF - 1, 0, width - 1);
    const y1 = clamp(cy + CORNER_BOX_HALF - 1, 0, height - 1);

    let best = null;
    let bestDistSq = Number.POSITIVE_INFINITY;
    let bestScore = -1;

    for (let py = y0; py <= y1; py += 1) {
      const row = py * width;
      for (let px = x0; px <= x1; px += 1) {
        const idx = row + px;
        if (!isDark[idx] && !hasNeighborDark(isDark, width, height, px, py)) {
          continue;
        }

        const fracs = quadrantDarkFractions(isDark, width, height, px, py, QUADRANT_OFFSET);
        if (!fracs) continue;

        const nDark = fracs.filter((f) => f > 0.5).length;
        if (nDark !== 1 && nDark !== 3) continue;

        const score = cornerScoreFromQuadrants(fracs);
        if (score < MIN_CORNER_SCORE) continue;

        const dx = px - point.x;
        const dy = py - point.y;
        const distSq = dx * dx + dy * dy;

        if (
          distSq < bestDistSq ||
          (distSq === bestDistSq && score > bestScore)
        ) {
          bestDistSq = distSq;
          bestScore = score;
          best = { x: px, y: py };
        }
      }
    }

    return best;
  };

  const findVerticalWall = (targetX, y1, y2, options = {}) => {
    const halfStrip = options.searchRadius ?? WALL_STRIP_HALF;
    const minRatio = options.minDarkRatio ?? WALL_DARK_RATIO;

    const yLo = clamp(Math.round(Math.min(y1, y2)), 0, height - 1);
    const yHi = clamp(Math.round(Math.max(y1, y2)), 0, height - 1);
    const span = Math.max(1, yHi - yLo + 1);

    const xCenter = Math.round(targetX);
    let bestX = null;
    let bestDist = Number.POSITIVE_INFINITY;
    let bestDensity = -1;

    for (let dx = -halfStrip; dx <= halfStrip; dx += 1) {
      const x = xCenter + dx;
      if (x < 0 || x >= width) continue;

      let dark = 0;
      for (let y = yLo; y <= yHi; y += 1) {
        if (isDark[y * width + x]) dark += 1;
      }
      const density = dark / span;
      if (density < minRatio) continue;

      const dist = Math.abs(x - targetX);
      if (dist < bestDist || (dist === bestDist && density > bestDensity)) {
        bestDist = dist;
        bestDensity = density;
        bestX = x;
      }
    }

    return bestX;
  };

  const findHorizontalWall = (targetY, x1, x2, options = {}) => {
    const halfStrip = options.searchRadius ?? WALL_STRIP_HALF;
    const minRatio = options.minDarkRatio ?? WALL_DARK_RATIO;

    const xLo = clamp(Math.round(Math.min(x1, x2)), 0, width - 1);
    const xHi = clamp(Math.round(Math.max(x1, x2)), 0, width - 1);
    const span = Math.max(1, xHi - xLo + 1);

    const yCenter = Math.round(targetY);
    let bestY = null;
    let bestDist = Number.POSITIVE_INFINITY;
    let bestDensity = -1;

    for (let dy = -halfStrip; dy <= halfStrip; dy += 1) {
      const y = yCenter + dy;
      if (y < 0 || y >= height) continue;

      const row = y * width;
      let dark = 0;
      for (let x = xLo; x <= xHi; x += 1) {
        if (isDark[row + x]) dark += 1;
      }
      const density = dark / span;
      if (density < minRatio) continue;

      const dist = Math.abs(y - targetY);
      if (dist < bestDist || (dist === bestDist && density > bestDensity)) {
        bestDist = dist;
        bestDensity = density;
        bestY = y;
      }
    }

    return bestY;
  };

  return {
    findCornerSnap,
    findVerticalWall,
    findHorizontalWall,
  };
};
