/**
 * Decoded images, kept across plan switches.
 *
 * The camera mints a fresh `new window.Image()` for whatever data URL it is
 * given and waits for `onload`. That is the right shape while a plan's image
 * changes only when the user loads or crops one. It is the wrong shape once
 * switching plans unmounts and remounts the stage, because every switch would
 * then re-decode a multi-megabyte PNG on the main thread — the decode being the
 * expensive half, not the fetch, since a data URL has nothing to fetch.
 *
 * Keyed by the data URL string itself, by identity. Not a hash: this returns
 * the pixels a caller will draw, so two distinct images sharing a hash would
 * hand back the wrong drawing with nothing to see. `detectionWorker` and the
 * OCR scan cache key the same way and say the same thing.
 *
 * Three entries, holding decoded bitmaps of 8–34 MB each. Enough that flipping
 * between two plans is free and a third is still warm; small enough that the
 * ceiling is bounded no matter how many plans are open.
 */

const MAX_DECODED = 3;

/** @type {Map<string, HTMLImageElement>} data URL → decoded image */
const decoded = new Map();

/** A decode already in progress, so two callers wait on one. */
const pending = new Map();

const remember = (url, img) => {
  decoded.set(url, img);
  while (decoded.size > MAX_DECODED) decoded.delete(decoded.keys().next().value);
};

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

  const task = new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => {
      remember(url, img);
      resolve(img);
    };
    img.onerror = reject;
    img.src = url;
  }).finally(() => {
    pending.delete(url);
  });

  pending.set(url, task);
  return task;
}

/** Forget one image, or all of them. For a plan being closed, and for tests. */
export function forgetImage(url) {
  if (url === undefined) {
    decoded.clear();
    return;
  }
  decoded.delete(url);
}

/** How many decoded images are held. For tests and diagnosis. */
export const decodedCount = () => decoded.size;
