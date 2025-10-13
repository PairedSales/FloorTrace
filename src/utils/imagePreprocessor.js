/**
 * Image Preprocessing Module
 * 
 * Advanced preprocessing pipeline for floor plan images including:
 * - Grayscale conversion
 * - Adaptive thresholding
 * - Morphological operations (erosion, dilation, opening, closing)
 * - Noise removal
 * - Line width normalization
 */

/**
 * Convert image data to grayscale
 * @param {ImageData} imageData - RGBA image data
 * @returns {Uint8Array} Grayscale image (1 channel)
 */
export const toGrayscale = (imageData) => {
  const { data, width, height } = imageData;
  const gray = new Uint8Array(width * height);
  
  for (let i = 0; i < data.length; i += 4) {
    // Use standard luminance weights
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    gray[i / 4] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  }
  
  return gray;
};

/**
 * Convert grayscale to binary with global threshold
 * @param {Uint8Array} gray - Grayscale image
 * @param {number} threshold - Threshold value (0-255)
 * @returns {Uint8Array} Binary image (0 or 1)
 */
export const globalThreshold = (gray, threshold = 128) => {
  const binary = new Uint8Array(gray.length);
  
  for (let i = 0; i < gray.length; i++) {
    binary[i] = gray[i] < threshold ? 1 : 0;
  }
  
  return binary;
};

/**
 * Adaptive thresholding using local window
 * Better for images with varying lighting/contrast
 * @param {Uint8Array} gray - Grayscale image
 * @param {number} width - Image width
 * @param {number} height - Image height
 * @param {Object} options - Thresholding options
 * @returns {Uint8Array} Binary image (0 or 1)
 */
export const adaptiveThreshold = (gray, width, height, options = {}) => {
  const {
    windowSize = 15,    // Size of local window (must be odd)
    c = 2,              // Constant subtracted from mean
    method = 'gaussian' // 'mean' or 'gaussian'
  } = options;
  
  const binary = new Uint8Array(width * height);
  const halfWindow = Math.floor(windowSize / 2);
  
  // Create Gaussian kernel if needed
  const kernel = method === 'gaussian' 
    ? createGaussianKernel(windowSize, windowSize / 6) 
    : null;
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      
      // Calculate local threshold
      let sum = 0;
      let count = 0;
      
      for (let wy = -halfWindow; wy <= halfWindow; wy++) {
        for (let wx = -halfWindow; wx <= halfWindow; wx++) {
          const nx = x + wx;
          const ny = y + wy;
          
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            const nIdx = ny * width + nx;
            const weight = kernel 
              ? kernel[(wy + halfWindow) * windowSize + (wx + halfWindow)]
              : 1;
            sum += gray[nIdx] * weight;
            count += weight;
          }
        }
      }
      
      const localThreshold = sum / count - c;
      binary[idx] = gray[idx] < localThreshold ? 1 : 0;
    }
  }
  
  return binary;
};

/**
 * Create 2D Gaussian kernel
 * @param {number} size - Kernel size
 * @param {number} sigma - Standard deviation
 * @returns {Float32Array} Gaussian kernel
 */
const createGaussianKernel = (size, sigma) => {
  const kernel = new Float32Array(size * size);
  const halfSize = Math.floor(size / 2);
  let sum = 0;
  
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - halfSize;
      const dy = y - halfSize;
      const value = Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
      kernel[y * size + x] = value;
      sum += value;
    }
  }
  
  // Normalize
  for (let i = 0; i < kernel.length; i++) {
    kernel[i] /= sum;
  }
  
  return kernel;
};

/**
 * Otsu's method for automatic threshold calculation
 * @param {Uint8Array} gray - Grayscale image
 * @returns {number} Optimal threshold value
 */
export const otsuThreshold = (gray) => {
  // Calculate histogram
  const histogram = new Array(256).fill(0);
  for (let i = 0; i < gray.length; i++) {
    histogram[gray[i]]++;
  }
  
  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) {
    sum += i * histogram[i];
  }
  
  let sumB = 0;
  let wB = 0;
  let wF = 0;
  let maxVariance = 0;
  let threshold = 0;
  
  for (let t = 0; t < 256; t++) {
    wB += histogram[t];
    if (wB === 0) continue;
    
    wF = total - wB;
    if (wF === 0) break;
    
    sumB += t * histogram[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    
    const variance = wB * wF * (mB - mF) * (mB - mF);
    
    if (variance > maxVariance) {
      maxVariance = variance;
      threshold = t;
    }
  }
  
  return threshold;
};

/**
 * Morphological erosion
 * Removes small noise and thin connections
 * @param {Uint8Array} binary - Binary image
 * @param {number} width - Image width
 * @param {number} height - Image height
 * @param {number} kernelSize - Kernel size (must be odd)
 * @returns {Uint8Array} Eroded image
 */
export const erode = (binary, width, height, kernelSize = 3) => {
  const result = new Uint8Array(width * height);
  const halfKernel = Math.floor(kernelSize / 2);
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      
      // Check if all pixels in kernel are 1
      let allSet = true;
      for (let ky = -halfKernel; ky <= halfKernel && allSet; ky++) {
        for (let kx = -halfKernel; kx <= halfKernel && allSet; kx++) {
          const nx = x + kx;
          const ny = y + ky;
          
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
            allSet = false;
          } else {
            const nIdx = ny * width + nx;
            if (binary[nIdx] === 0) {
              allSet = false;
            }
          }
        }
      }
      
      result[idx] = allSet ? 1 : 0;
    }
  }
  
  return result;
};

/**
 * Morphological dilation
 * Fills small holes and connects nearby segments
 * @param {Uint8Array} binary - Binary image
 * @param {number} width - Image width
 * @param {number} height - Image height
 * @param {number} kernelSize - Kernel size (must be odd)
 * @returns {Uint8Array} Dilated image
 */
export const dilate = (binary, width, height, kernelSize = 3) => {
  const result = new Uint8Array(width * height);
  const halfKernel = Math.floor(kernelSize / 2);
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      
      // Check if any pixel in kernel is 1
      let anySet = false;
      for (let ky = -halfKernel; ky <= halfKernel && !anySet; ky++) {
        for (let kx = -halfKernel; kx <= halfKernel && !anySet; kx++) {
          const nx = x + kx;
          const ny = y + ky;
          
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            const nIdx = ny * width + nx;
            if (binary[nIdx] === 1) {
              anySet = true;
            }
          }
        }
      }
      
      result[idx] = anySet ? 1 : 0;
    }
  }
  
  return result;
};

/**
 * Morphological opening (erosion followed by dilation)
 * Removes small objects and noise while preserving shape
 * @param {Uint8Array} binary - Binary image
 * @param {number} width - Image width
 * @param {number} height - Image height
 * @param {number} kernelSize - Kernel size
 * @returns {Uint8Array} Opened image
 */
export const opening = (binary, width, height, kernelSize = 3) => {
  const eroded = erode(binary, width, height, kernelSize);
  return dilate(eroded, width, height, kernelSize);
};

/**
 * Morphological closing (dilation followed by erosion)
 * Fills small holes and gaps while preserving shape
 * @param {Uint8Array} binary - Binary image
 * @param {number} width - Image width
 * @param {number} height - Image height
 * @param {number} kernelSize - Kernel size
 * @returns {Uint8Array} Closed image
 */
export const closing = (binary, width, height, kernelSize = 3) => {
  const dilated = dilate(binary, width, height, kernelSize);
  return erode(dilated, width, height, kernelSize);
};

/**
 * Remove small connected components (noise removal)
 * @param {Uint8Array} binary - Binary image
 * @param {number} width - Image width
 * @param {number} height - Image height
 * @param {number} minSize - Minimum component size to keep
 * @returns {Uint8Array} Cleaned image
 */
export const removeSmallComponents = (binary, width, height, minSize = 50) => {
  const visited = new Uint8Array(width * height);
  const result = new Uint8Array(width * height);
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      
      if (binary[idx] === 1 && visited[idx] === 0) {
        // Find component using flood fill
        const component = floodFill(binary, visited, width, height, x, y);
        
        // Keep component if large enough
        if (component.length >= minSize) {
          for (const pixel of component) {
            result[pixel] = 1;
          }
        }
      }
    }
  }
  
  return result;
};

/**
 * Flood fill to find connected component
 * @private
 */
const floodFill = (binary, visited, width, height, startX, startY) => {
  const component = [];
  const queue = [{ x: startX, y: startY }];
  const startIdx = startY * width + startX;
  visited[startIdx] = 1;
  
  while (queue.length > 0) {
    const { x, y } = queue.shift();
    const idx = y * width + x;
    component.push(idx);
    
    // Check 4-connected neighbors
    const neighbors = [
      { x: x + 1, y },
      { x: x - 1, y },
      { x, y: y + 1 },
      { x, y: y - 1 }
    ];
    
    for (const { x: nx, y: ny } of neighbors) {
      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        const nIdx = ny * width + nx;
        if (binary[nIdx] === 1 && visited[nIdx] === 0) {
          visited[nIdx] = 1;
          queue.push({ x: nx, y: ny });
        }
      }
    }
  }
  
  return component;
};

/**
 * Full preprocessing pipeline
 * @param {ImageData} imageData - Input image
 * @param {Object} options - Preprocessing options
 * @returns {Object} Preprocessed data
 */
export const preprocessImage = (imageData, options = {}) => {
  const {
    thresholdMethod = 'adaptive', // 'global', 'adaptive', or 'otsu'
    globalThresholdValue = 128,
    adaptiveWindowSize = 15,
    adaptiveC = 2,
    removeNoise = true,
    minComponentSize = 50,
    useClosing = true,
    closingKernelSize = 3
  } = options;
  
  const { width, height } = imageData;
  
  console.log('Preprocessing: Converting to grayscale...');
  const gray = toGrayscale(imageData);
  
  console.log(`Preprocessing: Thresholding (${thresholdMethod})...`);
  let binary;
  
  if (thresholdMethod === 'otsu') {
    const threshold = otsuThreshold(gray);
    console.log(`Preprocessing: Otsu threshold = ${threshold}`);
    binary = globalThreshold(gray, threshold);
  } else if (thresholdMethod === 'adaptive') {
    binary = adaptiveThreshold(gray, width, height, {
      windowSize: adaptiveWindowSize,
      c: adaptiveC
    });
  } else {
    binary = globalThreshold(gray, globalThresholdValue);
  }
  
  // Apply morphological closing to fill small gaps (doors/windows)
  if (useClosing) {
    console.log('Preprocessing: Applying morphological closing...');
    binary = closing(binary, width, height, closingKernelSize);
  }
  
  // Remove small noise components
  if (removeNoise) {
    console.log('Preprocessing: Removing small components...');
    binary = removeSmallComponents(binary, width, height, minComponentSize);
  }
  
  return {
    grayscale: gray,
    binary,
    width,
    height
  };
};
