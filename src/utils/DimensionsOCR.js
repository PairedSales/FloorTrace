/**
 * Room-dimension extraction from floorplan images.
 *
 * Public API:
 *   detectAllDimensions(imageDataUrl) -> { dimensions, exteriorLabels, areaLabels,
 *                                          detectedFormat }
 *     dimensions: [{ width, height, text, bbox, confidence, format }]
 *     exteriorLabels: [{ keyword, text, bbox }] — garage/porch/patio/deck/
 *       balcony name labels, fed to the boundary tracer as footprint exclusions
 *     areaLabels: [{ type, keyword, text, bbox }] — level names ("BASEMENT",
 *       "2ND FLOOR"), which type a whole outline rather than carving anything
 *   terminateOcrWorker() / releaseOcrWorkersWhenIdle(ms)
 *
 * Repeat scans of the same image are served from a small LRU — "Find room
 * size" and re-entering manual mode both re-scan what is already known. Scans
 * also run one at a time: the pipeline's budget is wall clock, so two at once
 * return fewer dimensions each rather than simply taking longer. See
 * dimensions/scanQueue.js.
 *
 * Parsing primitives (normalizeOcrText, parseSingleToken, parseDimensionLine,
 * inferDominantFormat) are re-exported for the unit-test suite.
 *
 * Architecture: hybrid multi-pass OCR — Tesseract sparse full-page baseline,
 * OpenCV/JS preprocessing (CLAHE, selective denoise, sharpening), glyph-
 * cluster spatial analysis for ROI discovery (incl. vertical labels), zoomed
 * single-line Tesseract refinement, and an optional PaddleOCR neural rescue
 * pass. See ./dimensions/pipeline.js for the phase breakdown.
 */

import { dataUrlToImage } from './imageLoader.js';
import { detectDimensionsCore } from './dimensions/pipeline.js';
import { createScanQueue } from './dimensions/scanQueue.js';
import { ensurePaddle, paddleIfReady, paddleRecognizeTiles } from './dimensions/ocrPaddle.js';
import { loadOpenCv } from './dimensions/opencvBridge.js';
import { configureTesseract, warmOcrEngine } from './dimensions/ocrTesseract.js';
import tesseractWorkerUrl from 'tesseract.js/dist/worker.min.js?url';
import tesseractCoreSimdUrl from 'tesseract.js-core/tesseract-core-simd-lstm.wasm.js?url';
import tesseractCoreUrl from 'tesseract.js-core/tesseract-core-lstm.wasm.js?url';

// Self-host every tesseract.js runtime asset (worker script, core WASM,
// eng traineddata) so first-scan latency doesn't depend on jsdelivr and OCR
// works offline. Worker + core come out of node_modules via Vite asset URLs
// (so they track the installed tesseract.js version); the traineddata lives
// in public/tesseract/. URLs must be absolute because the worker script runs
// from a blob: URL, which relative importScripts/fetch can't resolve against.
// The worker normally picks the SIMD core itself, but only when handed a
// directory — a single file forces the choice, so probe SIMD support here
// (same probe wasm-feature-detect uses).
if (typeof window !== 'undefined') {
  const hasSimd = WebAssembly.validate(Uint8Array.from([
    0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3,
    2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11
  ]));
  const abs = (url) => new URL(url, window.location.href).href;
  configureTesseract({
    workerPath: abs(tesseractWorkerUrl),
    corePath: abs(hasSimd ? tesseractCoreSimdUrl : tesseractCoreUrl),
    langPath: abs(`${import.meta.env.BASE_URL}tesseract`).replace(/\/$/, '')
  });
}

export {
  normalizeOcrText,
  parseSingleToken,
  parseDimensionLine,
  inferDominantFormat
} from './dimensions/parse.js';
export {
  terminateOcrWorker,
  releaseOcrWorkersWhenIdle
} from './dimensions/ocrTesseract.js';

/**
 * Pre-warm one Tesseract worker. Call at app startup so the first real
 * detection doesn't pay multi-second engine bootstrap inside its time
 * budget. Safe to call repeatedly; never throws. Only one worker: the rest
 * of the pool boots during the scan itself, so a visitor who never scans
 * doesn't hold four WASM heaps.
 *
 * OpenCV is deliberately NOT warmed here: its ~15.5 MB (3.9 MB gzip) chunk
 * would be downloaded by every visitor at mount for two optional filters
 * that have pure-JS fallbacks. detectAllDimensions kicks off loadOpenCv()
 * itself, so only users who actually scan pay for it.
 *
 * PaddleOCR is deliberately never auto-initialised: its WebGL shader
 * compilation blocks the main thread for ~10s, which is unacceptable both
 * during a detection and right after one (the app must be fully responsive
 * once scanning finishes). The neural rescue pass therefore only activates
 * if warmupNeuralOcr() is explicitly called (e.g. behind a future setting).
 */
export const warmupOcrEngines = () => {
  try {
    warmOcrEngine();
  } catch {
    // warm-up is best-effort
  }
};

/** Opt-in warm-up for the PaddleOCR rescue pass (main-thread heavy). */
export const warmupNeuralOcr = () => ensurePaddle();

// Grayscale image-data-like -> PNG Blob. tesseract.js accepts canvases but
// serialises them internally with canvas.toBlob(), which costs up to ~1s per
// call on some machines — a per-read tax that starves the whole ROI phase.
// Hand-rolled PNG with stored (uncompressed) deflate blocks is a plain byte
// copy; a targeted read drops to ~20ms.
//
// Slice-by-8: the byte-at-a-time table loop is the only per-byte work left on
// a ~3.9 MB IDAT. Same polynomial, same output — `crc32Slow` in the tests is
// the byte-at-a-time form this is asserted equal to.
let crcTables = null;
const buildCrcTables = () => {
  const tables = [];
  for (let k = 0; k < 8; k += 1) tables.push(new Uint32Array(256));
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tables[0][n] = c >>> 0;
  }
  for (let k = 1; k < 8; k += 1) {
    for (let n = 0; n < 256; n += 1) {
      const prev = tables[k - 1][n];
      tables[k][n] = (tables[0][prev & 0xff] ^ (prev >>> 8)) >>> 0;
    }
  }
  return tables;
};

export const crc32 = (bytes, start, end) => {
  if (!crcTables) crcTables = buildCrcTables();
  const [t0, t1, t2, t3, t4, t5, t6, t7] = crcTables;
  let crc = 0xffffffff;
  let i = start;
  for (; i + 8 <= end; i += 8) {
    crc ^= bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16) | (bytes[i + 3] << 24);
    crc = (t7[crc & 0xff] ^ t6[(crc >>> 8) & 0xff] ^ t5[(crc >>> 16) & 0xff] ^ t4[crc >>> 24]
      ^ t3[bytes[i + 4]] ^ t2[bytes[i + 5]] ^ t1[bytes[i + 6]] ^ t0[bytes[i + 7]]) >>> 0;
  }
  for (; i < end; i += 1) crc = t0[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

// Standard zlib chunked form: 5552 is the largest run of byte adds that cannot
// overflow the 32-bit accumulator, so the two modulos move off the per-byte
// path entirely.
export const adler32 = (bytes) => {
  const NMAX = 5552;
  let a = 1;
  let b = 0;
  let i = 0;
  while (i < bytes.length) {
    const end = Math.min(i + NMAX, bytes.length);
    for (; i < end; i += 1) {
      a += bytes[i];
      b += a;
    }
    a %= 65521;
    b %= 65521;
  }
  return { a, b };
};

const pngChunk = (type, body) => {
  const c = new Uint8Array(12 + body.length);
  const dv = new DataView(c.buffer);
  dv.setUint32(0, body.length);
  for (let i = 0; i < 4; i += 1) c[4 + i] = type.charCodeAt(i);
  c.set(body, 8);
  dv.setUint32(8 + body.length, crc32(c, 4, 8 + body.length));
  return c;
};

// Takes the pipeline's gray `{data, width, height}` directly. It used to take
// an RGBA ImageData-like, which meant every input was first expanded into a
// w*h*4 buffer (15.5 MB for the pass-1 page) that this function then read one
// byte in four from and dropped.
export const grayToPngBlob = (gray) => {
  const { width, height, data } = gray;
  // Scanlines: filter byte 0 + one gray byte per pixel.
  const raw = new Uint8Array((width + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw.set(data.subarray(y * width, y * width + width), y * (width + 1) + 1);
  }

  // zlib stream: header + stored deflate blocks + adler32
  const maxBlock = 65535;
  const nBlocks = Math.max(1, Math.ceil(raw.length / maxBlock));
  const idat = new Uint8Array(2 + raw.length + nBlocks * 5 + 4);
  let p = 0;
  idat[p++] = 0x78;
  idat[p++] = 0x01;
  for (let off = 0; off < raw.length; off += maxBlock) {
    const len = Math.min(maxBlock, raw.length - off);
    idat[p++] = off + len >= raw.length ? 1 : 0;
    idat[p++] = len & 0xff;
    idat[p++] = len >>> 8;
    idat[p++] = ~len & 0xff;
    idat[p++] = (~len >>> 8) & 0xff;
    idat.set(raw.subarray(off, off + len), p);
    p += len;
  }
  const { a, b } = adler32(raw);
  idat[p++] = (b >>> 8) & 0xff;
  idat[p++] = b & 0xff;
  idat[p++] = (a >>> 8) & 0xff;
  idat[p++] = a & 0xff;

  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // grayscale
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  return new Blob(
    [sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', new Uint8Array(0))],
    { type: 'image/png' }
  );
};

const browserEnv = () => ({
  toOcrInput: grayToPngBlob,
  paddleReady: () => Boolean(paddleIfReady()),
  refineRois: async (tiles) => {
    const api = paddleIfReady();
    if (!api) return [];
    return paddleRecognizeTiles(api, tiles);
  }
});

// Recent scans, keyed by the image itself. "Find room size" and re-entering
// manual mode both re-scan the same image; a full scan is seconds of OCR.
// Identity is the data URL, not a hash — the caller passes the same string
// reference back, so === is O(1) here and cannot alias two distinct images.
//
// The memoising, de-duplicating and serialising all live in `scanQueue`, which
// is pure and testable; see that file for why scans must not run concurrently.
// Four entries is sized to the analysis cache in the detection worker, which
// holds the same number for the same reason.
const scanQueue = createScanQueue({ maxEntries: 4 });

const cloneScan = (result) => ({
  dimensions: result.dimensions.map((d) => ({ ...d, bbox: { ...d.bbox } })),
  exteriorLabels: result.exteriorLabels.map((l) => ({ ...l, bbox: { ...l.bbox } })),
  areaLabels: result.areaLabels.map((l) => ({ ...l, bbox: { ...l.bbox } })),
  detectedFormat: result.detectedFormat,
  // How many candidate regions the budget cut off. Zero on a scan that ran to
  // completion; non-zero means this reading of the plan is short of what the
  // page actually holds, which is otherwise invisible.
  truncated: result.truncated ?? 0
});

/**
 * Detect all room dimensions in a floorplan image.
 *
 * Rejects if the scan fails. An empty result must only ever mean "this plan
 * has no labels" — the scale now depends on the label count, so a swallowed
 * worker crash would read as a clean scan of an unlabelled plan.
 *
 * @param {string} imageDataUrl base64 data URL (PNG/JPG)
 * @returns {Promise<{dimensions: Array, exteriorLabels: Array, areaLabels: Array,
 *                    detectedFormat: string|null}>}
 */
const scanImage = async (imageDataUrl) => {
  const img = await dataUrlToImage(imageDataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

  const { dimensions, exteriorLabels, areaLabels, detectedFormat, timings, truncated } =
    await detectDimensionsCore(imageData, browserEnv());

  if (import.meta.env?.DEV) {
    console.debug('[DimensionsOCR] timings(ms):', timings, 'found:', dimensions.length,
      'truncated:', truncated ?? 0,
      'exterior:', exteriorLabels.map((l) => l.keyword),
      'area:', areaLabels.map((l) => `${l.type}:${l.keyword}`));
  }

  return { dimensions, exteriorLabels, areaLabels, detectedFormat, truncated: truncated ?? 0 };
};

export const detectAllDimensions = async (imageDataUrl) => {
  // Warmed outside the queue, not inside it: engine download and init are the
  // part that most wants to overlap with waiting, and both are idempotent.
  if (!scanQueue.has(imageDataUrl)) {
    warmOcrEngine();
    loadOpenCv();
  }
  try {
    return cloneScan(await scanQueue.run(imageDataUrl, () => scanImage(imageDataUrl)));
  } catch (error) {
    console.error('DimensionsOCR error:', error);
    throw error;
  }
};
