// `dilateRows`/`dilateCols` are the two primitives everything downstream
// depends on — `closeRect` calls them on every rung of every closing ladder —
// so the run-based rewrite is asserted bit-identical against the per-pixel
// distance sweeps it replaced, kept here verbatim as the reference.
import { describe, expect, it } from 'vitest';
import { dilateRows, dilateCols, dilateRect, erodeRect, closeRect, openRect } from '../raster.js';

// ---- the shipped implementations before the rewrite ------------------------

const dilateRowsSweep = (mask, width, height, r) => {
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

const COL_TILE = 64;

const dilateColsSweep = (mask, width, height, r) => {
  if (r <= 0) return mask.slice();
  const out = new Uint8Array(mask.length);
  const INF = height + r + 1;
  const dist = new Int32Array(COL_TILE);
  for (let x0 = 0; x0 < width; x0 += COL_TILE) {
    const n = Math.min(COL_TILE, width - x0);
    dist.fill(INF, 0, n);
    for (let y = 0; y < height; y += 1) {
      const row = y * width + x0;
      for (let i = 0; i < n; i += 1) {
        const d = mask[row + i] ? 0 : dist[i] + 1;
        dist[i] = d;
        if (d <= r) out[row + i] = 1;
      }
    }
    dist.fill(INF, 0, n);
    for (let y = height - 1; y >= 0; y -= 1) {
      const row = y * width + x0;
      for (let i = 0; i < n; i += 1) {
        const d = mask[row + i] ? 0 : dist[i] + 1;
        dist[i] = d;
        if (d <= r) out[row + i] = 1;
      }
    }
  }
  return out;
};

// ---- mask generators -------------------------------------------------------

const rng = (seed) => {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 0x100000000;
  };
};

const randomMask = (width, height, density, seed) => {
  const next = rng(seed);
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i += 1) mask[i] = next() < density ? 1 : 0;
  return mask;
};

// The degenerate case the run form could in principle lose on: every run is
// one pixel long, so the column paint writes with a `width` stride throughout.
const checkerboard = (width, height) => {
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) mask[y * width + x] = (x + y) & 1;
  }
  return mask;
};

// Wall-like linework: long axis-aligned strokes, which is what the tracer
// actually feeds these (4-49% ink on the fixtures).
const linework = (width, height, seed) => {
  const next = rng(seed);
  const mask = new Uint8Array(width * height);
  for (let n = 0; n < 40; n += 1) {
    const horizontal = next() < 0.5;
    const thick = 1 + Math.floor(next() * 5);
    const len = Math.floor(next() * (horizontal ? width : height));
    const at = Math.floor(next() * (horizontal ? height - thick : width - thick));
    const from = Math.floor(next() * ((horizontal ? width : height) - len || 1));
    for (let t = 0; t < thick; t += 1) {
      for (let k = from; k < from + len; k += 1) {
        if (horizontal) mask[(at + t) * width + k] = 1;
        else mask[k * width + at + t] = 1;
      }
    }
  }
  return mask;
};

// Ink hard against all four borders — dilation has no border semantics here,
// but a run form that clamped wrongly would show up first at the edges.
const borderHugging = (width, height) => {
  const mask = new Uint8Array(width * height);
  for (let x = 0; x < width; x += 1) {
    mask[x] = 1;
    mask[(height - 1) * width + x] = 1;
  }
  for (let y = 0; y < height; y += 1) {
    mask[y * width] = 1;
    mask[y * width + width - 1] = 1;
  }
  return mask;
};

const RADII = [1, 2, 3, 7, 17, 39, 58, 64, 65, 129];

const CASES = [
  ['empty 80x60', () => new Uint8Array(80 * 60), 80, 60],
  ['full 80x60', () => new Uint8Array(80 * 60).fill(1), 80, 60],
  ['checkerboard 130x70', () => checkerboard(130, 70), 130, 70],
  ['border-hugging 90x90', () => borderHugging(90, 90), 90, 90],
  ['sparse 4% 137x101', () => randomMask(137, 101, 0.04, 11), 137, 101],
  ['medium 20% 137x101', () => randomMask(137, 101, 0.2, 12), 137, 101],
  ['dense 49% 137x101', () => randomMask(137, 101, 0.49, 13), 137, 101],
  ['linework 200x150', () => linework(200, 150, 14), 200, 150],
  // Not a multiple of COL_TILE, and narrower than one tile.
  ['narrow 7x200', () => randomMask(7, 200, 0.15, 15), 7, 200],
  ['single row 300x1', () => randomMask(300, 1, 0.2, 16), 300, 1],
  ['single col 1x300', () => randomMask(1, 300, 0.2, 17), 1, 300],
  ['1x1 ink', () => new Uint8Array([1]), 1, 1],
];

describe('dilateRows matches the distance-sweep form', () => {
  for (const [name, make, width, height] of CASES) {
    it.each(RADII)(`${name} at r=%i`, (r) => {
      const mask = make();
      expect(dilateRows(mask, width, height, r))
        .toEqual(dilateRowsSweep(mask, width, height, r));
    });
  }
});

describe('dilateCols matches the distance-sweep form', () => {
  for (const [name, make, width, height] of CASES) {
    it.each(RADII)(`${name} at r=%i`, (r) => {
      const mask = make();
      expect(dilateCols(mask, width, height, r))
        .toEqual(dilateColsSweep(mask, width, height, r));
    });
  }
});

describe('the operators built on them are unchanged', () => {
  const composed = [
    ['dilateRect', dilateRect],
    ['erodeRect', erodeRect],
    ['closeRect', closeRect],
    ['openRect', openRect],
  ];
  // Reference versions of the composites, built from the sweep primitives.
  const erodeRowsRef = (mask, width, height, r) => {
    if (r <= 0) return mask.slice();
    const out = new Uint8Array(mask.length);
    for (let y = 0; y < height; y += 1) {
      const row = y * width;
      let x = 0;
      while (x < width) {
        if (!mask[row + x]) { x += 1; continue; }
        let end = x;
        while (end < width && mask[row + end]) end += 1;
        for (let k = x + r; k <= end - 1 - r; k += 1) out[row + k] = 1;
        x = end;
      }
    }
    return out;
  };
  const erodeColsRef = (mask, width, height, r) => {
    if (r <= 0) return mask.slice();
    const out = new Uint8Array(mask.length);
    for (let x = 0; x < width; x += 1) {
      let y = 0;
      while (y < height) {
        if (!mask[y * width + x]) { y += 1; continue; }
        let end = y;
        while (end < height && mask[end * width + x]) end += 1;
        for (let k = y + r; k <= end - 1 - r; k += 1) out[k * width + x] = 1;
        y = end;
      }
    }
    return out;
  };
  const dilateRectRef = (m, w, h, r) => dilateColsSweep(dilateRowsSweep(m, w, h, r), w, h, r);
  const erodeRectRef = (m, w, h, r) => erodeColsRef(erodeRowsRef(m, w, h, r), w, h, r);
  const closeRectRef = (mask, width, height, r) => {
    if (r <= 0) return mask.slice();
    const pw = width + 2 * r;
    const ph = height + 2 * r;
    const padded = new Uint8Array(pw * ph);
    for (let y = 0; y < height; y += 1) {
      padded.set(mask.subarray(y * width, y * width + width), (y + r) * pw + r);
    }
    const closed = erodeRectRef(dilateRectRef(padded, pw, ph, r), pw, ph, r);
    const out = new Uint8Array(width * height);
    for (let y = 0; y < height; y += 1) {
      out.set(closed.subarray((y + r) * pw + r, (y + r) * pw + r + width), y * width);
    }
    return out;
  };
  const refs = {
    dilateRect: dilateRectRef,
    erodeRect: erodeRectRef,
    closeRect: closeRectRef,
    openRect: (m, w, h, r) => dilateRectRef(erodeRectRef(m, w, h, r), w, h, r),
  };

  for (const [name, fn] of composed) {
    it.each([2, 7, 17, 39])(`${name} at r=%i over linework and a checkerboard`, (r) => {
      for (const [, make, width, height] of CASES) {
        const mask = make();
        expect(fn(mask, width, height, r)).toEqual(refs[name](mask, width, height, r));
      }
    });
  }
});
