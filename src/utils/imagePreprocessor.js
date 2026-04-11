/**
 * Image Preprocessing Module
 * 
 * Preprocessing utilities for floor plan images including:
 * - Grayscale conversion
 * - Otsu thresholding
 * - Contrast stretching
 * - Grayscale-to-thresholded-canvas conversion
 */

/**
 * Convert image data to grayscale
 * @param {ImageData} imageData - RGBA image data
 * @returns {Uint8Array} Grayscale image (1 channel)
 */
export const toGrayscale = (imageData) => {
  const { data, width, height } = imageData;
  const gray = new Uint8Array(width * height);
  
  for (let i = 0; i < data.length; i += 4) {
    // Use standard luminance weights
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    gray[i / 4] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  }
  
  return gray;
};

/**
 * Otsu's method for automatic threshold calculation
 * @param {Uint8Array} gray - Grayscale image
 * @returns {number} Optimal threshold value
 */
export const otsuThreshold = (gray) => {
  // Calculate histogram
  const histogram = new Array(256).fill(0);
  for (let i = 0; i < gray.length; i++) {
    histogram[gray[i]]++;
  }
  
  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) {
    sum += i * histogram[i];
  }
  
  let sumB = 0;
  let wB = 0;
  let wF = 0;
  let maxVariance = 0;
  let threshold = 0;
  
  for (let t = 0; t < 256; t++) {
    wB += histogram[t];
    if (wB === 0) continue;
    
    wF = total - wB;
    if (wF === 0) break;
    
    sumB += t * histogram[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    
    const variance = wB * wF * (mB - mF) * (mB - mF);
    
    if (variance > maxVariance) {
      maxVariance = variance;
      threshold = t;
    }
  }
  
  return threshold;
};

/**
 * Stretch contrast so the grayscale range maps to [0, 255].
 * @param {Uint8Array} gray - Grayscale image
 * @returns {Uint8Array} Contrast-stretched grayscale image
 */
export const contrastStretch = (gray) => {
  let min = 255;
  let max = 0;
  for (let i = 0; i < gray.length; i++) {
    if (gray[i] < min) min = gray[i];
    if (gray[i] > max) max = gray[i];
  }

  if (max === min) return new Uint8Array(gray);

  const range = max - min;
  const result = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i++) {
    result[i] = Math.round(((gray[i] - min) / range) * 255);
  }
  return result;
};

/**
 * Apply unsharp-mask sharpening to a grayscale image.
 * Enhances edges/details (helpful for blurred tick marks ' and ").
 * Uses a 3×3 Gaussian blur approximation then amplifies the difference.
 * @param {Uint8Array} gray - Grayscale image
 * @param {number} width
 * @param {number} height
 * @param {number} amount - Sharpening strength (default 1.5)
 * @returns {Uint8Array} Sharpened grayscale image
 */
export const sharpen = (gray, width, height, amount = 1.5) => {
  const result = new Uint8Array(gray.length);
  // 3×3 Gaussian kernel weights (σ ≈ 0.85): center 4, edges 2, corners 1
  // divisor = 16
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (x === 0 || x === width - 1 || y === 0 || y === height - 1) {
        result[idx] = gray[idx];
        continue;
      }
      const blur =
        (gray[idx - width - 1] + 2 * gray[idx - width] + gray[idx - width + 1] +
         2 * gray[idx - 1] + 4 * gray[idx] + 2 * gray[idx + 1] +
         gray[idx + width - 1] + 2 * gray[idx + width] + gray[idx + width + 1]) / 16;
      const sharp = gray[idx] + amount * (gray[idx] - blur);
      result[idx] = Math.max(0, Math.min(255, Math.round(sharp)));
    }
  }
  return result;
};

/**
 * Convert a Uint8Array grayscale + Otsu-threshold to an RGBA canvas suitable for Tesseract.
 * Pixels below threshold become black, above become white.
 * @param {Uint8Array} gray - Grayscale values
 * @param {number} width
 * @param {number} height
 * @param {number} threshold - 0-255 cutoff
 * @returns {HTMLCanvasElement}
 */
export const grayToThresholdedCanvas = (gray, width, height, threshold) => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const out = ctx.createImageData(width, height);
  const d = out.data;

  for (let i = 0; i < gray.length; i++) {
    const v = gray[i] < threshold ? 0 : 255;
    const j = i * 4;
    d[j] = v;
    d[j + 1] = v;
    d[j + 2] = v;
    d[j + 3] = 255;
  }

  ctx.putImageData(out, 0, 0);
  return canvas;
};
