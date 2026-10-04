/**
 * The scan run on the page's own thread — how every scan ran before
 * `workers/ocrWorker.js`, and still the way one runs where that worker cannot
 * (see `ocrHost.js`). Loaded on demand: a browser that has the worker never
 * fetches this graph.
 *
 * Same pipeline, same inputs. What differs is only who is kept waiting — here
 * the page is, for 1.3-1.8 s of image work a plan.
 */

import { dataUrlToImage } from '../imageLoader.js';
import { detectDimensionsCore } from './pipeline.js';
import { grayToPngBlob } from './pngEncode.js';

export { loadOpenCv } from './opencvBridge.js';
export {
  configureTesseract, warmOcrEngine, releaseOcrWorkersWhenIdle, terminateOcrWorker,
} from './ocrTesseract.js';

/**
 * @param {string} imageDataUrl
 * @param {{paddleReady: () => boolean, refineRois: (tiles: Array) => Promise<Array>}} paddle
 */
export const scanOnPage = async (imageDataUrl, paddle) => {
  const img = await dataUrlToImage(imageDataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

  return detectDimensionsCore(imageData, { toOcrInput: grayToPngBlob, ...paddle });
};
