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

const runWorkerRequest = (type, payload) => new Promise((resolve, reject) => {
  const worker = ensureWorker();
  const id = nextRequestId;
  nextRequestId += 1;
  pending.set(id, { resolve, reject });
  worker.postMessage({ id, type, payload });
});

export const detectRoomFromClick = async (image, clickPoint, options = {}) => {
  if (!image || !clickPoint) return null;
  return runWorkerRequest('detectRoomFromClick', { image, clickPoint, options });
};

export const traceFloorplanBoundary = async (image, options = {}) => {
  if (!image) return null;
  return runWorkerRequest('traceFloorplanBoundary', { image, options });
};

export const getBoundaryForMode = (tracedBoundary, useInteriorWalls) => {
  const mode = useInteriorWalls ? 'inner' : 'outer';
  return boundaryByMode(tracedBoundary, mode);
};

export const terminateDetectionWorker = () => {
  if (!detectionWorker) return;
  detectionWorker.terminate();
  detectionWorker = null;
  pending.forEach((request) => request.reject(new Error('Detection worker terminated')));
  pending.clear();
};
