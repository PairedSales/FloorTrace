/**
 * Classical Wall Segmentation Module
 * 
 * Generates wall likelihood maps using classical image processing techniques.
 * Converts preprocessed binary images to likelihood maps for line detection.
 */

/**
 * Generate wall likelihood map using classical heuristics
 * @param {Uint8Array} binary - Binary image (1 = wall, 0 = background)
 * @param {number} width - Image width
 * @param {number} height - Image height
 * @returns {Float32Array} Wall likelihood map [0-1]
 */
export const generateClassicalLikelihoodMap = (binaryData, width, height) => {
  console.log('Generating classical wall likelihood map...');
  
  // Extract both binary versions if available
  const binary = binaryData.binary || binaryData;
  const originalBinary = binaryData.originalBinary || binary;
  
  // DEBUG: Check binary image
  let wallPixels = 0;
  for (let i = 0; i < binary.length; i++) {
    if (binary[i] === 1) wallPixels++;
  }
  console.log(`DEBUG: Binary image - ${wallPixels}/${binary.length} wall pixels (${(100*wallPixels/binary.length).toFixed(1)}%)`);
  
  // Strategy: Floor plan walls are DOUBLE LINES (two parallel lines)
  // We need to detect BOTH lines, not the filled region between them
  // Use originalBinary to find the actual drawn lines before morphological closing filled them
  
  // Calculate distance transform on FILLED binary to understand wall thickness
  const distanceTransform = computeDistanceTransform(binary, width, height);
  
  // Calculate gradients on ORIGINAL binary to find the actual drawn lines
  const likelihood = new Float32Array(width * height);
  
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      
      // Gradient on ORIGINAL binary (detects actual drawn lines, not filled regions)
      const gx = (
        -originalBinary[(y - 1) * width + (x - 1)] - 2 * originalBinary[y * width + (x - 1)] - originalBinary[(y + 1) * width + (x - 1)] +
        originalBinary[(y - 1) * width + (x + 1)] + 2 * originalBinary[y * width + (x + 1)] + originalBinary[(y + 1) * width + (x + 1)]
      ) / 8;
      
      const gy = (
        -originalBinary[(y - 1) * width + (x - 1)] - 2 * originalBinary[(y - 1) * width + x] - originalBinary[(y - 1) * width + (x + 1)] +
        originalBinary[(y + 1) * width + (x - 1)] + 2 * originalBinary[(y + 1) * width + x] + originalBinary[(y + 1) * width + (x + 1)]
      ) / 8;
      
      const gradMag = Math.sqrt(gx * gx + gy * gy);
      
      // Check if pixel is on an actual drawn line (in original binary)
      const isOnLine = originalBinary[idx] === 1;
      
      // Check if pixel is inside a thick wall region (from filled binary)
      const isInWallRegion = binary[idx] === 1;
      const wallThickness = distanceTransform[idx];
      
      // Three cases:
      // 1. On an actual drawn line → HIGH likelihood (this is a wall boundary)
      // 2. Inside thick wall region but not on line → MEDIUM likelihood (between double lines)
      // 3. Outside wall regions → use gradient to detect nearby boundaries
      
      if (isOnLine) {
        // CASE 1: Actual drawn line - this is what we want to detect!
        likelihood[idx] = 1.0;
      } else if (isInWallRegion) {
        // CASE 2: Inside wall region (between double lines) - medium priority
        // Boost if we're far from edges (thick wall interior)
        likelihood[idx] = wallThickness > 3 ? 0.6 : 0.4;
      } else {
        // CASE 3: Background - use gradient to find nearby boundaries
        likelihood[idx] = gradMag > 0.2 ? (gradMag * 0.5) : 0;
      }
    }
  }
  
  // Calculate statistics
  let nonZero = 0;
  let maxVal = 0;
  let minVal = 1;
  for (let i = 0; i < likelihood.length; i++) {
    if (likelihood[i] > 0.01) nonZero++;
    if (likelihood[i] > maxVal) maxVal = likelihood[i];
    if (likelihood[i] < minVal && likelihood[i] > 0) minVal = likelihood[i];
  }
  
  console.log(`DEBUG: Likelihood map - ${nonZero}/${likelihood.length} nonzero pixels`);
  console.log(`DEBUG: Value range: [${minVal.toFixed(3)}, ${maxVal.toFixed(3)}]`);
  
  return likelihood;
};

/**
 * Compute distance transform using chamfer distance
 * Returns distance from each wall pixel to nearest background pixel
 * Higher values = centerline of thick walls
 */
const computeDistanceTransform = (binary, width, height) => {
  const dist = new Float32Array(width * height);
  const INF = 9999;
  
  // Initialize distances
  for (let i = 0; i < binary.length; i++) {
    dist[i] = binary[i] === 1 ? INF : 0;
  }
  
  // Forward pass (top-left to bottom-right)
  for (let y = 1; y < height; y++) {
    for (let x = 1; x < width; x++) {
      const idx = y * width + x;
      if (binary[idx] === 1) {
        const d = Math.min(
          dist[idx],
          dist[idx - 1] + 1,           // left
          dist[idx - width] + 1,       // top
          dist[idx - width - 1] + 1.4, // top-left diagonal
          dist[idx - width + 1] + 1.4  // top-right diagonal
        );
        dist[idx] = d;
      }
    }
  }
  
  // Backward pass (bottom-right to top-left)
  for (let y = height - 2; y >= 0; y--) {
    for (let x = width - 2; x >= 0; x--) {
      const idx = y * width + x;
      if (binary[idx] === 1) {
        const d = Math.min(
          dist[idx],
          dist[idx + 1] + 1,           // right
          dist[idx + width] + 1,       // bottom
          dist[idx + width + 1] + 1.4, // bottom-right diagonal
          dist[idx + width - 1] + 1.4  // bottom-left diagonal
        );
        dist[idx] = d;
      }
    }
  }
  
  return dist;
};

/**
 * Gaussian blur for smoothing
 */
const _gaussianBlur = (data, width, height, sigma) => {
  const kernelSize = Math.ceil(sigma * 3) * 2 + 1;
  const halfSize = Math.floor(kernelSize / 2);
  
  // Create Gaussian kernel
  const kernel = new Float32Array(kernelSize * kernelSize);
  let sum = 0;
  for (let y = 0; y < kernelSize; y++) {
    for (let x = 0; x < kernelSize; x++) {
      const dx = x - halfSize;
      const dy = y - halfSize;
      const value = Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
      kernel[y * kernelSize + x] = value;
      sum += value;
    }
  }
  
  // Normalize kernel
  for (let i = 0; i < kernel.length; i++) {
    kernel[i] /= sum;
  }
  
  // Apply convolution
  const result = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      let sum = 0;
      
      for (let ky = 0; ky < kernelSize; ky++) {
        for (let kx = 0; kx < kernelSize; kx++) {
          const nx = x + kx - halfSize;
          const ny = y + ky - halfSize;
          
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            const nIdx = ny * width + nx;
            sum += data[nIdx] * kernel[ky * kernelSize + kx];
          }
        }
      }
      
      result[idx] = sum;
    }
  }
  
  return result;
};

/**
 * Generate attraction field (gradient field pointing towards wall centerlines)
 * @param {Float32Array} likelihood - Wall likelihood map
 * @param {number} width - Image width
 * @param {number} height - Image height
 * @returns {Object} Attraction field {dx, dy}
 */
export const generateAttractionField = (likelihood, width, height) => {
  console.log('Generating attraction field...');
  
  const dx = new Float32Array(width * height);
  const dy = new Float32Array(width * height);
  
  // Compute gradient of likelihood map
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      
      // Sobel operators for gradient
      const gx = (
        -likelihood[idx - width - 1] - 2 * likelihood[idx - 1] - likelihood[idx + width - 1] +
        likelihood[idx - width + 1] + 2 * likelihood[idx + 1] + likelihood[idx + width + 1]
      ) / 8;
      
      const gy = (
        -likelihood[idx - width - 1] - 2 * likelihood[idx - width] - likelihood[idx - width + 1] +
        likelihood[idx + width - 1] + 2 * likelihood[idx + width] + likelihood[idx + width + 1]
      ) / 8;
      
      dx[idx] = gx;
      dy[idx] = gy;
    }
  }
  
  return { dx, dy };
};

/**
 * Generate wall segmentation using classical image processing
 * @param {Object|Uint8Array} preprocessedOrGrayscale - Preprocessed data object OR grayscale image
 * @param {number} width - Image width
 * @param {number} height - Image height
 * @returns {Promise<Float32Array>} Wall likelihood map
 */
export const segmentWalls = async (preprocessedOrGrayscale, width, height) => {
  // Handle both old API (grayscale) and new API (preprocessed object)
  let binaryData;
  
  if (preprocessedOrGrayscale.binary && preprocessedOrGrayscale.originalBinary) {
    // New API: preprocessed object with both binary versions
    binaryData = preprocessedOrGrayscale;
  } else {
    // Old API: grayscale image - convert to binary
    const grayscale = preprocessedOrGrayscale;
    const binary = new Uint8Array(grayscale.length);
    for (let i = 0; i < grayscale.length; i++) {
      binary[i] = grayscale[i] < 128 ? 1 : 0;
    }
    binaryData = { binary, originalBinary: binary };
  }
  
  // Generate likelihood map using classical method
  return generateClassicalLikelihoodMap(binaryData, width, height);
};
