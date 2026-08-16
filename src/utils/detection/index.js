import { boundaryByMode } from './pipeline';

let detectionWorker = null;
let nextRequestId = 1;
const pending = new Map();

const ensureWorker = () => {
  if (detectionWorker) return detectionWorker;

  detectionWorker = new Worker(new URL('../../workers/detectionWorker.js', import.meta.url), { type: 'module' });
  detectionWorker.onmessage = (event) => {
    const { id, ok, data, error } = event.data ?? {};
    const request = pending.get(id);
    if (!request) return;
    pending.delete(id);
    if (ok) {
      request.resolve(data);
      return;
    }
    request.reject(new Error(error || 'Detection request failed'));
  };

  return detectionWorker;
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
  const timer = setTimeout(() => {
    pending.delete(id);
    // The worker is single-threaded and still crunching the runaway job —
    // kill it so the next request respawns a fresh worker instead of queueing.
    terminateDetectionWorker();
    reject(new Error('Detection timed out'));
  }, timeoutMs);
  pending.set(id, {
    resolve: (data) => {
      clearTimeout(timer);
      resolve(data);
    },
    reject: (error) => {
      clearTimeout(timer);
      reject(error);
    },
  });
  worker.postMessage({ id, type, payload });
});

// Wall segments for the room-overlay snap engine, vectorised in the worker off
// the decode it already holds for this image.
export const computeWallSnapSegments = async (image) => {
  if (!image) return null;
  return runWorkerRequest('wallSnapSegments', { image }, 60_000);
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

export const getFloorBoundariesForMode = (tracedBoundary, useInteriorWalls) => {
  const key = useInteriorWalls ? 'inner' : 'outer';
  return getFloorBoundaryFaces(tracedBoundary)
    .map((floor) => (floor[key]
      ? { ...floor[key], confidence: floor.confidence, warnings: floor.warnings }
      : null))
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
