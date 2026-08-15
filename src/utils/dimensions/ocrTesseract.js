/**
 * Tesseract.js engine wrapper — lazy module load, a small worker pool, and the
 * parameter presets the pipeline uses (sparse full-page pass and targeted
 * single-line ROI pass).
 *
 * The pool exists because a scan is ~90% Tesseract inference spread over 80-100
 * independent ROI reads; one worker serialized every one of them. Reads are
 * bit-identical at any pool size — same tiles, same params, same engine — so
 * the only thing concurrency changes is which order results come back in.
 */

let tesseractModulePromise = null;
let createWorkerOptions;

// { worker, ready, preset, busy, gen }. `busy` is true from the moment a slot
// is created until its worker has booted, so an unbooted slot is never handed out.
let entries = [];
let waiters = [];
// Bumped by terminate(): boots and releases that land afterwards belong to a
// dead generation and tear themselves down instead of resurrecting the pool.
let generation = 0;
let idleTimer = null;
let idleDelay = 0;
// Long enough that a re-scan or a second image reuses a warm pool, short
// enough that a visitor who wandered off gets the memory back.
const DEFAULT_IDLE_MS = 60000;

const MAX_POOL = 4; // each worker holds the 5.2 MB traineddata plus a WASM heap

const poolSize = (() => {
  const cores = globalThis.navigator?.hardwareConcurrency || 4;
  return Math.max(1, Math.min(MAX_POOL, Math.floor(cores / 2)));
})();

/** How many ROI reads the caller may keep in flight. */
export const ocrConcurrency = () => poolSize;

const loadTesseract = async () => {
  if (!tesseractModulePromise) {
    tesseractModulePromise = import('tesseract.js').then((m) => m.default ?? m);
  }
  return tesseractModulePromise;
};

/**
 * Inject createWorker options (workerPath/corePath/langPath) before the first
 * worker boots. The browser entry uses this to point tesseract.js at
 * self-hosted assets instead of its jsdelivr defaults; Node harnesses skip it.
 */
export const configureTesseract = (options) => {
  createWorkerOptions = options;
};

const cancelIdleRelease = () => {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
};

const scheduleIdleRelease = () => {
  if (!idleDelay || idleTimer || !entries.length) return;
  if (entries.some((e) => e.busy)) return;
  idleTimer = setTimeout(() => {
    idleTimer = null;
    terminateOcrWorker();
  }, idleDelay);
  idleTimer.unref?.(); // Node: an armed release must not hold the process open
};

const failWaiters = (error) => {
  const pending = waiters;
  waiters = [];
  for (const w of pending) w.reject(error);
};

/** Hand the slot to a waiter (preferring one that wants its current preset) or park it. */
const release = (entry) => {
  if (entry.gen !== generation) {
    entry.worker?.terminate().catch(() => {});
    return;
  }
  let i = waiters.findIndex((w) => w.preset === entry.preset);
  if (i < 0 && waiters.length) i = 0;
  if (i >= 0) {
    waiters.splice(i, 1)[0].resolve(entry);
    return;
  }
  entry.busy = false;
  scheduleIdleRelease();
};

const bootEntry = () => {
  const entry = { worker: null, ready: null, preset: null, busy: true, gen: generation };
  entries.push(entry);
  entry.ready = (async () => {
    const Tesseract = await loadTesseract();
    return Tesseract.createWorker('eng', 1, createWorkerOptions);
  })();
  entry.ready.then(
    (worker) => {
      if (entry.gen !== generation) {
        worker.terminate().catch(() => {});
        return;
      }
      entry.worker = worker;
      release(entry);
    },
    (error) => {
      const i = entries.indexOf(entry);
      if (i >= 0) entries.splice(i, 1);
      // Nothing left that could ever service them — don't let callers hang.
      if (!entries.length) failWaiters(error);
    }
  );
  return entry;
};

/**
 * Bring the pool up to full size. Call it as early as the caller knows a ROI
 * phase is coming: the extra boots then overlap the full-page pass instead of
 * eating the first second of the phase they exist to speed up.
 */
export const prewarmOcrPool = () => {
  cancelIdleRelease();
  while (entries.length < poolSize) bootEntry();
};

const acquire = (preset) => {
  cancelIdleRelease();
  if (!entries.length) bootEntry();
  const free = entries.find((e) => !e.busy && e.preset === preset) ||
    entries.find((e) => !e.busy);
  if (free) {
    free.busy = true;
    return Promise.resolve(free);
  }
  return new Promise((resolve, reject) => waiters.push({ preset, resolve, reject }));
};

const applyPreset = async (entry, preset) => {
  if (entry.preset === preset) return;
  const Tesseract = await loadTesseract();
  if (preset === 'sparse') {
    await entry.worker.setParameters({
      tessedit_pageseg_mode: Tesseract.PSM.SPARSE_TEXT,
      preserve_interword_spaces: '1',
      user_defined_dpi: '0'
    });
  } else {
    // No char whitelist: the LSTM engine largely ignores it and it measurably
    // degraded reads in testing; the parser repairs stray letters instead.
    // Fixed DPI stops Tesseract mis-estimating resolution on small strips.
    await entry.worker.setParameters({
      tessedit_pageseg_mode:
        preset === 'block' ? Tesseract.PSM.SINGLE_BLOCK : Tesseract.PSM.SINGLE_LINE,
      preserve_interword_spaces: '1',
      user_defined_dpi: '300'
    });
  }
  entry.preset = preset;
};

/**
 * Boot one worker so the first real scan doesn't pay engine bootstrap inside
 * its time budget. Never rejects; resolves false if the engine failed to come up.
 *
 * Arms the teardown policy itself, so "a booted worker always has a teardown
 * timer" is a property of this module rather than of whoever happened to call
 * it. Warm-up used to leave `idleDelay` at 0 — which makes `scheduleIdleRelease`
 * a no-op — so a worker booted outside a scan held a WASM heap and the 5.2 MB
 * traineddata until the tab closed. `acquire` cancels a pending release and
 * `release` re-arms it, so a scan can never be torn down underneath itself.
 */
export const warmOcrEngine = (idleMs = DEFAULT_IDLE_MS) => {
  cancelIdleRelease();
  idleDelay = idleMs;
  const entry = entries[0] || bootEntry();
  const armed = (ok) => {
    scheduleIdleRelease();
    return ok;
  };
  return entry.ready.then(() => armed(true), () => armed(false));
};

/** Full-page sparse-text OCR. Returns flat lists of lines and words. */
export const recognizeSparse = async (input) => {
  const entry = await acquire('sparse');
  try {
    await applyPreset(entry, 'sparse');
    const result = await entry.worker.recognize(input, {}, { blocks: true });
    return collectLinesAndWords(result);
  } finally {
    release(entry);
  }
};

/**
 * Targeted OCR for a zoomed ROI crop.
 * mode 'line' = PSM SINGLE_LINE; 'block' = PSM SINGLE_BLOCK (tolerates a
 * sliver of a neighbouring text row inside the crop).
 */
export const recognizeLine = async (input, { mode = 'line' } = {}) => {
  const preset = mode === 'block' ? 'block' : 'line';
  prewarmOcrPool();
  const entry = await acquire(preset);
  let result;
  try {
    await applyPreset(entry, preset);
    result = await entry.worker.recognize(input, {}, { blocks: true });
  } finally {
    release(entry);
  }
  const { lines, words } = collectLinesAndWords(result);

  const lineReads = lines.map((l) => ({
    text: lineText(l).trim(),
    confidence: l.words && l.words.length
      ? l.words.reduce((s, w) => s + (w.confidence || 0), 0) / l.words.length
      : 0
  })).filter((l) => l.text);

  const text = lineReads.map((l) => l.text).join(' ').trim();
  const confidences = words.map((w) => w.confidence || 0);
  const confidence = confidences.length
    ? confidences.reduce((s, c) => s + c, 0) / confidences.length
    : 0;
  return { text, confidence, lines: lineReads };
};

export const lineText = (line) =>
  line.words ? line.words.map((w) => w.text).join(' ') : (line.text || '');

export const collectLinesAndWords = (result) => {
  const lines = [];
  const words = [];
  if (!result?.data?.blocks) return { lines, words };
  for (const block of result.data.blocks) {
    for (const para of block.paragraphs || []) {
      for (const line of para.lines || []) {
        lines.push(line);
        if (line.words) words.push(...line.words);
      }
    }
  }
  return { lines, words };
};

/**
 * Arm a delayed teardown: the pool's WASM heaps are released after `ms` of no
 * OCR activity. Any read cancels it. Cheaper than tearing down after every
 * scan — a re-scan or a second image within the window reuses a warm pool.
 */
export const releaseOcrWorkersWhenIdle = (ms = DEFAULT_IDLE_MS) => {
  idleDelay = ms;
  cancelIdleRelease();
  scheduleIdleRelease();
};

export const terminateOcrWorker = async () => {
  cancelIdleRelease();
  generation += 1;
  const dead = entries;
  entries = [];
  failWaiters(new Error('OCR workers terminated'));
  await Promise.all(dead.map(async (entry) => {
    try {
      const worker = entry.worker ?? await entry.ready;
      await worker.terminate();
    } catch {
      // worker never came up; nothing to terminate
    }
  }));
};
