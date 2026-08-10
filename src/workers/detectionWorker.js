import { detectRoomFromClickCore, traceFloorplanBoundaryCore } from '../utils/detection/pipeline';
import { hashDataUrl } from '../utils/hash';

// Decoded image data is reused across requests for the same image: a room
// click and a perimeter trace on one floorplan used to decode, binarize and
// analyse it from scratch every time.
let lastImageKey = null;
let lastImageData = null;

const imageBitmapToImageData = async (imageDataUrl, key) => {
  if (key && key === lastImageKey && lastImageData) return lastImageData;
  const response = await fetch(imageDataUrl);
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  lastImageKey = key;
  lastImageData = imageData;
  return imageData;
};

// Only these fields cross back to the main thread. The previous blanket
// `data.debug = null` destroyed the pipeline's quality signals — the seal
// verdict, the per-side wall faces, the measured thicknesses — with a
// rationale ("avoid cloning large mask buffers") that expired when the mask
// payload was deleted. Nothing in `debug` is a buffer; the risk is a future
// addition that is, so the transport is a whitelist rather than a blocklist.
const DEBUG_WHITELIST = [
  'floorCount', 'workingSize', 'scale', 'wallThickness', 'exteriorThickness',
  'sealRadius', 'usedFallback', 'networks', 'elapsedMs', 'hasFootprint',
  'alternatives', 'sealSearches', 'sides',
];

const projectDebug = (debug) => {
  if (!debug) return null;
  const out = {};
  for (const key of DEBUG_WHITELIST) {
    if (debug[key] !== undefined) out[key] = debug[key];
  }
  return out;
};

self.onmessage = async (event) => {
  const { id, type, payload } = event.data ?? {};
  if (!id || !type) return;

  try {
    if (!payload?.image) {
      throw new Error('Detection worker requires an image data URL.');
    }

    const cacheKey = hashDataUrl(payload.image);
    const imageData = await imageBitmapToImageData(payload.image, cacheKey);
    const options = { ...payload.options, cacheKey };
    let data = null;

    if (type === 'detectRoomFromClick') {
      data = detectRoomFromClickCore(imageData, payload.clickPoint, options);
    } else if (type === 'traceFloorplanBoundary') {
      data = traceFloorplanBoundaryCore(imageData, options);
    } else {
      throw new Error(`Unsupported worker action: ${type}`);
    }

    if (data?.debug) data.debug = projectDebug(data.debug);

    self.postMessage({ id, ok: true, data });
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown detection worker error',
    });
  }
};
