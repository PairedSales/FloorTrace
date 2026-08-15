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

const runWorkerRequest = (type, payload, timeoutMs = 30_000) => new Promise((resolve, reject) => {
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

// Per-floor boundaries in page reading order, each with its enclosed voids and
// the quality the detector attached to it. Falls back to the single top-level
// boundary for results predating the floors array (old autosaves).
export const getFloorBoundariesForMode = (tracedBoundary, useInteriorWalls) => {
  if (!tracedBoundary) return [];
  const mode = useInteriorWalls ? 'inner' : 'outer';
  const floors = tracedBoundary.floors?.length ? tracedBoundary.floors : [tracedBoundary];
  return floors
    .map((floor) => {
      const boundary = boundaryByMode(floor, mode);
      if (!boundary?.polygon?.length) return null;
      return {
        polygon: boundary.polygon,
        overlay: boundary.overlay,
        holes: (useInteriorWalls ? floor.innerHoles : floor.holes) ?? [],
        confidence: floor.confidence ?? tracedBoundary.quality?.confidence ?? null,
        warnings: floor.warnings ?? [],
      };
    })
    .filter(Boolean);
};

export const terminateDetectionWorker = () => {
  if (!detectionWorker) return;
  detectionWorker.terminate();
  detectionWorker = null;
  pending.forEach((request) => request.reject(new Error('Detection worker terminated')));
  pending.clear();
};
