/**
 * The OCR pipeline, loaded on demand.
 *
 * `DimensionsOCR.js` pulls in the whole dimension-reading graph — the pipeline,
 * the raster helpers, the parser, the region finder, the Tesseract and Paddle
 * bridges — about 45 kB minified / 17.7 kB gzipped. None of it runs until a
 * scan, and a scan needs a floorplan, but every consumer imported it statically
 * so all of it sat in the entry chunk and was parsed on every page load,
 * including for visitors who never open an image.
 *
 * The heavy engines were already deferred (`import('tesseract.js')` inside
 * `ocrTesseract`, the Paddle model behind its own toggle). What was not
 * deferred was the pure JS around them, and the `?url` imports at the top of
 * `DimensionsOCR` — one of which dragged a separate 6.9 kB tesseract chunk onto
 * the critical path and had it modulepreloaded, all to hold a 60-character URL
 * string.
 *
 * Everything here is already async at its call site, with one exception that
 * shapes the design: `terminateOcrWorker` runs in a React unmount cleanup,
 * which cannot await. It uses the cached module handle instead — if the OCR
 * graph was never loaded there is no worker to terminate, so doing nothing is
 * not a compromise, it is the right answer.
 */

/** @type {Promise<typeof import('./DimensionsOCR')> | null} */
let loading = null;
/** @type {typeof import('./DimensionsOCR') | null} */
let loaded = null;

const load = () => {
  if (loaded) return Promise.resolve(loaded);
  if (!loading) {
    loading = import('./DimensionsOCR').then((mod) => {
      loaded = mod;
      return mod;
    }).catch((error) => {
      // Let the next call retry rather than caching a failure forever.
      loading = null;
      throw error;
    });
  }
  return loading;
};

/** Read every dimension label on a plan. The one call that must resolve. */
export const detectAllDimensions = async (imageDataUrl) =>
  (await load()).detectAllDimensions(imageDataUrl);

/**
 * Pull the engines down ahead of the first scan. Fire-and-forget by design —
 * `detectAllDimensions` warms them itself, so a failure here costs speed, never
 * correctness.
 */
export const warmupOcrEngines = () => {
  load().then((mod) => mod.warmupOcrEngines()).catch(() => {});
};

/** The same, for the opt-in neural rescue pass. */
export const warmupNeuralOcr = () => {
  load().then((mod) => mod.warmupNeuralOcr()).catch(() => {});
};

/** Release the worker pool once the user has clearly moved on. */
export const releaseOcrWorkersWhenIdle = (ms) => {
  load().then((mod) => mod.releaseOcrWorkersWhenIdle(ms)).catch(() => {});
};

/**
 * Tear the pool down now. Synchronous, and deliberately a no-op when the OCR
 * graph has never been loaded: an unmount cleanup cannot await, and a module
 * that was never imported cannot be holding a worker.
 */
export const terminateOcrWorker = () => {
  loaded?.terminateOcrWorker();
};
