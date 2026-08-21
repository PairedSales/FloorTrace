import {
  detectRoomFromClickCore, traceFloorplanBoundaryCore, wallSnapSegmentsCore,
  prewarmDetectionCore,
} from '../utils/detection/pipeline';
import { dropCacheKey } from '../utils/detection/cache';
import { hashDataUrl } from '../utils/hash';

// Decoded image data is reused across requests for the same image: a room
// click and a perimeter trace on one floorplan used to decode, binarize and
// analyse it from scratch every time.
//
// Two entries, not one. One is right while a session works on a single image;
// with two plans open, alternating between them evicted the other every time,
// so every trace after a switch was a cold trace (~1130ms rather than ~130ms).
// Two is what makes flipping back and forth free, and the ceiling stays bounded
// because a decoded page is the largest thing this worker holds.
const MAX_DECODED = 2;

/** @type {Map<string, {imageData: ImageData, cacheKey: string}>} url -> decode */
const decoded = new Map();

/** Decodes already running, so two requests for one image decode once. */
const decoding = new Map();

// The memo key must be stable across every request for one image — that sharing
// is what makes N room clicks cost one trace — and distinct across images.
//
// It used to be `hash#${++decodeCount}`, minted fresh on every decode. That is
// stable only while an image is never re-decoded, which was true with a
// one-entry cache and one plan, and false the moment anything evicts: the same
// image would come back under a new key and miss the analysis memo entirely.
// Minted once per decode and kept *with* the entry, it is stable for as long as
// the entry lives, which is exactly as long as anything can refer to it.
let cacheKeySeq = 0;

const evictDecoded = () => {
  while (decoded.size > MAX_DECODED) {
    const oldestUrl = decoded.keys().next().value;
    const entry = decoded.get(oldestUrl);
    decoded.delete(oldestUrl);
    // Everything the detection memo holds under this key is now unreachable —
    // tens of MB of page-sized label arrays. Dropped by key rather than by
    // clearing the whole cache, which is what the old code did on every image
    // change and which threw away the other plan's work along with it.
    if (entry) dropCacheKey(entry.cacheKey);
  }
};

const imageBitmapToImageData = async (imageDataUrl) => {
  // Identity is the data URL itself, not its hash — same as the OCR memo, and
  // for the same reason. `hashDataUrl` folds an 8 KB prefix into 32 bits, so it
  // can hand two images one key, and the eraser and crop tools emit same-length
  // URLs from one canvas. Returning the previous image's pixels here would be a
  // wrong answer with nothing to look wrong about.
  const hit = decoded.get(imageDataUrl);
  if (hit) {
    // Refresh recency.
    decoded.delete(imageDataUrl);
    decoded.set(imageDataUrl, hit);
    return hit;
  }

  // `lastImageUrl` used to be assigned *after* these awaits, so two overlapping
  // requests for one image each decoded it, each cleared the cache and each
  // minted a key. Reachable via prewarmDetection racing the wall-snap request.
  const already = decoding.get(imageDataUrl);
  if (already) return already;

  const task = (async () => {
    const response = await fetch(imageDataUrl);
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const entry = { imageData, cacheKey: `${hashDataUrl(imageDataUrl)}#${++cacheKeySeq}` };
    decoded.set(imageDataUrl, entry);
    evictDecoded();
    return entry;
  })().finally(() => {
    decoding.delete(imageDataUrl);
  });

  decoding.set(imageDataUrl, task);
  return task;
};

/** Forget one image and everything the detection memo holds for it. */
const disposeImage = (imageDataUrl) => {
  const entry = decoded.get(imageDataUrl);
  if (!entry) return;
  decoded.delete(imageDataUrl);
  dropCacheKey(entry.cacheKey);
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

  // Picked up. The main thread arms its timeout before `postMessage`, so
  // without this the wait behind a long-running request is charged to whoever
  // is queued behind it — a second plan's trace could time out having executed
  // nothing at all.
  self.postMessage({ id, started: true });

  try {
    if (!payload?.image) {
      throw new Error('Detection worker requires an image data URL.');
    }

    if (type === 'disposeImage') {
      disposeImage(payload.image);
      self.postMessage({ id, ok: true, data: null });
      return;
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
