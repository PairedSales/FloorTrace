/**
 * Raster utilities for the dimension-OCR pipeline.
 *
 * Everything here operates on plain objects — grayscale images are
 * `{ data: Uint8Array, width, height }`, RGBA images are ImageData-likes
 * `{ data: Uint8ClampedArray, width, height }` — so the pipeline runs
 * identically in the browser and in Node (tests/benchmarks).
 */

/** RGBA ImageData-like -> grayscale */
export const toGray = (imageData) => {
  const { data, width, height } = imageData;
  const gray = new Uint8Array(width * height);
  for (let i = 0, j = 0; j < gray.length; i += 4, j++) {
    gray[j] = (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8;
  }
  return { data: gray, width, height };
};

/** Grayscale -> RGBA ImageData-like (for OCR engines / canvases) */
export const grayToImageDataLike = (gray) => {
  const { data, width, height } = gray;
  const out = new Uint8ClampedArray(width * height * 4);
  for (let i = 0, j = 0; i < data.length; i++, j += 4) {
    out[j] = data[i];
    out[j + 1] = data[i];
    out[j + 2] = data[i];
    out[j + 3] = 255;
  }
  return { data: out, width, height };
};

/**
 * Contrast Limited Adaptive Histogram Equalization (pure-JS fallback for
 * cv.CLAHE). Normalises uneven scan lighting so faint labels survive
 * binarization. Tile-based with bilinear interpolation between tile LUTs.
 */
export const clahe = (gray, { tiles = 8, clipLimit = 3.0 } = {}) => {
  const { data, width, height } = gray;
  const tileW = Math.max(1, Math.ceil(width / tiles));
  const tileH = Math.max(1, Math.ceil(height / tiles));
  const tilesX = Math.ceil(width / tileW);
  const tilesY = Math.ceil(height / tileH);

  // Build a clipped-equalisation LUT per tile
  const luts = new Uint8Array(tilesX * tilesY * 256);
  const hist = new Uint32Array(256);

  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      hist.fill(0);
      const x0 = tx * tileW;
      const y0 = ty * tileH;
      const x1 = Math.min(x0 + tileW, width);
      const y1 = Math.min(y0 + tileH, height);
      const count = (x1 - x0) * (y1 - y0);

      for (let y = y0; y < y1; y++) {
        const row = y * width;
        for (let x = x0; x < x1; x++) hist[data[row + x]]++;
      }

      // Clip histogram and redistribute excess
      const limit = Math.max(1, Math.round((clipLimit * count) / 256));
      let excess = 0;
      for (let i = 0; i < 256; i++) {
        if (hist[i] > limit) {
          excess += hist[i] - limit;
          hist[i] = limit;
        }
      }
      const bonus = excess / 256;

      // Cumulative LUT
      const lutBase = (ty * tilesX + tx) * 256;
      let cum = 0;
      const scale = 255 / count;
      for (let i = 0; i < 256; i++) {
        cum += hist[i] + bonus;
        luts[lutBase + i] = Math.max(0, Math.min(255, Math.round(cum * scale)));
      }
    }
  }

  // Bilinear interpolation between the four surrounding tile LUTs
  const out = new Uint8Array(data.length);
  for (let y = 0; y < height; y++) {
    const fy = (y - tileH / 2) / tileH;
    const ty0 = Math.max(0, Math.min(tilesY - 1, Math.floor(fy)));
    const ty1 = Math.min(tilesY - 1, ty0 + 1);
    const wy = Math.max(0, Math.min(1, fy - ty0));
    const row = y * width;

    for (let x = 0; x < width; x++) {
      const fx = (x - tileW / 2) / tileW;
      const tx0 = Math.max(0, Math.min(tilesX - 1, Math.floor(fx)));
      const tx1 = Math.min(tilesX - 1, tx0 + 1);
      const wx = Math.max(0, Math.min(1, fx - tx0));
      const v = data[row + x];

      const v00 = luts[(ty0 * tilesX + tx0) * 256 + v];
      const v01 = luts[(ty0 * tilesX + tx1) * 256 + v];
      const v10 = luts[(ty1 * tilesX + tx0) * 256 + v];
      const v11 = luts[(ty1 * tilesX + tx1) * 256 + v];

      out[row + x] = Math.round(
        v00 * (1 - wy) * (1 - wx) + v01 * (1 - wy) * wx +
        v10 * wy * (1 - wx) + v11 * wy * wx
      );
    }
  }

  return { data: out, width, height };
};

/** Unsharp-mask sharpening (3×3 Gaussian approximation). */
export const unsharp = (gray, amount = 1.2) => {
  const { data, width, height } = gray;
  const out = new Uint8Array(data.length);
  out.set(data);

  for (let y = 1; y < height - 1; y++) {
    const row = y * width;
    for (let x = 1; x < width - 1; x++) {
      const i = row + x;
      const blur =
        (data[i - width - 1] + 2 * data[i - width] + data[i - width + 1] +
         2 * data[i - 1] + 4 * data[i] + 2 * data[i + 1] +
         data[i + width - 1] + 2 * data[i + width] + data[i + width + 1]) / 16;
      const v = data[i] + amount * (data[i] - blur);
      out[i] = v < 0 ? 0 : v > 255 ? 255 : v | 0;
    }
  }
  return { data: out, width, height };
};

/** Otsu threshold value for a grayscale image. */
export const otsu = (gray) => {
  const { data } = gray;
  const hist = new Uint32Array(256);
  for (let i = 0; i < data.length; i++) hist[data[i]]++;

  const total = data.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];

  let sumB = 0;
  let wB = 0;
  let maxVar = 0;
  let threshold = 127;

  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > maxVar) {
      maxVar = v;
      threshold = t;
    }
  }
  return threshold;
};

/**
 * Binarize to an ink mask (1 = ink). Automatically inverts white-on-black
 * plans: ink should be the minority of pixels.
 */
export const binarizeInk = (gray, threshold) => {
  const { data, width, height } = gray;
  const t = threshold ?? otsu(gray);
  const mask = new Uint8Array(data.length);
  let dark = 0;
  for (let i = 0; i < data.length; i++) {
    if (data[i] < t) {
      mask[i] = 1;
      dark++;
    }
  }
  if (dark > data.length / 2) {
    for (let i = 0; i < mask.length; i++) mask[i] ^= 1;
  }
  return { data: mask, width, height };
};

/** Nearest-neighbour downsample of a grayscale image by an integer-ish factor. */
export const scaleGray = (gray, factor) => {
  const { data, width, height } = gray;
  const w = Math.max(1, Math.round(width * factor));
  const h = Math.max(1, Math.round(height * factor));
  const out = new Uint8Array(w * h);

  if (factor >= 1) {
    // Bilinear upscale (quality matters when zooming ROIs for OCR)
    const xr = (width - 1) / Math.max(1, w - 1);
    const yr = (height - 1) / Math.max(1, h - 1);
    for (let y = 0; y < h; y++) {
      const sy = y * yr;
      const y0 = Math.floor(sy);
      const y1 = Math.min(height - 1, y0 + 1);
      const fy = sy - y0;
      for (let x = 0; x < w; x++) {
        const sx = x * xr;
        const x0 = Math.floor(sx);
        const x1 = Math.min(width - 1, x0 + 1);
        const fx = sx - x0;
        const v =
          data[y0 * width + x0] * (1 - fy) * (1 - fx) +
          data[y0 * width + x1] * (1 - fy) * fx +
          data[y1 * width + x0] * fy * (1 - fx) +
          data[y1 * width + x1] * fy * fx;
        out[y * w + x] = v | 0;
      }
    }
  } else {
    // Box-average downscale (avoids dropping thin strokes)
    const inv = 1 / factor;
    for (let y = 0; y < h; y++) {
      const sy0 = Math.floor(y * inv);
      const sy1 = Math.min(height, Math.max(sy0 + 1, Math.floor((y + 1) * inv)));
      for (let x = 0; x < w; x++) {
        const sx0 = Math.floor(x * inv);
        const sx1 = Math.min(width, Math.max(sx0 + 1, Math.floor((x + 1) * inv)));
        let sum = 0;
        let n = 0;
        for (let yy = sy0; yy < sy1; yy++) {
          const row = yy * width;
          for (let xx = sx0; xx < sx1; xx++) {
            sum += data[row + xx];
            n++;
          }
        }
        out[y * w + x] = (sum / n) | 0;
      }
    }
  }
  return { data: out, width: w, height: h };
};

/** Crop a grayscale region (clamped to bounds). */
export const cropGray = (gray, x, y, w, h) => {
  const { data, width, height } = gray;
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(width, Math.ceil(x + w));
  const y1 = Math.min(height, Math.ceil(y + h));
  const cw = Math.max(1, x1 - x0);
  const ch = Math.max(1, y1 - y0);
  const out = new Uint8Array(cw * ch);
  for (let yy = 0; yy < ch; yy++) {
    out.set(data.subarray((y0 + yy) * width + x0, (y0 + yy) * width + x0 + cw), yy * cw);
  }
  return { data: out, width: cw, height: ch, offsetX: x0, offsetY: y0 };
};

/** Rotate 90°. dir=1 clockwise, dir=-1 counter-clockwise. */
export const rotateGray90 = (gray, dir) => {
  const { data, width, height } = gray;
  const out = new Uint8Array(data.length);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const v = data[row + x];
      if (dir === 1) {
        out[x * height + (height - 1 - y)] = v; // CW
      } else {
        out[(width - 1 - x) * height + y] = v; // CCW
      }
    }
  }
  return { data: out, width: height, height: width };
};

/** Surround with a white margin — Tesseract misreads edge-touching text. */
export const addBorder = (gray, margin) => {
  const { data, width, height } = gray;
  const w = width + margin * 2;
  const h = height + margin * 2;
  const out = new Uint8Array(w * h).fill(255);
  for (let y = 0; y < height; y++) {
    out.set(data.subarray(y * width, (y + 1) * width), (y + margin) * w + margin);
  }
  return { data: out, width: w, height: h };
};

/** Otsu-binarize to a 0/255 grayscale image (kills anti-aliasing halos). */
export const binarizeGray = (gray) => {
  const t = otsu(gray);
  const out = new Uint8Array(gray.data.length);
  for (let i = 0; i < gray.data.length; i++) out[i] = gray.data[i] < t ? 0 : 255;
  return { data: out, width: gray.width, height: gray.height };
};

/** Min/max contrast stretch with percentile clipping (per-ROI cleanup). */
export const stretchGray = (gray, lowPct = 0.01, highPct = 0.99) => {
  const { data, width, height } = gray;
  const hist = new Uint32Array(256);
  for (let i = 0; i < data.length; i++) hist[data[i]]++;

  const lowCount = data.length * lowPct;
  const highCount = data.length * highPct;
  let cum = 0;
  let lo = 0;
  let hi = 255;
  for (let i = 0; i < 256; i++) {
    cum += hist[i];
    if (cum <= lowCount) lo = i;
    if (cum <= highCount) hi = i;
  }
  if (hi <= lo + 5) return gray;

  const out = new Uint8Array(data.length);
  const scale = 255 / (hi - lo);
  for (let i = 0; i < data.length; i++) {
    const v = (data[i] - lo) * scale;
    out[i] = v < 0 ? 0 : v > 255 ? 255 : v | 0;
  }
  return { data: out, width, height };
};
