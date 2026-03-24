const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export const toGrayscale = (rgba, width, height) => {
  const gray = new Uint8ClampedArray(width * height);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 1) {
    gray[j] = Math.round((rgba[i] * 299 + rgba[i + 1] * 587 + rgba[i + 2] * 114) / 1000);
  }
  return gray;
};

export const boxBlurGray = (gray, width, height, radius = 1) => {
  if (radius <= 0) return gray;

  const out = new Uint8ClampedArray(gray.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      let count = 0;
      for (let ky = -radius; ky <= radius; ky += 1) {
        const py = y + ky;
        if (py < 0 || py >= height) continue;
        for (let kx = -radius; kx <= radius; kx += 1) {
          const px = x + kx;
          if (px < 0 || px >= width) continue;
          sum += gray[py * width + px];
          count += 1;
        }
      }
      out[y * width + x] = Math.round(sum / Math.max(count, 1));
    }
  }

  return out;
};

export const adaptiveThreshold = (gray, width, height, options = {}) => {
  const radius = options.windowRadius ?? 8;
  const bias = options.bias ?? 8;
  const mask = new Uint8Array(width * height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      let count = 0;
      for (let ky = -radius; ky <= radius; ky += 1) {
        const py = y + ky;
        if (py < 0 || py >= height) continue;
        for (let kx = -radius; kx <= radius; kx += 1) {
          const px = x + kx;
          if (px < 0 || px >= width) continue;
          sum += gray[py * width + px];
          count += 1;
        }
      }

      const localMean = sum / Math.max(count, 1);
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
