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
export const generateClassicalLikelihoodMap = (binary, width, height) => {
  console.log('Generating classical wall likelihood map...');
  
  // DEBUG: Check binary image
  let wallPixels = 0;
  for (let i = 0; i < binary.length; i++) {
    if (binary[i] === 1) wallPixels++;
  }
  console.log(`DEBUG: Binary image - ${wallPixels}/${binary.length} wall pixels (${(100*wallPixels/binary.length).toFixed(1)}%)`);
  
  // Convert binary to float
  const baseLikelihood = new Float32Array(width * height);
  for (let i = 0; i < binary.length; i++) {
    baseLikelihood[i] = binary[i];
  }
  
  // Apply moderate gaussian blur to create gradient probabilities
  // This creates a soft falloff from walls (1.0) to background (0.0)
  const blurred = gaussianBlur(baseLikelihood, width, height, 1.5);
  
  // Enhance using gradient magnitude (edge strength)
  const likelihood = new Float32Array(width * height);
  
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      
      // Sobel gradient magnitude
      const gx = (
        -blurred[idx - width - 1] - 2 * blurred[idx - 1] - blurred[idx + width - 1] +
        blurred[idx - width + 1] + 2 * blurred[idx + 1] + blurred[idx + width + 1]
      ) / 8;
      
      const gy = (
        -blurred[idx - width - 1] - 2 * blurred[idx - width] - blurred[idx - width + 1] +
        blurred[idx + width - 1] + 2 * blurred[idx + width] + blurred[idx + width + 1]
      ) / 8;
      
      const gradMag = Math.sqrt(gx * gx + gy * gy);
      
      // Combine: base likelihood boosted by edge strength
      // Areas with high gradient = likely wall edges
      likelihood[idx] = Math.min(1.0, blurred[idx] * 0.7 + gradMag * 3.0);
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
 * Gaussian blur for smoothing
 */
const gaussianBlur = (data, width, height, sigma) => {
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
 * @param {Uint8Array} grayscale - Grayscale image
 * @param {number} width - Image width
 * @param {number} height - Image height
 * @returns {Promise<Float32Array>} Wall likelihood map
 */
export const segmentWalls = async (grayscale, width, height) => {
  // Convert grayscale to binary
  const binary = new Uint8Array(grayscale.length);
  for (let i = 0; i < grayscale.length; i++) {
    binary[i] = grayscale[i] < 128 ? 1 : 0;
  }
  
  // Generate likelihood map using classical method
  return generateClassicalLikelihoodMap(binary, width, height);
};
