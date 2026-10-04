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
 * The scan itself runs in `workers/ocrWorker.js`, not here: its image work is
 * well over a second a plan, and on this thread that is a second in which the
 * page cannot repaint or take a click. This module keeps what has to live on
 * the page — the queue and its memo, the asset URLs, PaddleOCR — and runs the
 * scan itself (`dimensions/scanOnPage.js`) only where the worker cannot.
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

import { createScanQueue } from './dimensions/scanQueue.js';
import { ensurePaddle, paddleIfReady, paddleRecognizeTiles } from './dimensions/ocrPaddle.js';
import {
  configureOcrHost, startOcrHost, scanInOcrHost, tellOcrHost, setOcrHostPaddleReady,
  terminateOcrHost,
} from './dimensions/ocrHost.js';
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
//
// Worked out here and handed on, because only the page has a `window` to
// resolve them against and whichever side runs the scan needs them.
let tesseractOptions;
if (typeof window !== 'undefined') {
  const hasSimd = WebAssembly.validate(Uint8Array.from([
    0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3,
    2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11
  ]));
  const abs = (url) => new URL(url, window.location.href).href;
  tesseractOptions = {
    workerPath: abs(tesseractWorkerUrl),
    corePath: abs(hasSimd ? tesseractCoreSimdUrl : tesseractCoreUrl),
    langPath: abs(`${import.meta.env.BASE_URL}tesseract`).replace(/\/$/, '')
  };
}

// PaddleOCR needs WebGL and an <img>, so it runs on the page whichever side
// runs the scan; the worker reaches it through `ocrHost`.
const paddle = {
  paddleReady: () => Boolean(paddleIfReady()),
  refineRois: async (tiles) => {
    const api = paddleIfReady();
    if (!api) return [];
    return paddleRecognizeTiles(api, tiles);
  }
};

configureOcrHost({ tesseract: tesseractOptions, refine: paddle.refineRois });

// The scan on this thread, for a browser the worker cannot serve. Fetched only
// then: it is the whole pipeline, and the worker carries its own copy.
/** @type {typeof import('./dimensions/scanOnPage.js') | null} */
let onPage = null;
let onPageLoading = null;
const loadOnPage = () => {
  if (!onPageLoading) {
    onPageLoading = import('./dimensions/scanOnPage.js').then((mod) => {
      mod.configureTesseract(tesseractOptions);
      onPage = mod;
      return mod;
    }).catch((error) => {
      // Let the next call retry rather than caching a failure forever.
      onPageLoading = null;
      throw error;
    });
  }
  return onPageLoading;
};

// Bring the engines up wherever the scan is going to run. Both halves are
// idempotent, and a failure costs speed, never a scan: the scan warms what it
// needs itself.
const prepareEngines = ({ opencv }) => {
  startOcrHost().then((usable) => {
    if (usable) {
      tellOcrHost({ type: 'prepare', opencv });
      return null;
    }
    return loadOnPage().then((mod) => {
      mod.warmOcrEngine();
      if (opencv) mod.loadOpenCv();
    });
  }).catch(() => {});
};

export {
  normalizeOcrText,
  parseSingleToken,
  parseDimensionLine,
  inferDominantFormat
} from './dimensions/parse.js';

/**
 * Tear the Tesseract pool down now. Synchronous: it runs in an unmount cleanup,
 * and stopping the worker takes its pool with it.
 */
export const terminateOcrWorker = () => {
  terminateOcrHost();
  onPage?.terminateOcrWorker();
};

/** Release the pool's WASM heaps after `ms` with no reading. */
export const releaseOcrWorkersWhenIdle = (ms) => {
  tellOcrHost({ type: 'releaseWhenIdle', ms });
  onPage?.releaseOcrWorkersWhenIdle(ms);
};

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
export const warmupOcrEngines = () => prepareEngines({ opencv: false });

/** Opt-in warm-up for the PaddleOCR rescue pass (main-thread heavy). */
export const warmupNeuralOcr = () => ensurePaddle().then((api) => {
  // The worker cannot see this module's state; it is told.
  setOcrHostPaddleReady(Boolean(api));
  return api;
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
  let result = null;
  if (await startOcrHost()) {
    try {
      result = await scanInOcrHost(imageDataUrl);
    } catch (error) {
      // The worker went, not the scan: read this plan here instead. A scan
      // that failed on its own merits would fail here too, and is rethrown.
      if (!error?.hostUnavailable) throw error;
    }
  }
  if (!result) result = await (await loadOnPage()).scanOnPage(imageDataUrl, paddle);

  const { dimensions, exteriorLabels, areaLabels, detectedFormat, timings, truncated } = result;

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
  if (!scanQueue.has(imageDataUrl)) prepareEngines({ opencv: true });
  try {
    return cloneScan(await scanQueue.run(imageDataUrl, () => scanImage(imageDataUrl)));
  } catch (error) {
    console.error('DimensionsOCR error:', error);
    throw error;
  }
};
