/**
 * PaddleOCR (paddlejs) engine wrapper — browser-only neural OCR used as the
 * high-accuracy rescue pass on ROIs Tesseract could not parse.
 *
 * Models are served locally from public/models/ (no network dependency).
 * Initialisation compiles WebGL shaders and takes seconds, so it is kicked
 * off in the background at detection start; the pipeline only uses Paddle
 * when it is already warm — never blocking a detection run on model init.
 */

let paddlePromise = null;
let paddleApi = null;

export const ensurePaddle = () => {
  if (typeof document === 'undefined') return Promise.resolve(null);
  if (!paddlePromise) {
    paddlePromise = (async () => {
      // The paddlejs bundle's emscripten glue assigns to an undeclared
      // global `Module`, which throws in strict-mode ESM. Predeclare it.
      if (typeof globalThis.Module === 'undefined') globalThis.Module = {};
      const ocr = await import('@paddlejs-models/ocr');
      const base = import.meta.env?.BASE_URL || '/';
      await ocr.init(
        `${base}models/ocr-det/model.json`,
        `${base}models/ocr-rec/model.json`
      );
      return ocr;
    })()
      .catch((err) => {
        console.warn('[DimensionsOCR] PaddleOCR unavailable:', err?.message || err);
        return null;
      })
      .then((api) => {
        paddleApi = api;
        return api;
      });
  }
  return paddlePromise;
};

/** Non-blocking: the API object once init has finished, else null. */
export const paddleIfReady = () => paddleApi;

const COLLAGE_WIDTH = 960;
const COLLAGE_PAD = 12;

/**
 * OCR a set of grayscale tiles in a single det+rec pass by packing them into
 * one collage image. Returns [{ tileIndex, text }].
 * @param tiles [{ gray: {data:Uint8Array,width,height} }]
 */
export const paddleRecognizeTiles = async (ocrApi, tiles) => {
  if (!ocrApi || tiles.length === 0) return [];

  const canvas = document.createElement('canvas');

  // Lay out tiles top-to-bottom, remembering each rectangle
  const rects = [];
  let y = COLLAGE_PAD;
  let maxW = 0;
  for (const tile of tiles) {
    const scale = Math.min(1, (COLLAGE_WIDTH - COLLAGE_PAD * 2) / tile.gray.width);
    const w = Math.round(tile.gray.width * scale);
    const h = Math.round(tile.gray.height * scale);
    if (y + h > COLLAGE_WIDTH - COLLAGE_PAD) break; // keep collage ≤ det input size
    rects.push({ x: COLLAGE_PAD, y, width: w, height: h, scale });
    y += h + COLLAGE_PAD;
    maxW = Math.max(maxW, w);
  }
  if (rects.length === 0) return [];

  canvas.width = Math.min(COLLAGE_WIDTH, maxW + COLLAGE_PAD * 2);
  canvas.height = y;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let i = 0; i < rects.length; i++) {
    const { gray } = tiles[i];
    const rect = rects[i];
    const tileCanvas = document.createElement('canvas');
    tileCanvas.width = gray.width;
    tileCanvas.height = gray.height;
    const tctx = tileCanvas.getContext('2d');
    const rgba = new Uint8ClampedArray(gray.width * gray.height * 4);
    for (let p = 0, q = 0; p < gray.data.length; p++, q += 4) {
      rgba[q] = gray.data[p];
      rgba[q + 1] = gray.data[p];
      rgba[q + 2] = gray.data[p];
      rgba[q + 3] = 255;
    }
    tctx.putImageData(new ImageData(rgba, gray.width, gray.height), 0, 0);
    ctx.drawImage(tileCanvas, rect.x, rect.y, rect.width, rect.height);
  }

  // paddle recognize() reads naturalWidth/naturalHeight — needs an <img>
  const img = new Image();
  img.src = canvas.toDataURL('image/png');
  await img.decode();

  const res = await ocrApi.recognize(img);
  const texts = res?.text || [];
  const points = res?.points || [];

  const results = [];
  for (let i = 0; i < texts.length; i++) {
    const box = points[i];
    let tileIndex = -1;
    if (Array.isArray(box) && box.length > 0) {
      const pts = Array.isArray(box[0]) ? box : [box];
      const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
      const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
      tileIndex = rects.findIndex((r) =>
        cx >= r.x - COLLAGE_PAD && cx <= r.x + r.width + COLLAGE_PAD &&
        cy >= r.y - COLLAGE_PAD / 2 && cy <= r.y + r.height + COLLAGE_PAD / 2
      );
    } else if (rects.length === 1) {
      tileIndex = 0;
    }
    if (tileIndex >= 0 && texts[i]) {
      results.push({ tileIndex, text: String(texts[i]) });
    }
  }
  return results;
};
