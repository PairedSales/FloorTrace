/**
 * Room-dimension extraction from floorplan images.
 *
 * Public API:
 *   detectAllDimensions(imageDataUrl) -> { dimensions, detectedFormat }
 *     dimensions: [{ width, height, text, bbox, confidence, format }]
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

/** Grayscale/RGBA image-data-like -> canvas (what tesseract.js consumes). */
const imageDataLikeToCanvas = (imageDataLike) => {
  const canvas = document.createElement('canvas');
  canvas.width = imageDataLike.width;
  canvas.height = imageDataLike.height;
  const ctx = canvas.getContext('2d');
  ctx.putImageData(
    new ImageData(imageDataLike.data, imageDataLike.width, imageDataLike.height),
    0, 0
  );
  return canvas;
};

const browserEnv = () => ({
  toOcrInput: imageDataLikeToCanvas,
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
 * @returns {Promise<{dimensions: Array, detectedFormat: string|null}>}
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

    const { dimensions, detectedFormat, timings } =
      await detectDimensionsCore(imageData, browserEnv());

    if (import.meta.env?.DEV) {
      console.debug('[DimensionsOCR] timings(ms):', timings, 'found:', dimensions.length);
    }

    return { dimensions, detectedFormat };
  } catch (error) {
    console.error('DimensionsOCR error:', error);
    return { dimensions: [], detectedFormat: null };
  }
};
