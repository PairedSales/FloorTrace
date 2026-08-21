/**
 * Memoise, de-duplicate and serialise expensive scans.
 *
 * Pure policy, deliberately separate from `DimensionsOCR.js`, which cannot be
 * loaded outside a browser — this is the part with rules worth testing, and
 * mocking Tesseract, OpenCV and a canvas to reach it would test the mocks.
 *
 * Three behaviours, each earning its place:
 *
 * **Memoised**, up to `maxEntries`, keyed by identity. A full scan is seconds
 * of OCR, and re-entering manual mode or pressing "Find room size" re-asks for
 * the same image. An LRU rather than one slot because one slot is right only
 * while one image is in play: alternate between two and every scan is cold.
 *
 * **De-duplicated.** Two callers asking for the same image at the same time
 * wait on one scan. The second would otherwise compete with the first for a
 * budget they both spend.
 *
 * **Serialised.** Scans run one at a time, and this is the load-bearing one.
 * The pipeline's budget is wall clock, and when it runs out candidate regions
 * are silently skipped — so two scans running together do not each take twice
 * as long, they each return *fewer dimensions*, with nothing in either result
 * saying so. Fewer dimensions is a worse scale, and the scale multiplies every
 * reported area. Making the second wait is visible; degrading both is not.
 */

const MISS = Symbol('miss');

export function createScanQueue({ maxEntries = 4 } = {}) {
  /** @type {Map<any, any>} key → result. Insertion order is recency. */
  const done = new Map();
  /** @type {Map<any, Promise<any>>} key → the scan already running for it. */
  const inFlight = new Map();

  // Every scan is chained after the one before it. The chain must survive a
  // rejection, or one failed scan wedges every later scan for the life of the
  // page — hence a handler on both arms.
  let chain = Promise.resolve();

  const remember = (key, value) => {
    done.set(key, value);
    while (done.size > maxEntries) done.delete(done.keys().next().value);
  };

  const recall = (key) => {
    if (!done.has(key)) return MISS;
    const value = done.get(key);
    done.delete(key);
    done.set(key, value);
    return value;
  };

  return {
    /**
     * Return the memoised result for `key`, or run `task` to produce one.
     * Failures are never memoised: an empty result would then be served
     * forever as "this plan has no labels".
     */
    async run(key, task) {
      const hit = recall(key);
      if (hit !== MISS) return hit;

      const already = inFlight.get(key);
      if (already) return already;

      const started = chain.then(task, task);
      chain = started.then(() => {}, () => {});
      inFlight.set(key, started);
      try {
        const value = await started;
        remember(key, value);
        return value;
      } finally {
        inFlight.delete(key);
      }
    },

    /** Whether a result is memoised, without disturbing recency. */
    has: (key) => done.has(key),

    /** Forget every memoised result. In-flight work is unaffected. */
    clear: () => done.clear(),

    get size() {
      return done.size;
    },
  };
}
