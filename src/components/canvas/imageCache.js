/**
 * Decoded images, kept across plan switches.
 *
 * The camera used to mint a fresh `new window.Image()` for whatever data URL it
 * was given and wait for `onload`. That is the wrong shape once switching plans
 * unmounts and remounts the stage, because every switch would then decode a
 * multi-megabyte PNG again — so the decode is done once and kept here.
 *
 * It is also done off the page (`workers/decodeWorker.js`, which has the
 * numbers): what comes back is an `ImageBitmap`, pixels already in hand, where
 * an `<img>` is only a promise to decode on first paint — on the page's thread,
 * and again for a canvas of another size. Everything that draws a plan takes
 * either; both have `width`, `height` and go to `drawImage`.
 *
 * Keyed by the data URL string itself, by identity. Not a hash: this returns
 * the pixels a caller will draw, so two distinct images sharing a hash would
 * hand back the wrong drawing with nothing to see. `detectionWorker` and the
 * OCR scan cache key the same way and say the same thing.
 *
 * Three entries, holding decoded bitmaps of 8–48 MB each. Enough that flipping
 * between two plans is free and a third is still warm; small enough that the
 * ceiling is bounded no matter how many plans are open.
 *
 * Import-free on purpose: the eager shell reaches this module, and anything it
 * imported would ride into the entry chunk with it.
 */

const MAX_DECODED = 3;

/** @type {Map<string, ImageBitmap|HTMLImageElement>} data URL → decoded image */
const decoded = new Map();

/** A decode already in progress, so two callers wait on one. */
const pending = new Map();

const remember = (url, img) => {
  decoded.set(url, img);
  while (decoded.size > MAX_DECODED) decoded.delete(decoded.keys().next().value);
};

// ── the decode worker ───────────────────────────────────────────────────────

let decoder = null;
// Set once the worker has failed in a way that is about the worker rather than
// about one image. From then on every image is decoded on the page, which is
// slower and always works.
let decoderBroken = false;
let nextRequestId = 1;
/** @type {Map<number, {resolve: Function, reject: Function}>} */
const requests = new Map();

const failRequests = (error) => {
  const waiting = [...requests.values()];
  requests.clear();
  waiting.forEach((request) => request.reject(error));
};

const startDecoder = () => {
  const worker = new Worker(new URL('../../workers/decodeWorker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (event) => {
    const { id, bitmap, error } = event.data ?? {};
    const request = requests.get(id);
    if (!request) return;
    requests.delete(id);
    if (bitmap) request.resolve(bitmap);
    else request.reject(new Error(error || 'The image could not be decoded'));
  };
  // A script that 404s after a deploy, or a crash: nothing arrives on the
  // message channel for either, and a plan must not wait on it forever.
  const broke = (event) => {
    event?.preventDefault?.();
    decoderBroken = true;
    worker.terminate();
    if (decoder === worker) decoder = null;
    failRequests(new Error('The image decoder stopped'));
  };
  worker.onerror = broke;
  worker.onmessageerror = broke;
  return worker;
};

const decodeOffPage = (url) => new Promise((resolve, reject) => {
  if (decoderBroken || typeof Worker === 'undefined' || typeof createImageBitmap !== 'function') {
    reject(new Error('No image decoder'));
    return;
  }
  try {
    decoder = decoder ?? startDecoder();
  } catch (error) {
    decoderBroken = true;
    reject(error);
    return;
  }
  const id = nextRequestId;
  nextRequestId += 1;
  requests.set(id, { resolve, reject });
  decoder.postMessage({ id, image: url });
});

/** The way every image was decoded before the worker, and still the fallback. */
const decodeOnPage = (url) => new Promise((resolve, reject) => {
  const img = new window.Image();
  img.onload = () => resolve(img);
  img.onerror = reject;
  img.src = url;
});

// ── the cache ───────────────────────────────────────────────────────────────

/**
 * The decoded image for `url`, synchronously, if it is already known.
 * Returns null on a miss — callers that can paint immediately should check this
 * before awaiting, so returning to a plan does not flash an empty stage.
 */
export function decodedImage(url) {
  if (!url || !decoded.has(url)) return null;
  const img = decoded.get(url);
  // Refresh recency.
  decoded.delete(url);
  decoded.set(url, img);
  return img;
}

/** Decode `url`, or hand back the decode already running for it. */
export function loadImage(url) {
  if (!url) return Promise.resolve(null);

  const hit = decodedImage(url);
  if (hit) return Promise.resolve(hit);

  const already = pending.get(url);
  if (already) return already;

  // The worker first; the page for whatever it could not do — a browser
  // without it, or an image only an <img> can read (an SVG). An image neither
  // can read rejects, as it always did.
  const task = decodeOffPage(url)
    .catch(() => decodeOnPage(url))
    .then((img) => {
      remember(url, img);
      return img;
    })
    .finally(() => {
      pending.delete(url);
    });

  pending.set(url, task);
  return task;
}

/**
 * Forget one image, or all of them. For a plan being closed, and for tests.
 *
 * The bitmap is dropped, never `close()`d: two plans opened from one file hold
 * the same one, and a stage still showing it would throw on its next draw.
 */
export function forgetImage(url) {
  if (url === undefined) {
    decoded.clear();
    return;
  }
  decoded.delete(url);
}
