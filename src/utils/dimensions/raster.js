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

/** Otsu threshold over histogram bins [lo, hi). */
const otsuHist = (hist, lo, hi) => {
  let total = 0;
  let sum = 0;
  for (let i = lo; i < hi; i++) {
    total += hist[i];
    sum += i * hist[i];
  }
  if (total === 0) return lo;

  let sumB = 0;
  let wB = 0;
  let maxVar = 0;
  let threshold = (lo + hi) >> 1;

  for (let t = lo; t < hi; t++) {
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

const histOf = (gray) => {
  const hist = new Uint32Array(256);
  const { data } = gray;
  for (let i = 0; i < data.length; i++) hist[data[i]]++;
  return hist;
};

/** Otsu threshold value for a grayscale image. */
export const otsu = (gray) => otsuHist(histOf(gray), 0, 256);

/**
 * Fill-aware ink threshold. On colour-styled plans plain Otsu settles between
 * the tinted room fills and the page white, classifying whole floors (and the
 * text sitting on them) as one ink slab. When the dark class comes back
 * implausibly large for line work, try splitting it again: the lower
 * threshold is kept only when it separates two well-spaced modes (true
 * strokes vs fills). A genuinely ink-dense B&W plan has a single dark mode,
 * fails the separation test, and keeps plain Otsu.
 */
export const inkOtsu = (gray) => {
  const hist = histOf(gray);
  const total = gray.data.length;
  const t1 = otsuHist(hist, 0, 256);
  let darkCount = 0;
  for (let v = 0; v < t1; v++) darkCount += hist[v];
  if (darkCount <= 0.14 * total) return t1;

  const t2 = otsuHist(hist, 0, t1);
  let inkCount = 0;
  let inkSum = 0;
  let fillCount = 0;
  let fillSum = 0;
  for (let v = 0; v < t2; v++) {
    inkCount += hist[v];
    inkSum += v * hist[v];
  }
  for (let v = t2; v < t1; v++) {
    fillCount += hist[v];
    fillSum += v * hist[v];
  }
  // Fills must dominate the dark class. When most dark pixels survive the
  // re-split, the "excess" was grey linework/hatching (strokes worth
  // keeping), not tinted room fills — keep plain Otsu.
  if (inkCount < 0.002 * total || inkCount > 0.4 * darkCount || fillCount === 0) return t1;
  return fillSum / fillCount - inkSum / inkCount >= 35 ? t2 : t1;
};

/**
 * Binarize to an ink mask (1 = ink). Automatically inverts white-on-black
 * plans: ink should be the minority of pixels.
 */
export const binarizeInk = (gray, threshold) => {
  const { data, width, height } = gray;
  const t = threshold ?? inkOtsu(gray);
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

/**
 * Mask of dash/dot ruling lines (dashed tray-ceiling boxes, leader lines).
 * Colour-styled plans draw dashed ceiling outlines straight through room
 * labels, and the dash fragments fuse into the glyphs ("21'-3\"" reads
 * "21437"). A ruling line is a long chain of thin colinear segments, or one
 * long thin solid run — the hyphens and tick marks inside a dimension row
 * never chain that far. Glyph strokes crossing a line stay unmarked: their
 * cross-axis ink extent exceeds the line thickness, so they are not "thin".
 */
export const dashLineMask = (ink, {
  maxThick = 4, minChain = 5, minSpan = 64, maxSeg = 48, maxGap = 24,
  maxBridge = 320, minSolid = 90, minInk = 60
} = {}) => {
  const minDashLen = maxThick + 2;
  const { data, width, height } = ink;
  const mask = new Uint8Array(data.length);

  // Per-pixel ink run extents along each axis (down/right pass counts the
  // run so far; up/left pass extends it to the full run length).
  const vExt = new Uint16Array(data.length);
  const hExt = new Uint16Array(data.length);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let run = 0;
    for (let x = 0; x < width; x++) {
      run = data[row + x] ? run + 1 : 0;
      hExt[row + x] = run;
    }
    run = 0;
    for (let x = width - 1; x >= 0; x--) {
      run = data[row + x] ? run + 1 : 0;
      if (run) hExt[row + x] += run - 1;
    }
  }
  for (let x = 0; x < width; x++) {
    let run = 0;
    for (let y = 0; y < height; y++) {
      const i = y * width + x;
      run = data[i] ? run + 1 : 0;
      vExt[i] = run;
    }
    run = 0;
    for (let y = height - 1; y >= 0; y--) {
      const i = y * width + x;
      run = data[i] ? run + 1 : 0;
      if (run) vExt[i] += run - 1;
    }
  }

  // A ruling dash is an entire free-standing component that is thin along
  // the line's cross axis. Glyph fragments (the apex of an "o", a digit cap)
  // are locally thin too, but belong to the glyph's big component — only
  // whole-component dashes may vote a ruling line into existence.
  const compIds = new Int32Array(data.length).fill(-1);
  const compThinH = []; // bbox height <= maxThick
  const compThinV = []; // bbox width  <= maxThick
  {
    const queue = new Int32Array(data.length);
    for (let start = 0; start < data.length; start++) {
      if (!data[start] || compIds[start] !== -1) continue;
      const id = compThinH.length;
      let head = 0;
      let tail = 0;
      queue[tail++] = start;
      compIds[start] = id;
      let minX = width;
      let minY = height;
      let maxX = 0;
      let maxY = 0;
      while (head < tail) {
        const idx = queue[head++];
        const x = idx % width;
        const y = (idx / width) | 0;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (x + 1 < width && data[idx + 1] && compIds[idx + 1] === -1) { compIds[idx + 1] = id; queue[tail++] = idx + 1; }
        if (x > 0 && data[idx - 1] && compIds[idx - 1] === -1) { compIds[idx - 1] = id; queue[tail++] = idx - 1; }
        if (y + 1 < height && data[idx + width] && compIds[idx + width] === -1) { compIds[idx + width] = id; queue[tail++] = idx + width; }
        if (y > 0 && data[idx - width] && compIds[idx - width] === -1) { compIds[idx - width] = id; queue[tail++] = idx - width; }
      }
      compThinH.push(maxY - minY + 1 <= maxThick);
      compThinV.push(maxX - minX + 1 <= maxThick);
    }
  }

  // Erase the line's own ink only: at each step, find thin ink within ±2 of
  // the confirmed row/column and clear its contiguous thin cross-run. Text
  // sitting a few px off the line keeps every pixel; anything whose
  // cross-axis run exceeds the line thickness is a glyph stroke and stays.
  // A thin run with tall ink close by on BOTH sides along the line is a
  // hyphen between digits (the line crosses the label at hyphen height) —
  // spare it, or "11'-8\"" loses its hyphen and reads "118\"".
  const HYPHEN_REACH = 9;
  const erase = (horizontal, pos, from, to) => {
    const limit = horizontal ? height : width;
    const along = horizontal ? width : height;
    const at = (s, p) => (horizontal ? p * width + s : s * width + p);
    const thinAt = (idx) => data[idx] &&
      (horizontal ? vExt[idx] : hExt[idx]) <= maxThick;
    const tallNear = (s, p, dir) => {
      for (let k = 1; k <= HYPHEN_REACH; k++) {
        const q = s + dir * k;
        if (q < 0 || q >= along) return false;
        for (let d = -1; d <= 1; d++) {
          const pp = p + d;
          if (pp < 0 || pp >= limit) continue;
          const idx = at(q, pp);
          if (data[idx] && (horizontal ? vExt[idx] : hExt[idx]) > maxThick) return true;
        }
      }
      return false;
    };
    for (let s = from; s <= to; s++) {
      for (let d = -2; d <= 2; d++) {
        const p = pos + d;
        if (p < 0 || p >= limit) continue;
        if (!thinAt(at(s, p))) continue;
        if (tallNear(s, p, -1) && tallNear(s, p, 1)) break;
        for (let q = p; q >= 0 && thinAt(at(s, q)); q--) mask[at(s, q)] = 1;
        for (let q = p + 1; q < limit && thinAt(at(s, q)); q++) mask[at(s, q)] = 1;
        break;
      }
    }
  };

  // A fused-but-genuine line piece runs through whitespace: beyond its thin
  // cross-run there is no ink for most of its length. Anti-aliasing halos
  // hugging glyph caps form long thin runs too, but have the glyph bodies
  // right next to them and fail this test.
  const cleanRun = (horizontal, pos, from, to) => {
    const limit = horizontal ? height : width;
    const at = (s, p) => (horizontal ? p * width + s : s * width + p);
    let attached = 0;
    let n = 0;
    for (let s = from; s <= to; s += 2) {
      n++;
      let lo = pos;
      let hi = pos;
      while (lo - 1 >= 0 && data[at(s, lo - 1)]) lo--;
      while (hi + 1 < limit && data[at(s, hi + 1)]) hi++;
      if ((lo - 2 >= 0 && data[at(s, lo - 2)]) ||
          (hi + 2 < limit && data[at(s, hi + 2)])) attached++;
    }
    return attached <= 0.25 * n;
  };

  const sweep = (horizontal) => {
    const outer = horizontal ? height : width;
    const inner = horizontal ? width : height;
    for (let o = 0; o < outer; o++) {
      // Thin dash segments along this scan line.
      const segs = [];
      let start = -1;
      for (let i = 0; i <= inner; i++) {
        const idx = horizontal ? o * width + i : i * width + o;
        const thin = i < inner && data[idx] &&
          (horizontal ? vExt[idx] : hExt[idx]) <= maxThick;
        if (thin && start < 0) start = i;
        if (!thin && start >= 0) {
          const seg = { from: start, to: i - 1 };
          const mid = (seg.from + seg.to) >> 1;
          const midIdx = horizontal ? o * width + mid : mid * width + o;
          const comp = compIds[midIdx];
          seg.iso = comp >= 0 && (horizontal ? compThinH[comp] : compThinV[comp]);
          segs.push(seg);
          start = -1;
        }
      }
      // Long solid thin run: a leader/ruling line on its own. No glyph
      // stroke is this long, so fusion with text does not disqualify it.
      for (const s of segs) {
        if (s.to - s.from + 1 >= minSolid &&
            cleanRun(horizontal, o, s.from, s.to)) erase(horizontal, o, s.from, s.to);
      }
      // Chains of short colinear whole-component dashes. Dashes fused into
      // glyphs can't vote, but they must not break the line either: a chain
      // may bridge a fused stretch when the gap still shows thin-ink
      // evidence at the line's row. The confirmed span is erased wholesale,
      // so the fused nubs inside it get cleaned too.
      const thinAt = (idx) => data[idx] &&
        (horizontal ? vExt[idx] : hExt[idx]) <= maxThick;
      const bridgeOk = (prevTo, nextFrom) => {
        const gap = nextFrom - prevTo - 1;
        if (gap <= maxGap) return true;
        if (gap > maxBridge) return false;
        let covered = 0;
        for (let i = prevTo + 1; i < nextFrom; i++) {
          for (let d = -2; d <= 2; d++) {
            const p = o + d;
            if (p < 0 || p >= (horizontal ? height : width)) continue;
            if (thinAt(horizontal ? p * width + i : i * width + p)) {
              covered++;
              break;
            }
          }
        }
        return covered >= 0.12 * gap;
      };
      let chain = null;
      const flush = () => {
        // Enough dashes, or enough total line ink (two long solid pieces
        // bridged across a label): both prove a ruling line. A label's own
        // punctuation can't get there — quote ticks are below the length
        // floor and a row has only two hyphens.
        if (chain && chain.to - chain.from >= minSpan &&
            (chain.count >= minChain || chain.ink >= minInk)) {
          erase(horizontal, o, chain.from, chain.to);
        }
        chain = null;
      };
      for (const s of segs) {
        // Members: free-standing dashes above punctuation size, or runs long
        // enough to be self-evident line pieces even when fused into other
        // ink.
        const len = s.to - s.from + 1;
        const member = s.iso
          ? len >= minDashLen && len <= maxSeg
          : len >= maxSeg && cleanRun(horizontal, o, s.from, s.to);
        if (!member) continue;
        if (chain && !bridgeOk(chain.to, s.from)) flush();
        if (chain) {
          chain.to = s.to;
          chain.count++;
          chain.ink += len;
        } else {
          chain = { from: s.from, to: s.to, count: 1, ink: len };
        }
      }
      flush();
    }
  };

  sweep(true);
  sweep(false);
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
  const t = inkOtsu(gray);
  const out = new Uint8Array(gray.data.length);
  for (let i = 0; i < gray.data.length; i++) out[i] = gray.data[i] < t ? 0 : 255;
  return { data: out, width: gray.width, height: gray.height };
};

/**
 * Whiten every cross-axis ink band except the one covering the crop's
 * centre. Generous ROI padding often drags in a clipped sliver of the
 * neighbouring text row (room name above a dimension line); partial glyphs
 * reliably derail single-line Tesseract even when the target line is clean.
 */
export const isolateCenterBand = (gray, { vertical = false } = {}) => {
  const { data, width, height } = gray;
  const t = inkOtsu(gray);
  const n = vertical ? width : height;
  const counts = new Uint32Array(n);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (data[row + x] < t) counts[vertical ? x : y]++;
    }
  }

  // Contiguous inked bands, bridging single blank lines inside a glyph row
  const inked = (i) => counts[i] >= 2;
  const bands = [];
  let start = -1;
  let blanks = 0;
  for (let i = 0; i < n; i++) {
    if (inked(i)) {
      if (start === -1) start = i;
      blanks = 0;
    } else if (start !== -1 && ++blanks > 1) {
      bands.push({ start, end: i - blanks });
      start = -1;
    }
  }
  if (start !== -1) bands.push({ start, end: n - 1 - Math.min(blanks, n - 1 - start) });
  if (bands.length <= 1) return gray;

  // Keep the band best covering the central third (the ROI bbox is the text
  // line, so its ink sits at the crop centre); everything else is spillover.
  const lo = n * 0.33;
  const hi = n * 0.67;
  let keep = bands[0];
  let bestCover = -1;
  for (const b of bands) {
    const cover = Math.min(b.end, hi) - Math.max(b.start, lo);
    if (cover > bestCover) {
      bestCover = cover;
      keep = b;
    }
  }

  const out = new Uint8Array(data.length);
  out.set(data);
  const clear = (i) => {
    if (vertical) {
      for (let y = 0; y < height; y++) out[y * width + i] = 255;
    } else {
      out.fill(255, i * width, (i + 1) * width);
    }
  };
  for (let i = 0; i < Math.max(0, keep.start - 1); i++) clear(i);
  for (let i = Math.min(n, keep.end + 2); i < n; i++) clear(i);
  return { data: out, width, height };
};

/**
 * Whiten thin flanking strokes at the along-axis extremes of a text crop.
 * Labels inside dashed ceiling/coffered boxes drag box-edge dashes into the
 * crop ("| 14'-3 x 18'-4 |"); those rails reliably derail single-line
 * Tesseract. A rail is a narrow ink band separated from the central text
 * mass by a gap far wider than any inter-word space.
 */
export const trimFlankRails = (gray, { vertical = false, marginLo = 0, marginHi = 0 } = {}) => {
  const { data, width, height } = gray;
  const t = inkOtsu(gray);
  const n = vertical ? height : width;
  const counts = new Uint32Array(n);
  const crossMin = new Int32Array(n).fill(1 << 30);
  const crossMax = new Int32Array(n).fill(-1);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (data[row + x] < t) {
        const i = vertical ? y : x;
        const c = vertical ? x : y;
        counts[i]++;
        if (c < crossMin[i]) crossMin[i] = c;
        if (c > crossMax[i]) crossMax[i] = c;
      }
    }
  }

  // Contiguous ink bands along the text axis (1px blank tolerance)
  const bands = [];
  let start = -1;
  let blanks = 0;
  const pushBand = (s, e) => {
    let lo = 1 << 30;
    let hi = -1;
    for (let i = s; i <= e; i++) {
      if (crossMax[i] < 0) continue;
      if (crossMin[i] < lo) lo = crossMin[i];
      if (crossMax[i] > hi) hi = crossMax[i];
    }
    bands.push({ start: s, end: e, crossH: hi - lo + 1 });
  };
  for (let i = 0; i < n; i++) {
    if (counts[i] > 0) {
      if (start === -1) start = i;
      blanks = 0;
    } else if (start !== -1 && ++blanks > 1) {
      pushBand(start, i - blanks);
      start = -1;
    }
  }
  if (start !== -1) pushBand(start, n - 1);
  if (bands.length < 2) return gray;

  // The widest band is a run of glyphs — its cross extent is the text
  // height. (The overall ink extent would be inflated by the rails
  // themselves, hiding them from the gap test.)
  let textH = 0;
  let bestW = 0;
  for (const b of bands) {
    const w = b.end - b.start + 1;
    if (w > bestW) {
      bestW = w;
      textH = b.crossH;
    }
  }

  // A rail is a narrow outermost band that (a) sits wholly inside the crop
  // padding (outside the detected text bbox), or (b) is separated from the
  // text by a gap wider than any inter-word space, or (c) spans well beyond
  // the text height (dashed box edges cross the whole crop).
  const railMaxW = Math.max(2, textH * 0.25);
  const isRail = (band, inner) => {
    if (band.end - band.start + 1 > railMaxW) return false;
    const gap = band.end < inner.start ? inner.start - band.end : band.start - inner.end;
    // A narrow band standing text-high RIGHT NEXT to the text is a digit
    // ("1" leading "10-8x12-0" whose bbox started a glyph late) — never trim
    // those, even inside the padding margins. Standing off from the text it
    // is a dashed box edge, glyph-height or not. Below ~12px a one-digit and
    // a dash stroke are indistinguishable — keep trimming there.
    const glyphLike = textH >= 12 &&
      band.crossH >= textH * 0.55 && band.crossH < textH * 1.2 &&
      gap < textH * 0.9;
    if (glyphLike) return false;
    if (marginLo > 0 && band.end < marginLo) return true;
    if (marginHi > 0 && band.start > n - 1 - marginHi) return true;
    return gap >= textH * 0.9 || band.crossH >= textH * 1.2;
  };

  let lo = 0;
  let hi = bands.length - 1;
  while (lo < hi && isRail(bands[lo], bands[lo + 1])) lo++;
  while (hi > lo && isRail(bands[hi], bands[hi - 1])) hi--;
  if (lo === 0 && hi === bands.length - 1) return gray;

  const out = new Uint8Array(data.length);
  out.set(data);
  const clear = (i) => {
    if (vertical) {
      out.fill(255, i * width, (i + 1) * width);
    } else {
      for (let y = 0; y < height; y++) out[y * width + i] = 255;
    }
  };
  for (let i = 0; i < bands[lo].start; i++) clear(i);
  for (let i = bands[hi].end + 1; i < n; i++) clear(i);
  return { data: out, width, height };
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
