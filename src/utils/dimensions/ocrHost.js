/**
 * The page's half of `workers/ocrWorker.js`: start it, hand it scans, relay the
 * one thing it cannot do itself (PaddleOCR, which needs WebGL and an <img>).
 *
 * The worker is the fast path, never the only one. Whatever stops it — a
 * browser that cannot start workers from a worker, a script that fails to
 * load, a crash — is reported to the caller as `hostUnavailable`, and the
 * caller runs the scan on the page the way it always did. Once that has
 * happened the worker is not tried again this session: a scan that works every
 * time on the page beats one that fails first.
 */

let config = { tesseract: undefined, refine: null };

/** The worker, once it has said it can do the job. */
let worker = null;
/** A start under way: resolves to whether the worker is usable. */
let starting = null;
let settleStart = null;
/** The worker that start is waiting to hear from. */
let booting = null;
let unusable = false;
let paddleReady = false;

let nextScanId = 1;
/** @type {Map<number, {resolve: Function, reject: Function}>} */
const pending = new Map();

const unavailable = (detail) => {
  const error = new Error(`The reading worker stopped: ${detail || 'it crashed or was killed'}`);
  error.hostUnavailable = true;
  return error;
};

const rejectPending = (error) => {
  const requests = [...pending.values()];
  pending.clear();
  requests.forEach((request) => request.reject(error));
};

const giveUp = (target, detail) => {
  unusable = true;
  target?.terminate();
  if (worker === target) worker = null;
  settleStart?.(false);
  rejectPending(unavailable(detail));
};

/**
 * @param {{tesseract: object, refine: (tiles: Array) => Promise<Array>}} options
 *   `tesseract` is handed to `createWorker` (self-hosted asset URLs); `refine`
 *   is the PaddleOCR pass, run here on the worker's behalf.
 */
export const configureOcrHost = (options) => {
  config = { ...config, ...options };
};

/** Start the worker if it is not running. Resolves to whether it can be used. */
export const startOcrHost = () => {
  if (unusable || typeof Worker === 'undefined') return Promise.resolve(false);
  if (worker) return Promise.resolve(true);
  if (starting) return starting;

  starting = new Promise((resolve) => {
    settleStart = (usable) => {
      settleStart = null;
      starting = null;
      booting = null;
      resolve(usable);
    };

    let target;
    try {
      target = new Worker(new URL('../../workers/ocrWorker.js', import.meta.url), { type: 'module' });
    } catch (error) {
      giveUp(null, error?.message);
      return;
    }
    booting = target;

    // Nothing arrives on the message channel when a worker dies or its script
    // 404s after a deploy, so without these a scan would wait on it forever.
    target.onerror = (event) => {
      event.preventDefault?.();
      giveUp(target, event?.message || event?.error?.message);
    };
    target.onmessageerror = () => giveUp(target, 'it sent a result that could not be read');

    target.onmessage = (event) => {
      const message = event.data ?? {};
      if (message.type === 'ready') {
        if (!message.capable) {
          giveUp(target, 'this browser cannot read from a worker');
          return;
        }
        worker = target;
        target.postMessage({ type: 'configure', options: config.tesseract });
        target.postMessage({ type: 'paddle', ready: paddleReady });
        settleStart?.(true);
      } else if (message.type === 'scanned') {
        const request = pending.get(message.id);
        if (!request) return;
        pending.delete(message.id);
        if (message.ok) request.resolve(message.data);
        // The scan's own failure, not the worker's: it would fail on the page
        // too, so it is reported rather than retried there.
        else request.reject(new Error(message.error || 'The scan failed'));
      } else if (message.type === 'refine') {
        Promise.resolve()
          .then(() => config.refine?.(message.tiles) ?? [])
          .catch(() => [])
          .then((results) => {
            if (worker === target) target.postMessage({ type: 'refined', id: message.id, results });
          });
      }
    };
  });
  return starting;
};

/** Fire-and-forget. A message for a worker that is not running is dropped. */
export const tellOcrHost = (message) => {
  worker?.postMessage(message);
};

/** Whether the opt-in second reader is warm; the worker cannot see for itself. */
export const setOcrHostPaddleReady = (ready) => {
  paddleReady = Boolean(ready);
  tellOcrHost({ type: 'paddle', ready: paddleReady });
};

/**
 * Scan one image in the worker.
 *
 * Rejects with `error.hostUnavailable` when the worker itself is the problem,
 * which is the caller's cue to run the scan on the page instead.
 */
export const scanInOcrHost = (imageDataUrl) => new Promise((resolve, reject) => {
  if (!worker) {
    reject(unavailable('it is not running'));
    return;
  }
  const id = nextScanId;
  nextScanId += 1;
  pending.set(id, { resolve, reject });
  worker.postMessage({ type: 'scan', id, image: imageDataUrl });
});

/**
 * Stop the worker now. Synchronous — it runs in an unmount cleanup — and it
 * takes the Tesseract pool with it: those are this worker's own workers.
 * A later scan starts a fresh one.
 */
export const terminateOcrHost = () => {
  (worker ?? booting)?.terminate();
  worker = null;
  // A start caught half-way would otherwise never settle, and its worker
  // would come up after the teardown that was meant to stop it.
  settleStart?.(false);
  rejectPending(new Error('OCR workers terminated'));
};
