import {
  detectRoomFromClickCore, traceFloorplanBoundaryCore, wallSnapSegmentsCore,
  prewarmDetectionCore,
} from '../utils/detection/pipeline';
import { clearDetectionCache } from '../utils/detection/cache';
import { hashDataUrl } from '../utils/hash';

// Decoded image data is reused across requests for the same image: a room
// click and a perimeter trace on one floorplan used to decode, binarize and
// analyse it from scratch every time.
let lastImageUrl = null;
let lastCacheKey = null;
let lastImageData = null;
let decodeCount = 0;

const imageBitmapToImageData = async (imageDataUrl) => {
  // Identity is the data URL itself, not its hash — same as the OCR memo, and
  // for the same reason. `hashDataUrl` folds an 8 KB prefix into 32 bits, so it
  // can hand two images one key, and the eraser and crop tools emit same-length
  // URLs from one canvas. Returning the previous image's pixels here would be a
  // wrong answer with nothing to look wrong about.
  if (imageDataUrl === lastImageUrl && lastImageData) {
    return { imageData: lastImageData, cacheKey: lastCacheKey };
  }
  // Everything the detection memo holds is keyed by image, so a new one makes
  // all of it unreadable dead weight — tens of MB of page-sized label arrays,
  // previously kept until the *next* trace of the new image happened to evict
  // it, or forever if the user only ran OCR.
  if (lastImageUrl) clearDetectionCache();
  const response = await fetch(imageDataUrl);
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  lastImageUrl = imageDataUrl;
  // The memo key has to be stable across requests for one image (that sharing
  // is what makes N room clicks cost one trace) and distinct across images. The
  // decode counter supplies the second half, which the hash alone cannot.
  lastCacheKey = `${hashDataUrl(imageDataUrl)}#${++decodeCount}`;
  lastImageData = imageData;
  return { imageData, cacheKey: lastCacheKey };
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
  'alternatives', 'sealSearches', 'sides', 'searchMemo',
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

    // Reported on the envelope (not in `data`) so the DEV perf report can show
    // what the decode costs without touching any result contract.
    const decodeStart = Date.now();
    const { imageData, cacheKey } = await imageBitmapToImageData(payload.image);
    const decodeMs = Date.now() - decodeStart;
    const options = { ...payload.options, cacheKey };
    let data = null;

    if (type === 'detectRoomFromClick') {
      data = detectRoomFromClickCore(imageData, payload.clickPoint, options);
    } else if (type === 'detectRoomsFromLabels') {
      // Every parsed label measured in one request. The shared cacheKey is the
      // whole point: the analysis and the clamp trace are ~97% of a single room
      // click, so the second label onward costs 1-3ms instead of another trace.
      //
      // No `pixelsPerFoot` prior, deliberately. It cannot move a rectangle —
      // SCALE_TOLERANCE is wider than any error a real plan produces — but it
      // does move `confidence`, and confidence is what decides which rooms the
      // scale is taken from. Threading a running prior through the loop would
      // make that selection depend on the order OCR happened to return labels.
      data = (payload.labels ?? []).map((label) => {
        const room = detectRoomFromClickCore(imageData, label.point, {
          ...options,
          labelBbox: label.labelBbox,
          labelDims: label.labelDims,
          pixelsPerFoot: null,
        });
        if (!room) return null;
        return {
          ...room,
          labelId: label.id ?? null,
          labelDims: label.labelDims ?? null,
          debug: projectDebug(room.debug),
        };
      });
    } else if (type === 'traceFloorplanBoundary') {
      data = traceFloorplanBoundaryCore(imageData, options);
    } else if (type === 'warmDetection') {
      // Fire-and-forget: runs during the OCR scan so the analysis and the
      // room-clamp ladder are already in the memo when step 4 asks for them.
      data = prewarmDetectionCore(imageData, options);
    } else if (type === 'wallSnapSegments') {
      // Run here so it reuses this decode instead of doing its own
      // full-resolution getImageData on the main thread mid-gesture, and
      // routed through the analysis memo so it doubles as the prewarm for the
      // room and boundary stages that follow the scan. Only the segments cross
      // back — no masks.
      data = wallSnapSegmentsCore(imageData, options);
    } else {
      throw new Error(`Unsupported worker action: ${type}`);
    }

    if (data?.debug) data.debug = projectDebug(data.debug);

    self.postMessage({ id, ok: true, data, decodeMs });
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown detection worker error',
    });
  }
};
