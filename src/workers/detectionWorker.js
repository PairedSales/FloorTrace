import { detectRoomFromClickCore, traceFloorplanBoundaryCore } from '../utils/detection/pipeline';
import { buildRoomDebugStages, buildBoundaryDebugStages } from '../utils/detection/debugManager';

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
      const isDebugEnabled = payload.options?.debugDetection === true;

      if (isDebugEnabled) {
        let stages = [];
        if (type === 'detectRoomFromClick') {
          stages = await buildRoomDebugStages(debug, maskToDataUrl);
        } else if (type === 'traceFloorplanBoundary') {
          stages = await buildBoundaryDebugStages(debug, maskToDataUrl);
        }
        
        data.debug = {
          stages,
          activeStageIndex: 0,
          selectedGeometryId: null,
          dominantAngles: debug.dominantAngles,
        };
      } else {
        // Negligible overhead when debugging is disabled
        data.debug = null;
      }
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
