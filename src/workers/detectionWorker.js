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

const generateScreenshot = async (mask, width, height, type, geometries = []) => {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  
  if (mask) {
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
      } else if (type === 'filtered') {
        const c = val ? 180 : 255;
        imgData.data[idx] = c;
        imgData.data[idx + 1] = c;
        imgData.data[idx + 2] = c;
        imgData.data[idx + 3] = 255;
      } else {
        const c = val ? 0 : 255;
        imgData.data[idx] = c;
        imgData.data[idx + 1] = c;
        imgData.data[idx + 2] = c;
        imgData.data[idx + 3] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0);
  } else {
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);
  }

  // Draw geometries on top
  const COLOR_MAP = {
    interior: '#06B6D4',  // Cyan
    exterior: '#6366F1',  // Indigo
    rejected: '#EF4444',  // Red
    temporary: '#64748B', // Slate
    final: '#10B981',     // Emerald
  };

  for (const geom of geometries) {
    if (geom.type === 'polygon' && geom.points?.length >= 3) {
      ctx.beginPath();
      ctx.moveTo(geom.points[0].x, geom.points[0].y);
      for (let i = 1; i < geom.points.length; i++) {
        ctx.lineTo(geom.points[i].x, geom.points[i].y);
      }
      ctx.closePath();
      ctx.strokeStyle = COLOR_MAP[geom.class] ?? '#000000';
      ctx.lineWidth = geom.class === 'final' ? 3.5 : 2.0;
      if (geom.class === 'rejected' || geom.class === 'interior') {
        ctx.setLineDash([4, 4]);
      } else {
        ctx.setLineDash([]);
      }
      ctx.stroke();
    } else if (geom.type === 'line') {
      ctx.beginPath();
      ctx.moveTo(geom.start.x, geom.start.y);
      ctx.lineTo(geom.end.x, geom.end.y);
      ctx.strokeStyle = COLOR_MAP[geom.class] ?? '#000000';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([]);
      ctx.stroke();
    } else if (geom.type === 'point') {
      ctx.beginPath();
      ctx.arc(geom.x, geom.y, 4, 0, 2 * Math.PI);
      ctx.fillStyle = COLOR_MAP[geom.class] ?? '#000000';
      ctx.fill();
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 1.0;
      ctx.stroke();
    }
  }

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
          stages = await buildRoomDebugStages(debug, generateScreenshot);
        } else if (type === 'traceFloorplanBoundary') {
          stages = await buildBoundaryDebugStages(debug, generateScreenshot);
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
