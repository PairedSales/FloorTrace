// Binary raster primitives for the detection pipeline. Masks are
// Uint8Array(width * height) with 1 = ink. Pure JS so the identical code runs
// in the browser worker and the Node benchmark harness.

export const toGrayscale = (rgba, pixelCount) => {
  const gray = new Uint8ClampedArray(pixelCount);
  for (let i = 0, j = 0; j < pixelCount; i += 4, j += 1) {
    // ITU-R BT.601 luma, integer approximation
    gray[j] = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8;
  }
  return gray;
};

export const otsuThreshold = (gray) => {
  const hist = new Uint32Array(256);
  for (let i = 0; i < gray.length; i += 1) hist[gray[i]] += 1;
  const total = gray.length;
  let sumAll = 0;
  for (let t = 0; t < 256; t += 1) sumAll += t * hist[t];

  let sumBg = 0;
  let weightBg = 0;
  let best = 127;
  let bestVar = -1;
  for (let t = 0; t < 256; t += 1) {
    weightBg += hist[t];
    if (weightBg === 0) continue;
    const weightFg = total - weightBg;
    if (weightFg === 0) break;
    sumBg += t * hist[t];
    const meanBg = sumBg / weightBg;
    const meanFg = (sumAll - sumBg) / weightFg;
    const between = weightBg * weightFg * (meanBg - meanFg) * (meanBg - meanFg);
    if (between > bestVar) {
      bestVar = between;
      best = t;
    }
  }
  return best;
};

// Binarize at full resolution, then OR-pool down to the working scale so
// 1-pixel lines survive the downscale (nearest-neighbour would drop them).
export const binarizeToWorkingScale = (imageData, maxDimension = 1400) => {
  const ow = imageData.width;
  const oh = imageData.height;
  const gray = toGrayscale(imageData.data, ow * oh);
  // Clamp Otsu away from extremes so faint paper texture or near-black scans
  // still split ink from paper sensibly.
  const threshold = Math.min(Math.max(otsuThreshold(gray), 60), 220);

  const longest = Math.max(ow, oh);
  const width = longest > maxDimension ? Math.max(1, Math.round((ow * maxDimension) / longest)) : ow;
  const height = longest > maxDimension ? Math.max(1, Math.round((oh * maxDimension) / longest)) : oh;
  const ink = new Uint8Array(width * height);
  const grayWork = new Uint8Array(width * height);

  if (width === ow && height === oh) {
    for (let i = 0; i < gray.length; i += 1) {
      ink[i] = gray[i] < threshold ? 1 : 0;
      grayWork[i] = gray[i];
    }
  } else {
    // Box-average the grayscale alongside the OR-pooled ink (screened fills
    // must keep their tone at working scale for shaded-region detection).
    const sums = new Float64Array(width * height);
    const counts = new Uint32Array(width * height);
    for (let sy = 0; sy < oh; sy += 1) {
      const ty = Math.min(height - 1, (sy * height / oh) | 0);
      const srcRow = sy * ow;
      const dstRow = ty * width;
      for (let sx = 0; sx < ow; sx += 1) {
        const tx = Math.min(width - 1, (sx * width / ow) | 0);
        if (gray[srcRow + sx] < threshold) ink[dstRow + tx] = 1;
        sums[dstRow + tx] += gray[srcRow + sx];
        counts[dstRow + tx] += 1;
      }
    }
    for (let i = 0; i < grayWork.length; i += 1) {
      grayWork[i] = counts[i] > 0 ? Math.round(sums[i] / counts[i]) : 255;
    }
  }

  return { width, height, scaleX: width / ow, scaleY: height / oh, ink, gray: grayWork, threshold };
};

// 1D dilation along rows: pixel on if any ink within +-r in its row.
export const dilateRows = (mask, width, height, r) => {
  if (r <= 0) return mask.slice();
  const out = new Uint8Array(mask.length);
  const INF = width + r + 1;
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    let dist = INF;
    for (let x = 0; x < width; x += 1) {
      dist = mask[row + x] ? 0 : dist + 1;
      if (dist <= r) out[row + x] = 1;
    }
    dist = INF;
    for (let x = width - 1; x >= 0; x -= 1) {
      dist = mask[row + x] ? 0 : dist + 1;
      if (dist <= r) out[row + x] = 1;
    }
  }
  return out;
};

export const dilateCols = (mask, width, height, r) => {
  if (r <= 0) return mask.slice();
  const out = new Uint8Array(mask.length);
  const INF = height + r + 1;
  for (let x = 0; x < width; x += 1) {
    let dist = INF;
    for (let y = 0; y < height; y += 1) {
      const idx = y * width + x;
      dist = mask[idx] ? 0 : dist + 1;
      if (dist <= r) out[idx] = 1;
    }
    dist = INF;
    for (let y = height - 1; y >= 0; y -= 1) {
      const idx = y * width + x;
      dist = mask[idx] ? 0 : dist + 1;
      if (dist <= r) out[idx] = 1;
    }
  }
  return out;
};

// 1D erosion (border counts as background, matching OpenCV's default).
export const erodeRows = (mask, width, height, r) => {
  if (r <= 0) return mask.slice();
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    let x = 0;
    while (x < width) {
      if (!mask[row + x]) {
        x += 1;
        continue;
      }
      let end = x;
      while (end < width && mask[row + end]) end += 1;
      const from = x + r;
      const to = end - 1 - r;
      for (let k = from; k <= to; k += 1) out[row + k] = 1;
      x = end;
    }
  }
  return out;
};

export const erodeCols = (mask, width, height, r) => {
  if (r <= 0) return mask.slice();
  const out = new Uint8Array(mask.length);
  for (let x = 0; x < width; x += 1) {
    let y = 0;
    while (y < height) {
      if (!mask[y * width + x]) {
        y += 1;
        continue;
      }
      let end = y;
      while (end < height && mask[end * width + x]) end += 1;
      const from = y + r;
      const to = end - 1 - r;
      for (let k = from; k <= to; k += 1) out[k * width + x] = 1;
      y = end;
    }
  }
  return out;
};

export const dilateRect = (mask, width, height, r) =>
  dilateCols(dilateRows(mask, width, height, r), width, height, r);

export const erodeRect = (mask, width, height, r) =>
  erodeCols(erodeRows(mask, width, height, r), width, height, r);

// Closing runs on a mask padded by r so content near the image border is not
// eroded away — without padding, a wall hugging the edge vanishes once the
// closing radius exceeds its distance to the border, guaranteeing seal leaks
// on tightly-cropped floorplans.
export const closeRect = (mask, width, height, r) => {
  if (r <= 0) return mask.slice();
  const pw = width + 2 * r;
  const ph = height + 2 * r;
  const padded = new Uint8Array(pw * ph);
  for (let y = 0; y < height; y += 1) {
    padded.set(mask.subarray(y * width, y * width + width), (y + r) * pw + r);
  }
  const closed = erodeRect(dilateRect(padded, pw, ph, r), pw, ph, r);
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    out.set(closed.subarray((y + r) * pw + r, (y + r) * pw + r + width), y * width);
  }
  return out;
};

export const openRect = (mask, width, height, r) =>
  dilateRect(erodeRect(mask, width, height, r), width, height, r);

// Fill gaps of <= maxGap between colinear ink runs along rows and columns —
// window spans interrupting exterior walls — without the corner rounding or
// notch filling a large square closing would cause. A gap is only bridged
// between runs at least minFlank long: window gaps sit between long chunks of
// the same wall, whereas the mouth of a genuine notch in the outline is
// flanked by a perpendicular wall's thin cross-section. Sub-flank runs inside
// a gap (window sill ticks, dashed openings) neither bridge nor break it.
export const bridgeRuns = (mask, width, height, maxGap, minFlank = 0) => {
  const out = mask.slice();
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    let lastEnd = -1;
    let x = 0;
    while (x < width) {
      if (!mask[row + x]) {
        x += 1;
        continue;
      }
      let end = x;
      while (end < width && mask[row + end]) end += 1;
      if (end - x >= minFlank) {
        if (lastEnd >= 0 && x - lastEnd <= maxGap) {
          for (let k = lastEnd; k < x; k += 1) out[row + k] = 1;
        }
        lastEnd = end;
      }
      x = end;
    }
  }
  for (let x = 0; x < width; x += 1) {
    let lastEnd = -1;
    let y = 0;
    while (y < height) {
      if (!mask[y * width + x]) {
        y += 1;
        continue;
      }
      let end = y;
      while (end < height && mask[end * width + x]) end += 1;
      if (end - y >= minFlank) {
        if (lastEnd >= 0 && y - lastEnd <= maxGap) {
          for (let k = lastEnd; k < y; k += 1) out[k * width + x] = 1;
        }
        lastEnd = end;
      }
      y = end;
    }
  }
  return out;
};

// Run-length opening: keep only runs of >= minLen along a scan direction.
// Equivalent to morphological opening with a 1xL line kernel, but exact for
// any L and cheap. Directions: 'h', 'v', 'd' (\), 'a' (/).
export const keepLongRuns = (mask, width, height, minLen, direction) => {
  const out = new Uint8Array(mask.length);

  const scanLine = (startIdx, stepIdx, count) => {
    let runStart = -1;
    for (let i = 0; i <= count; i += 1) {
      const on = i < count && mask[startIdx + i * stepIdx];
      if (on && runStart < 0) runStart = i;
      if (!on && runStart >= 0) {
        if (i - runStart >= minLen) {
          for (let k = runStart; k < i; k += 1) out[startIdx + k * stepIdx] = 1;
        }
        runStart = -1;
      }
    }
  };

  if (direction === 'h') {
    for (let y = 0; y < height; y += 1) scanLine(y * width, 1, width);
  } else if (direction === 'v') {
    for (let x = 0; x < width; x += 1) scanLine(x, width, height);
  } else if (direction === 'd') {
    // top-left -> bottom-right diagonals
    for (let x = 0; x < width; x += 1) scanLine(x, width + 1, Math.min(height, width - x));
    for (let y = 1; y < height; y += 1) scanLine(y * width, width + 1, Math.min(width, height - y));
  } else {
    // top-right -> bottom-left anti-diagonals
    for (let x = 0; x < width; x += 1) scanLine(x, width - 1, Math.min(height, x + 1));
    for (let y = 1; y < height; y += 1) {
      scanLine(y * width + width - 1, width - 1, Math.min(width, height - y));
    }
  }
  return out;
};

export const orMasks = (target, source) => {
  for (let i = 0; i < target.length; i += 1) if (source[i]) target[i] = 1;
  return target;
};

export const labelComponents = (mask, width, height) => {
  const labels = new Int32Array(width * height).fill(-1);
  const queue = new Int32Array(width * height);
  const components = [];

  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || labels[start] !== -1) continue;
    const id = components.length;
    let head = 0;
    let tail = 0;
    queue[tail] = start;
    tail += 1;
    labels[start] = id;
    let size = 0;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;

    while (head < tail) {
      const idx = queue[head];
      head += 1;
      const x = idx % width;
      const y = (idx / width) | 0;
      size += 1;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      if (x + 1 < width && mask[idx + 1] && labels[idx + 1] === -1) {
        labels[idx + 1] = id;
        queue[tail] = idx + 1;
        tail += 1;
      }
      if (x > 0 && mask[idx - 1] && labels[idx - 1] === -1) {
        labels[idx - 1] = id;
        queue[tail] = idx - 1;
        tail += 1;
      }
      if (y + 1 < height && mask[idx + width] && labels[idx + width] === -1) {
        labels[idx + width] = id;
        queue[tail] = idx + width;
        tail += 1;
      }
      if (y > 0 && mask[idx - width] && labels[idx - width] === -1) {
        labels[idx - width] = id;
        queue[tail] = idx - width;
        tail += 1;
      }
    }

    components.push({ id, size, bbox: { minX, minY, maxX, maxY } });
  }

  return { labels, components };
};

// Flood the background reachable from the image border (4-connected).
export const floodOutside = (mask, width, height) => {
  const outside = new Uint8Array(mask.length);
  const queue = new Int32Array(mask.length);
  let tail = 0;
  const seed = (idx) => {
    if (!mask[idx] && !outside[idx]) {
      outside[idx] = 1;
      queue[tail] = idx;
      tail += 1;
    }
  };
  for (let x = 0; x < width; x += 1) {
    seed(x);
    seed((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    seed(y * width);
    seed(y * width + width - 1);
  }
  let head = 0;
  while (head < tail) {
    const idx = queue[head];
    head += 1;
    const x = idx % width;
    const y = (idx / width) | 0;
    if (x + 1 < width) seed(idx + 1);
    if (x > 0) seed(idx - 1);
    if (y + 1 < height) seed(idx + width);
    if (y > 0) seed(idx - width);
  }
  return outside;
};

// Padded summed-area table: sat[(y+1)*(w+1)+(x+1)] = sum over [0..x][0..y].
export const buildSat = (mask, width, height) => {
  const sw = width + 1;
  const sat = new Uint32Array(sw * (height + 1));
  for (let y = 0; y < height; y += 1) {
    let rowSum = 0;
    const row = y * width;
    const satRow = (y + 1) * sw;
    for (let x = 0; x < width; x += 1) {
      rowSum += mask[row + x];
      sat[satRow + x + 1] = sat[satRow - sw + x + 1] + rowSum;
    }
  }
  return sat;
};

// Inclusive-rectangle sum; coordinates are clamped to the mask bounds.
export const satSum = (sat, width, height, x0, y0, x1, y1) => {
  const sw = width + 1;
  const ax = Math.max(0, x0);
  const ay = Math.max(0, y0);
  const bx = Math.min(width - 1, x1);
  const by = Math.min(height - 1, y1);
  if (bx < ax || by < ay) return 0;
  return sat[(by + 1) * sw + bx + 1] - sat[ay * sw + bx + 1]
    - sat[(by + 1) * sw + ax] + sat[ay * sw + ax];
};
