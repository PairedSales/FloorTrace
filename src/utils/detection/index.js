import { boundaryByMode } from './pipeline';
import { perfRecordWorker } from '../perfMarks';
import { isStaleChunkError, recoverFromStaleBuild } from '../staleBuild';

let detectionWorker = null;
let nextRequestId = 1;
const pending = new Map();

const failPending = (error) => {
  const requests = [...pending.values()];
  pending.clear();
  requests.forEach((request) => request.reject(error));
};

/**
 * The worker died. Nothing arrives on the message channel when that happens —
 * an OOM kill, a chunk that 404s after a deploy, a syntax error in the module —
 * so before this every pending request simply sat there until its own timeout,
 * and a dead worker was indistinguishable from a slow one for thirty seconds.
 *
 * The word "worker" in the message is load-bearing: the App layer tells a kill
 * from a timeout by matching it, and says different things to the user.
 */
const handleWorkerCrash = (detail) => {
  if (detectionWorker) {
    detectionWorker.terminate();
    detectionWorker = null;
  }
  // After a deploy this is a hashed filename that no longer exists: the page is
  // stale, not the plan. Reloading is the fix and there is nothing to report.
  if (isStaleChunkError(detail) && recoverFromStaleBuild()) return;
  failPending(new Error(`Detection worker stopped: ${detail || 'it crashed or was killed'}`));
};

const ensureWorker = () => {
  if (detectionWorker) return detectionWorker;

  let worker;
  try {
    worker = new Worker(new URL('../../workers/detectionWorker.js', import.meta.url), { type: 'module' });
  } catch (error) {
    detectionWorker = null;
    // Same fact one step earlier, and the only place it can be caught
    // synchronously: a stale index naming a chunk nobody serves any more.
    if (isStaleChunkError(error)) recoverFromStaleBuild();
    throw new Error(`Detection worker could not start: ${error?.message ?? 'unknown error'}`);
  }
  detectionWorker = worker;

  // Both handlers fail *every* pending request, so both check that the worker
  // they belong to is still the one in use: a timeout, a cancel and a crash all
  // replace it, and an event dispatched against the worker they replaced would
  // otherwise kill its healthy successor and everything queued on it.
  worker.onerror = (event) => {
    if (detectionWorker !== worker) return;
    // Otherwise the same failure also surfaces as an unhandled window error.
    event.preventDefault?.();
    handleWorkerCrash(event?.message || event?.error?.message || '');
  };
  // A reply that could not be structured-cloned. The worker is alive, but the
  // envelope carried the id, so there is no way to say whose result was lost.
  worker.onmessageerror = () => {
    if (detectionWorker !== worker) return;
    failPending(new Error('Detection worker sent a result that could not be read'));
  };
  worker.onmessage = (event) => {
    const { id, ok, data, error, started } = event.data ?? {};
    perfRecordWorker(event.data);
    const request = pending.get(id);
    if (!request) return;
    // The worker has picked this up, so the clock now measures the work rather
    // than the queue in front of it.
    if (started) {
      request.started = true;
      request.rearm();
      return;
    }
    pending.delete(id);
    if (ok) {
      request.resolve(data);
      return;
    }
    request.reject(new Error(error || 'Detection request failed'));
  };

  return worker;
};

// A flat budget gets tighter the more there is to measure, and
// detectRoomsFromLabels is one request covering every label on the page.
// Tripping it terminates the worker, which discards the analysis cache, so the
// retry is a cold start — the wrong answer to a page that was merely large.
const requestTimeout = (payload) =>
  Math.min(120_000, 30_000 + (payload?.labels?.length ?? 0) * 2_000);

const runWorkerRequest = (
  type, payload, timeoutMs = requestTimeout(payload),
) => new Promise((resolve, reject) => {
  const worker = ensureWorker();
  const id = nextRequestId;
  nextRequestId += 1;

  let timer = null;
  const request = {
    type,
    payload,
    timeoutMs,
    started: false,
    rearm: () => {
      clearTimeout(timer);
      timer = setTimeout(request.expire, timeoutMs);
    },
    expire: () => {
      pending.delete(id);
      // The runaway job is still crunching, so the worker is killed — but the
      // requests queued behind it never ran and are pure functions of their
      // image and payload, so they are re-posted to the fresh worker rather
      // than failed alongside it. With one plan the queue was almost always
      // empty; with two, one plan's runaway trace would have failed the other's.
      const unstarted = [...pending.entries()].filter(([, r]) => !r.started);
      for (const [otherId] of unstarted) pending.delete(otherId);

      terminateDetectionWorker();
      reject(new Error('Detection timed out'));

      try {
        const fresh = ensureWorker();
        for (const [otherId, r] of unstarted) {
          pending.set(otherId, r);
          r.rearm();
          fresh.postMessage({ id: otherId, type: r.type, payload: r.payload });
        }
      } catch (error) {
        // Nothing to re-post them to. They are already out of `pending`, so
        // without this their callers wait for a worker that will never exist.
        for (const [, r] of unstarted) r.reject(error);
      }
    },
    resolve: (data) => {
      clearTimeout(timer);
      resolve(data);
    },
    reject: (error) => {
      clearTimeout(timer);
      reject(error);
    },
  };

  pending.set(id, request);
  request.rearm();
  worker.postMessage({ id, type, payload });
});

// Wall segments for the room-overlay snap engine, vectorised in the worker off
// the decode it already holds for this image.
export const computeWallSnapSegments = async (image) => {
  if (!image) return null;
  return runWorkerRequest('wallSnapSegments', { image }, 60_000);
};

/**
 * Start the analysis and the room-clamp ladder now, so the scan pays for them
 * instead of the user. Fire-and-forget by design — nothing waits on it, and a
 * failure costs only the speed-up.
 *
 * Gated on core count: the OCR pool is `min(4, cores/2)`, so on a 4-core
 * machine a third compute thread would contend with two Tesseract workers and
 * the main thread. The scan's own budget is wall clock (it drops ROIs when it
 * overruns), which means losing that race would cost detections rather than
 * just time — so this only runs where there is genuine headroom.
 *
 * The long timeout is deliberate: a tripped timeout terminates the worker, and
 * this request is queued ahead of the real ones.
 */
export const prewarmDetection = (image) => {
  if (!image) return;
  if ((globalThis.navigator?.hardwareConcurrency ?? 0) < 8) return;
  runWorkerRequest('warmDetection', { image }, 120_000).catch(() => {});
};

export const detectRoomFromClick = async (image, clickPoint, options = {}) => {
  if (!image || !clickPoint) return null;
  return runWorkerRequest('detectRoomFromClick', {
    image,
    clickPoint,
    options,
  });
};

/**
 * Measure every parsed dimension label as a room, in one request.
 *
 * `labels`: [{ id, point, labelBbox, labelDims }] in original image px.
 * Returns an array positionally matching `labels`, with null where a label's
 * room could not be found. One request rather than N because the worker's
 * analysis and clamp trace are shared across the batch; issuing N separate
 * `detectRoomFromClick` calls would re-pay neither, but would re-enter the
 * queue N times and interleave with a perimeter trace.
 */
export const detectRoomsFromLabels = async (image, labels, options = {}) => {
  if (!image || !labels?.length) return [];
  return runWorkerRequest('detectRoomsFromLabels', { image, labels, options });
};

/**
 * Tell the worker a plan's image is gone, so it can free the decode and
 * everything the detection memo holds for it. Fire-and-forget: the cost of it
 * not arriving is memory the LRU would have reclaimed anyway.
 */
export const disposeDetectionImage = (image) => {
  if (!image || !detectionWorker) return;
  runWorkerRequest('disposeImage', { image }, 15_000).catch(() => {});
};

export const traceFloorplanBoundary = async (image, options = {}) => {
  if (!image) return null;
  return runWorkerRequest('traceFloorplanBoundary', {
    image,
    options,
  });
};

const floorFace = (floor, mode) => {
  const boundary = boundaryByMode(floor, mode);
  if (!boundary?.polygon?.length) return null;
  return {
    polygon: boundary.polygon,
    overlay: boundary.overlay,
    holes: (mode === 'inner' ? floor.innerHoles : floor.holes) ?? [],
  };
};

/**
 * Per-floor boundaries in page reading order, both wall faces together, each
 * with its enclosed voids and the quality the detector attached to it. Falls
 * back to the single top-level boundary for results predating the floors array
 * (old autosaves).
 *
 * Emitted as a pair rather than one chosen face because the exterior/interior
 * switch is a single setting over every outline on the canvas, so each trace
 * has to carry its own pair: `tracedBoundaries` holds only the most recent
 * detection run, and a plan traced in several passes has outlines from earlier
 * ones that run cannot describe.
 */
export const getFloorBoundaryFaces = (tracedBoundary) => {
  if (!tracedBoundary) return [];
  const floors = tracedBoundary.floors?.length ? tracedBoundary.floors : [tracedBoundary];
  return floors
    .map((floor) => {
      const outer = floorFace(floor, 'outer');
      const inner = floorFace(floor, 'inner');
      if (!outer && !inner) return null;
      return {
        outer,
        inner,
        confidence: floor.confidence ?? tracedBoundary.quality?.confidence ?? null,
        warnings: floor.warnings ?? [],
      };
    })
    .filter(Boolean);
};

// The detection memo lives in the worker's module scope, so terminating the
// worker is what frees it. Calling clearDetectionCache() here would clear the
// main thread's own (permanently empty) copy of that module state and look
// like a cleanup that was never happening.
export const terminateDetectionWorker = () => {
  if (!detectionWorker) return;
  detectionWorker.terminate();
  detectionWorker = null;
  pending.forEach((request) => request.reject(new Error('Detection worker terminated')));
  pending.clear();
};

/**
 * Abandon everything the detection worker is doing, because the user said stop.
 *
 * The cores are straight-line pure JS — nothing inside a trace polls a signal —
 * so terminating is the only thing that gives the CPU back, and rejecting is
 * the only thing that unblocks a caller still awaiting it. Without both, a
 * cancelled trace runs its full thirty seconds with the spinner still up.
 *
 * Unlike the timeout path this does not re-post what never ran: there the queue
 * behind a runaway job is innocent, here the whole queue is what was cancelled.
 *
 * The message names the worker on purpose, because of *who* reads it. The plan
 * that pressed Stop never does — its token was aborted first, so its delivery
 * resolves to 'dropped' and the closure holding the toast never runs. The only
 * caller left to see this is another open plan whose trace this terminate took
 * with it, and for that plan "interrupted before it finished" — the App layer's
 * `/terminated|worker/i` branch — is exactly what happened. Worded to match
 * neither pattern it fell through to "Could not trace this plan", which blames
 * a drawing for a button pressed on somebody else's tab.
 *
 * @returns {number} how many requests were abandoned
 */
export const abandonDetectionWork = () => {
  const count = pending.size;
  if (detectionWorker) {
    detectionWorker.terminate();
    detectionWorker = null;
  }
  failPending(new Error('Detection worker terminated — cancelled'));
  return count;
};
