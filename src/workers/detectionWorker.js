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

const maskToDataUrl = async (mask, width, height, type) => {
  if (!mask) return null;
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const imgData = ctx.createImageData(width, height);
  for (let i = 0; i < mask.length; i += 1) {
    const val = mask[i];
    const idx = i * 4;
    if (type === 'footprint') {
      imgData.data[idx] = val ? 99 : 255;
      imgData.data[idx + 1] = val ? 102 : 255;
      imgData.data[idx + 2] = val ? 241 : 255;
      imgData.data[idx + 3] = val ? 120 : 0;
    } else if (type === 'room') {
      imgData.data[idx] = val ? 16 : 255;
      imgData.data[idx + 1] = val ? 185 : 255;
      imgData.data[idx + 2] = val ? 129 : 255;
      imgData.data[idx + 3] = val ? 120 : 0;
    } else {
      const c = val ? 0 : 255;
      imgData.data[idx] = c;
      imgData.data[idx + 1] = c;
      imgData.data[idx + 2] = c;
      imgData.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(imgData, 0, 0);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
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
      const debug = data.debug;
      const w = debug.normalizedSize.width;
      const h = debug.normalizedSize.height;

      // Convert intermediate masks to base64 Data URLs asynchronously
      debug.thresholded = await maskToDataUrl(debug.thresholdedMask, w, h, 'thresholded');
      debug.filtered = await maskToDataUrl(debug.filteredMask, w, h, 'filtered');
      debug.closed = await maskToDataUrl(debug.closedMask, w, h, 'closed');
      debug.footprint = await maskToDataUrl(debug.footprintMask, w, h, 'footprint');
      debug.floodFilled = await maskToDataUrl(debug.roomMask, w, h, 'room');

      // Expose the final polygon inside debug
      debug.finalPolygon = data.polygon ?? (data.outer?.polygon ?? null);

      // Delete raw arrays to avoid cloning overhead
      delete debug.thresholdedMask;
      delete debug.filteredMask;
      delete debug.closedMask;
      delete debug.footprintMask;
      delete debug.roomMask;
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
