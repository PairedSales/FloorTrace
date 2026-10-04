import { detectDimensionsCore } from '../utils/dimensions/pipeline.js';
import { grayToPngBlob } from '../utils/dimensions/pngEncode.js';
import { loadOpenCv } from '../utils/dimensions/opencvBridge.js';
import {
  configureTesseract, warmOcrEngine, releaseOcrWorkersWhenIdle,
} from '../utils/dimensions/ocrTesseract.js';

// The room-size scan, off the page's thread.
//
// Tesseract always read in workers, but everything around it did not: the
// decode and its full-size readback, grayscale, the resample to OCR size,
// CLAHE, the unsharp mask, the glyph analysis, every ROI's variants and their
// PNGs. Measured in a production build on a 16-core machine that is 1.3-1.8 s
// of page-thread work per plan, in stretches of up to 800 ms — during which the
// progress line cannot repaint and Stop cannot be pressed. A 12 MP page (a
// phone photo, or any PDF page, which is rendered at 4000 px) is the worst of
// it. The scan's budget is wall clock, too, so a render on the page thread
// used to come out of it.
//
// The Tesseract pool is created from here, as workers of this worker; OpenCV
// loads here. Only PaddleOCR stays on the page — it needs WebGL and an <img> —
// and is reached by message (`refine`).
//
// `utils/dimensions/ocrHost.js` is the page's half of this protocol.

// Whether the opt-in second reader is warm, as the page last said.
let paddleReady = false;

let nextRefineId = 1;
/** @type {Map<number, (results: Array) => void>} refine id -> resolve */
const refining = new Map();

const refineOnPage = (tiles) => new Promise((resolve) => {
  const id = nextRefineId;
  nextRefineId += 1;
  refining.set(id, resolve);
  // Only the pixels: the pipeline keeps each tile's box and matches the
  // answers back by index.
  self.postMessage({ type: 'refine', id, tiles: tiles.map((tile) => ({ gray: tile.gray })) });
});

const env = () => ({
  toOcrInput: grayToPngBlob,
  paddleReady: () => paddleReady,
  refineRois: async (tiles) => (paddleReady ? refineOnPage(tiles) : []),
});

// The same decode the detection worker does, so both read the same pixels.
const decode = async (imageDataUrl) => {
  const response = await fetch(imageDataUrl);
  const bitmap = await createImageBitmap(await response.blob());
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  return context.getImageData(0, 0, canvas.width, canvas.height);
};

self.onmessage = async (event) => {
  const message = event.data ?? {};

  if (message.type === 'configure') {
    configureTesseract(message.options);
  } else if (message.type === 'prepare') {
    // Both are idempotent and neither rejects. OpenCV only when a scan is
    // actually coming: warming it for a visitor who never opens a plan would
    // download its 3.9 MB for nothing.
    warmOcrEngine();
    if (message.opencv) loadOpenCv();
  } else if (message.type === 'paddle') {
    paddleReady = Boolean(message.ready);
  } else if (message.type === 'releaseWhenIdle') {
    releaseOcrWorkersWhenIdle(message.ms);
  } else if (message.type === 'refined') {
    refining.get(message.id)?.(message.results ?? []);
    refining.delete(message.id);
  } else if (message.type === 'scan') {
    try {
      const imageData = await decode(message.image);
      const { dimensions, exteriorLabels, areaLabels, detectedFormat, timings, truncated } =
        await detectDimensionsCore(imageData, env());
      self.postMessage({
        type: 'scanned',
        id: message.id,
        ok: true,
        data: { dimensions, exteriorLabels, areaLabels, detectedFormat, timings, truncated },
      });
    } catch (error) {
      self.postMessage({
        type: 'scanned',
        id: message.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
};

// Said first, before any request: whether this browser can do the job from
// here at all. The pool is workers started by a worker, and the decode needs
// an OffscreenCanvas; without either the page runs the scan itself.
self.postMessage({
  type: 'ready',
  capable: typeof Worker === 'function'
    && typeof OffscreenCanvas === 'function'
    && typeof createImageBitmap === 'function',
});
