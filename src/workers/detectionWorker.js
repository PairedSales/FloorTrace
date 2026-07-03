import { detectRoomFromClickCore, traceFloorplanBoundaryCore } from '../utils/detection/pipeline';

const imageBitmapToImageData = async (imageDataUrl) => {
  const response = await fetch(imageDataUrl);
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  return context.getImageData(0, 0, canvas.width, canvas.height);
};

self.onmessage = async (event) => {
  const { id, type, payload } = event.data ?? {};
  if (!id || !type) return;

  try {
    if (!payload?.image) {
      throw new Error('Detection worker requires an image data URL.');
    }

    const imageData = await imageBitmapToImageData(payload.image);
    let data = null;

    if (type === 'detectRoomFromClick') {
      data = detectRoomFromClickCore(imageData, payload.clickPoint, payload.options);
    } else if (type === 'traceFloorplanBoundary') {
      data = traceFloorplanBoundaryCore(imageData, payload.options);
    } else {
      throw new Error(`Unsupported worker action: ${type}`);
    }

    if (data?.debug) {
      // Diagnostic data from the pipeline is only used internally/for tests;
      // strip it before posting back to avoid cloning large mask buffers.
      data.debug = null;
    }

    self.postMessage({ id, ok: true, data });
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown detection worker error',
    });
  }
};
