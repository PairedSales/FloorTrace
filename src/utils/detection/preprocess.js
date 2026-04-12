const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export const toGrayscale = (rgba, width, height) => {
  const gray = new Uint8ClampedArray(width * height);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 1) {
    // Integer approximation of ITU-R BT.601 luma: (r*77 + g*150 + b*29) >> 8
    gray[j] = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8;
  }
  return gray;
};

export const boxBlurGray = (gray, width, height, radius = 1) => {
  if (radius <= 0) return gray;

  // Separable two-pass box blur: horizontal then vertical.
  // Each pass is O(width × height) regardless of radius.
  const tmp = new Uint8ClampedArray(gray.length);
  const out = new Uint8ClampedArray(gray.length);

  // Horizontal pass → tmp
  for (let y = 0; y < height; y += 1) {
    const rowOff = y * width;
    let sum = 0;
    // Seed the running sum for x = 0
    for (let kx = 0; kx <= radius && kx < width; kx += 1) sum += gray[rowOff + kx];
    let left = 0;               // leftmost index in window
    let right = radius;         // rightmost index in window
    let count = right - left + 1;

    for (let x = 0; x < width; x += 1) {
      tmp[rowOff + x] = (sum / count + 0.5) | 0;
      // Slide window right
      const newRight = x + radius + 1;
      const oldLeft = x - radius;
      if (newRight < width) { sum += gray[rowOff + newRight]; right = newRight; }
      if (oldLeft >= 0)     { sum -= gray[rowOff + oldLeft];  left = oldLeft + 1; }
      count = right - left + 1;
    }
  }

  // Vertical pass → out
  for (let x = 0; x < width; x += 1) {
    let sum = 0;
    for (let ky = 0; ky <= radius && ky < height; ky += 1) sum += tmp[ky * width + x];
    let top = 0;
    let bottom = Math.min(radius, height - 1);
    let count = bottom - top + 1;

    for (let y = 0; y < height; y += 1) {
      out[y * width + x] = (sum / count + 0.5) | 0;
      const newBottom = y + radius + 1;
      const oldTop = y - radius;
      if (newBottom < height) { sum += tmp[newBottom * width + x]; bottom = newBottom; }
      if (oldTop >= 0)        { sum -= tmp[oldTop * width + x];    top = oldTop + 1; }
      count = bottom - top + 1;
    }
  }

  return out;
};

export const adaptiveThreshold = (gray, width, height, options = {}) => {
  const radius = options.windowRadius ?? 8;
  const bias = options.bias ?? 8;
  const mask = new Uint8Array(width * height);

  // Build integral image (summed-area table) for O(1) window sums.
  // Use Float64Array to avoid overflow on large images.
  const sat = new Float64Array(width * height);
  for (let y = 0; y < height; y += 1) {
    let rowSum = 0;
    for (let x = 0; x < width; x += 1) {
      rowSum += gray[y * width + x];
      sat[y * width + x] = rowSum + (y > 0 ? sat[(y - 1) * width + x] : 0);
    }
  }

  for (let y = 0; y < height; y += 1) {
    const y0 = Math.max(0, y - radius) - 1;
    const y1 = Math.min(height - 1, y + radius);
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.max(0, x - radius) - 1;
      const x1 = Math.min(width - 1, x + radius);

      // Sum of pixels in the window via the integral image
      let sum = sat[y1 * width + x1];
      if (x0 >= 0) sum -= sat[y1 * width + x0];
      if (y0 >= 0) sum -= sat[y0 * width + x1];
      if (x0 >= 0 && y0 >= 0) sum += sat[y0 * width + x0];

      const count = (y1 - Math.max(0, y - radius) + 1) * (x1 - Math.max(0, x - radius) + 1);
      const localMean = sum / count;
      const idx = y * width + x;
      mask[idx] = gray[idx] < localMean - bias ? 1 : 0;
    }
  }

  return mask;
};

export const resizeNearest = (source, sourceWidth, sourceHeight, targetWidth, targetHeight) => {
  const target = new Uint8Array(targetWidth * targetHeight);
  const scaleX = sourceWidth / targetWidth;
  const scaleY = sourceHeight / targetHeight;

  for (let y = 0; y < targetHeight; y += 1) {
    const sy = Math.min(sourceHeight - 1, Math.floor(y * scaleY));
    for (let x = 0; x < targetWidth; x += 1) {
      const sx = Math.min(sourceWidth - 1, Math.floor(x * scaleX));
      target[y * targetWidth + x] = source[sy * sourceWidth + sx];
    }
  }

  return target;
};

export const normalizeImageData = (imageData, options = {}) => {
  const maxDim = options.maxDimension ?? 1400;
  const originalWidth = imageData.width;
  const originalHeight = imageData.height;
  const longest = Math.max(originalWidth, originalHeight);
  const scale = longest > maxDim ? maxDim / longest : 1;
  const width = Math.max(1, Math.round(originalWidth * scale));
  const height = Math.max(1, Math.round(originalHeight * scale));

  const gray = toGrayscale(imageData.data, originalWidth, originalHeight);
  const blurred = boxBlurGray(gray, originalWidth, originalHeight, options.blurRadius ?? 1);
  const resizedGray = scale === 1
    ? blurred
    : resizeNearest(blurred, originalWidth, originalHeight, width, height);
  const wallMask = adaptiveThreshold(resizedGray, width, height, options.threshold);

  return {
    width,
    height,
    scale,
    originalWidth,
    originalHeight,
    gray: resizedGray,
    wallMask,
  };
};

export const mapPointToNormalized = (point, scale) => ({
  x: clamp(Math.round(point.x * scale), 0, Number.MAX_SAFE_INTEGER),
  y: clamp(Math.round(point.y * scale), 0, Number.MAX_SAFE_INTEGER),
});

export const mapPointFromNormalized = (point, scale) => ({
  x: point.x / scale,
  y: point.y / scale,
});
