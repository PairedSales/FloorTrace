/**
 * Room-dimension extraction from floorplan images.
 *
 * Public API:
 *   detectAllDimensions(imageDataUrl) -> { dimensions, exteriorLabels, detectedFormat }
 *     dimensions: [{ width, height, text, bbox, confidence, format }]
 *     exteriorLabels: [{ keyword, text, bbox }] — garage/porch/patio/deck/
 *       balcony name labels, fed to the boundary tracer as footprint exclusions
 *   terminateOcrWorker()
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
import { ensurePaddle, paddleIfReady, paddleRecognizeTiles } from './dimensions/ocrPaddle.js';
import { loadOpenCv } from './dimensions/opencvBridge.js';
import { getWorker } from './dimensions/ocrTesseract.js';

export {
  normalizeOcrText,
  parseSingleToken,
  parseDimensionLine,
  inferDominantFormat
} from './dimensions/parse.js';
export { terminateOcrWorker } from './dimensions/ocrTesseract.js';

/**
 * Pre-warm the OCR engines (Tesseract worker, OpenCV WASM). Call at app
 * startup so the first real detection doesn't pay multi-second engine
 * bootstrap inside its time budget. Safe to call repeatedly; never throws.
 *
 * PaddleOCR is deliberately never auto-initialised: its WebGL shader
 * compilation blocks the main thread for ~10s, which is unacceptable both
 * during a detection and right after one (the app must be fully responsive
 * once scanning finishes). The neural rescue pass therefore only activates
 * if warmupNeuralOcr() is explicitly called (e.g. behind a future setting).
 */
export const warmupOcrEngines = () => {
  try {
    getWorker();
    loadOpenCv();
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
let crcTable = null;
const crc32 = (bytes, start, end) => {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = start; i < end; i += 1) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
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

const imageDataLikeToPngBlob = (imageDataLike) => {
  const { width, height, data } = imageDataLike;
  // Scanlines: filter byte 0 + one gray byte per pixel (all pipeline inputs
  // are grayscale rendered into RGBA, so the red channel is the value).
  const raw = new Uint8Array((width + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const src = y * width * 4;
    const dst = y * (width + 1);
    for (let x = 0; x < width; x += 1) raw[dst + 1 + x] = data[src + x * 4];
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
  let a = 1;
  let b = 0;
  for (let i = 0; i < raw.length; i += 1) {
    a = (a + raw[i]) % 65521;
    b = (b + a) % 65521;
  }
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
  toOcrInput: imageDataLikeToPngBlob,
  paddleReady: () => Boolean(paddleIfReady()),
  refineRois: async (tiles) => {
    const api = paddleIfReady();
    if (!api) return [];
    return paddleRecognizeTiles(api, tiles);
  }
});

/**
 * Detect all room dimensions in a floorplan image.
 * @param {string} imageDataUrl base64 data URL (PNG/JPG)
 * @returns {Promise<{dimensions: Array, exteriorLabels: Array, detectedFormat: string|null}>}
 */
export const detectAllDimensions = async (imageDataUrl) => {
  try {
    // Warm engines in the background / in parallel with image decode.
    // Tesseract's worker is the one this run will actually wait on.
    getWorker();
    loadOpenCv();

    const img = await dataUrlToImage(imageDataUrl);
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    const { dimensions, exteriorLabels, detectedFormat, timings } =
      await detectDimensionsCore(imageData, browserEnv());

    if (import.meta.env?.DEV) {
      console.debug('[DimensionsOCR] timings(ms):', timings, 'found:', dimensions.length,
        'exterior:', exteriorLabels.map((l) => l.keyword));
    }

    return { dimensions, exteriorLabels, detectedFormat };
  } catch (error) {
    console.error('DimensionsOCR error:', error);
    return { dimensions: [], exteriorLabels: [], detectedFormat: null };
  }
};
