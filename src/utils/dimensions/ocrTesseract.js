/**
 * Tesseract.js engine wrapper — lazy module load, cached worker, and the two
 * parameter presets the pipeline uses (sparse full-page pass and targeted
 * single-line ROI pass).
 */

let tesseractModulePromise = null;
let workerPromise = null;
let currentPreset = null;
let createWorkerOptions;

const loadTesseract = async () => {
  if (!tesseractModulePromise) {
    tesseractModulePromise = import('tesseract.js').then((m) => m.default ?? m);
  }
  return tesseractModulePromise;
};

/**
 * Inject createWorker options (workerPath/corePath/langPath) before the first
 * getWorker() call. The browser entry uses this to point tesseract.js at
 * self-hosted assets instead of its jsdelivr defaults; Node harnesses skip it.
 */
export const configureTesseract = (options) => {
  createWorkerOptions = options;
};

export const getWorker = async () => {
  if (!workerPromise) {
    const pending = (async () => {
      const Tesseract = await loadTesseract();
      return Tesseract.createWorker('eng', 1, createWorkerOptions);
    })();
    workerPromise = pending;
    // Don't cache a failed boot — the next call should retry, not inherit
    // a permanently rejected promise.
    pending.catch(() => {
      if (workerPromise === pending) workerPromise = null;
    });
  }
  return workerPromise;
};

const applyPreset = async (worker, preset) => {
  if (currentPreset === preset) return;
  const Tesseract = await loadTesseract();
  if (preset === 'sparse') {
    await worker.setParameters({
      tessedit_pageseg_mode: Tesseract.PSM.SPARSE_TEXT,
      preserve_interword_spaces: '1',
      user_defined_dpi: '0'
    });
  } else {
    // No char whitelist: the LSTM engine largely ignores it and it measurably
    // degraded reads in testing; the parser repairs stray letters instead.
    // Fixed DPI stops Tesseract mis-estimating resolution on small strips.
    await worker.setParameters({
      tessedit_pageseg_mode:
        preset === 'block' ? Tesseract.PSM.SINGLE_BLOCK : Tesseract.PSM.SINGLE_LINE,
      preserve_interword_spaces: '1',
      user_defined_dpi: '300'
    });
  }
  currentPreset = preset;
};

/** Full-page sparse-text OCR. Returns flat lists of lines and words. */
export const recognizeSparse = async (input) => {
  const worker = await getWorker();
  await applyPreset(worker, 'sparse');
  const result = await worker.recognize(input, {}, { blocks: true });
  return collectLinesAndWords(result);
};

/**
 * Targeted OCR for a zoomed ROI crop.
 * mode 'line' = PSM SINGLE_LINE; 'block' = PSM SINGLE_BLOCK (tolerates a
 * sliver of a neighbouring text row inside the crop).
 */
export const recognizeLine = async (input, { mode = 'line' } = {}) => {
  const worker = await getWorker();
  await applyPreset(worker, mode === 'block' ? 'block' : 'line');
  const result = await worker.recognize(input, {}, { blocks: true });
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

export const terminateOcrWorker = async () => {
  if (workerPromise) {
    const pending = workerPromise;
    workerPromise = null;
    currentPreset = null;
    try {
      const worker = await pending;
      await worker.terminate();
    } catch {
      // worker never came up; nothing to terminate
    }
  }
};
