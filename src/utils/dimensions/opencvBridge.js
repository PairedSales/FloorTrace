/**
 * OpenCV.js bridge — lazy WASM load with a hard timeout, plus the two
 * preprocessing steps that are painful without it (CLAHE and selective
 * denoising). Every entry point degrades gracefully: callers get `null`
 * back and fall through to the pure-JS implementations in raster.js.
 */

let cvPromise = null;
let cvResolved = null;

export const loadOpenCv = (timeoutMs = 2000) => {
  if (!cvPromise) {
    cvPromise = (async () => {
      const mod = await import('@techstark/opencv-js');
      let cv = mod.default ?? mod;
      if (cv && typeof cv.then === 'function') cv = await cv;
      if (cv?.Mat) return cv;
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('OpenCV init timeout')), timeoutMs);
        cv.onRuntimeInitialized = () => {
          clearTimeout(timer);
          resolve();
        };
      });
      return cv?.Mat ? cv : null;
    })()
      .catch(() => null)
      .then((cv) => {
        cvResolved = cv;
        return cv;
      });
  }
  return cvPromise;
};

/** Peek without blocking. Returns cv object once loaded, else null. */
export const openCvIfReady = () => cvResolved;

/**
 * CLAHE + selective median denoise via OpenCV.
 * @param {{data:Uint8Array,width:number,height:number}} gray
 * @param {boolean} denoise apply 3×3 median (only worth it on noisy scans)
 * @returns enhanced gray image, or null on any OpenCV failure
 */
export const enhanceGrayWithCv = (cv, gray, { denoise = false } = {}) => {
  if (!cv) return null;
  let src = null;
  let equalized = null;
  let clahe = null;
  let denoised = null;
  try {
    src = cv.matFromArray(gray.height, gray.width, cv.CV_8UC1, gray.data);
    equalized = new cv.Mat();
    clahe = new cv.CLAHE(3.0, new cv.Size(8, 8));
    clahe.apply(src, equalized);

    let result = equalized;
    if (denoise) {
      denoised = new cv.Mat();
      cv.medianBlur(equalized, denoised, 3);
      result = denoised;
    }

    const out = new Uint8Array(result.data);
    return { data: out, width: gray.width, height: gray.height };
  } catch {
    return null;
  } finally {
    src?.delete();
    equalized?.delete();
    clahe?.delete();
    denoised?.delete();
  }
};

/**
 * Estimate speckle noise: fraction of ink pixels with no ink neighbours.
 * Sampled on a stride for speed; drives the selective-denoise decision.
 */
export const estimateSpeckle = (ink) => {
  const { data, width, height } = ink;
  let isolated = 0;
  let total = 0;
  for (let y = 1; y < height - 1; y += 2) {
    const row = y * width;
    for (let x = 1; x < width - 1; x += 2) {
      const i = row + x;
      if (!data[i]) continue;
      total++;
      if (!data[i - 1] && !data[i + 1] && !data[i - width] && !data[i + width]) {
        isolated++;
      }
    }
  }
  return total > 0 ? isolated / total : 0;
};
