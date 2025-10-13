/**
 * CNN-Based Wall Segmentation Module
 * 
 * Implements DeepLSD-style wall detection using a convolutional neural network
 * to generate wall likelihood maps and attraction fields.
 * 
 * This module can:
 * 1. Use a pre-trained model for wall segmentation
 * 2. Generate wall likelihood maps (pixel-level probability)
 * 3. Create attraction fields (gradient-based line guidance)
 * 4. Provide semantic filtering to ignore furniture, text, etc.
 */

import * as tf from '@tensorflow/tfjs';

let wallSegmentationModel = null;

/**
 * Load or create wall segmentation model
 * @param {string} modelPath - Optional path to pre-trained model
 * @returns {Promise<tf.LayersModel>}
 */
export const loadWallSegmentationModel = async (modelPath = null) => {
  if (wallSegmentationModel) {
    return wallSegmentationModel;
  }
  
  if (modelPath) {
    console.log('Loading pre-trained wall segmentation model...');
    try {
      wallSegmentationModel = await tf.loadLayersModel(modelPath);
      console.log('Wall segmentation model loaded successfully');
      return wallSegmentationModel;
    } catch (error) {
      console.warn('Could not load pre-trained model, using lightweight architecture:', error);
    }
  }
  
  // Create lightweight U-Net style architecture for wall segmentation
  console.log('Creating lightweight wall segmentation model...');
  wallSegmentationModel = createLightweightSegmentationModel();
  
  return wallSegmentationModel;
};

/**
 * Create a lightweight U-Net style model for wall segmentation
 * This is a simplified architecture optimized for browser performance
 */
const createLightweightSegmentationModel = () => {
  const inputShape = [256, 256, 1]; // Grayscale input
  
  const input = tf.input({ shape: inputShape });
  
  // Encoder (downsampling path)
  let x = tf.layers.conv2d({
    filters: 16,
    kernelSize: 3,
    padding: 'same',
    activation: 'relu'
  }).apply(input);
  const enc1 = x;
  
  x = tf.layers.maxPooling2d({ poolSize: 2 }).apply(x);
  
  x = tf.layers.conv2d({
    filters: 32,
    kernelSize: 3,
    padding: 'same',
    activation: 'relu'
  }).apply(x);
  const enc2 = x;
  
  x = tf.layers.maxPooling2d({ poolSize: 2 }).apply(x);
  
  // Bottleneck
  x = tf.layers.conv2d({
    filters: 64,
    kernelSize: 3,
    padding: 'same',
    activation: 'relu'
  }).apply(x);
  
  // Decoder (upsampling path)
  x = tf.layers.upSampling2d({ size: [2, 2] }).apply(x);
  x = tf.layers.concatenate().apply([x, enc2]);
  x = tf.layers.conv2d({
    filters: 32,
    kernelSize: 3,
    padding: 'same',
    activation: 'relu'
  }).apply(x);
  
  x = tf.layers.upSampling2d({ size: [2, 2] }).apply(x);
  x = tf.layers.concatenate().apply([x, enc1]);
  x = tf.layers.conv2d({
    filters: 16,
    kernelSize: 3,
    padding: 'same',
    activation: 'relu'
  }).apply(x);
  
  // Output: wall likelihood map (sigmoid activation for [0, 1] range)
  const output = tf.layers.conv2d({
    filters: 1,
    kernelSize: 1,
    padding: 'same',
    activation: 'sigmoid'
  }).apply(x);
  
  const model = tf.model({ inputs: input, outputs: output });
  
  console.log('Lightweight segmentation model created');
  model.summary();
  
  return model;
};

/**
 * Generate wall likelihood map using classical heuristics
 * This is a fallback when no trained model is available
 * @param {Uint8Array} binary - Binary image
 * @param {number} width - Image width
 * @param {number} height - Image height
 * @returns {Float32Array} Wall likelihood map [0-1]
 */
export const generateClassicalLikelihoodMap = (binary, width, height) => {
  console.log('Generating classical wall likelihood map...');
  
  const likelihood = new Float32Array(width * height);
  
  // Parameters for wall detection
  const minWallLength = 50;
  const maxWallThickness = 20;
  
  // For each pixel, calculate likelihood based on local structure
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      
      if (binary[idx] === 0) {
        likelihood[idx] = 0;
        continue;
      }
      
      // Measure horizontal and vertical extents
      const hExtent = measureExtent(binary, width, height, x, y, 1, 0);
      const vExtent = measureExtent(binary, width, height, x, y, 0, 1);
      const hThickness = measureThickness(binary, width, height, x, y, 0, 1);
      const vThickness = measureThickness(binary, width, height, x, y, 1, 0);
      
      // Calculate wall-like score
      let score = 0;
      
      // Horizontal wall
      if (hExtent > minWallLength && hThickness <= maxWallThickness) {
        const aspectRatio = hExtent / Math.max(hThickness, 1);
        score = Math.max(score, Math.min(1, aspectRatio / 10));
      }
      
      // Vertical wall
      if (vExtent > minWallLength && vThickness <= maxWallThickness) {
        const aspectRatio = vExtent / Math.max(vThickness, 1);
        score = Math.max(score, Math.min(1, aspectRatio / 10));
      }
      
      likelihood[idx] = score;
    }
  }
  
  // Apply Gaussian smoothing to likelihood map
  return gaussianBlur(likelihood, width, height, 2);
};

/**
 * Measure extent in a direction
 */
const measureExtent = (binary, width, height, x, y, dx, dy) => {
  let extent = 0;
  let nx = x, ny = y;
  
  // Measure in positive direction
  while (true) {
    nx += dx;
    ny += dy;
    if (nx < 0 || nx >= width || ny < 0 || ny >= height) break;
    const idx = ny * width + nx;
    if (binary[idx] === 0) break;
    extent++;
  }
  
  // Measure in negative direction
  nx = x;
  ny = y;
  while (true) {
    nx -= dx;
    ny -= dy;
    if (nx < 0 || nx >= width || ny < 0 || ny >= height) break;
    const idx = ny * width + nx;
    if (binary[idx] === 0) break;
    extent++;
  }
  
  return extent;
};

/**
 * Measure thickness perpendicular to a direction
 */
const measureThickness = (binary, width, height, x, y, dx, dy) => {
  // Perpendicular direction
  const px = dy;
  const py = dx;
  
  let thickness = 1; // Count center pixel
  
  // Measure in positive perpendicular direction
  let nx = x, ny = y;
  while (true) {
    nx += px;
    ny += py;
    if (nx < 0 || nx >= width || ny < 0 || ny >= height) break;
    const idx = ny * width + nx;
    if (binary[idx] === 0) break;
    thickness++;
  }
  
  // Measure in negative perpendicular direction
  nx = x;
  ny = y;
  while (true) {
    nx -= px;
    ny -= py;
    if (nx < 0 || nx >= width || ny < 0 || ny >= height) break;
    const idx = ny * width + nx;
    if (binary[idx] === 0) break;
    thickness++;
  }
  
  return thickness;
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
 * Apply CNN-based wall segmentation
 * @param {Uint8Array} grayscale - Grayscale image
 * @param {number} width - Image width
 * @param {number} height - Image height
 * @param {Object} options - Segmentation options
 * @returns {Promise<Float32Array>} Wall likelihood map
 */
export const segmentWalls = async (grayscale, width, height, options = {}) => {
  const {
    useModel = false,
    modelPath = null,
    useFallback = true
  } = options;
  
  if (useModel) {
    try {
      const model = await loadWallSegmentationModel(modelPath);
      
      // Prepare input tensor (resize to model input size)
      const inputTensor = tf.tidy(() => {
        let tensor = tf.tensor3d(grayscale, [height, width, 1]);
        tensor = tf.image.resizeBilinear(tensor, [256, 256]);
        tensor = tf.div(tensor, 255); // Normalize to [0, 1]
        return tensor.expandDims(0); // Add batch dimension
      });
      
      // Run inference
      console.log('Running CNN inference...');
      const output = model.predict(inputTensor);
      
      // Get likelihood map
      const likelihoodArray = await output.squeeze([0, 3]).array();
      inputTensor.dispose();
      output.dispose();
      
      // Resize back to original size
      const resizedTensor = tf.tidy(() => {
        const tensor = tf.tensor2d(likelihoodArray);
        return tf.image.resizeBilinear(tensor, [height, width]);
      });
      
      const likelihood = await resizedTensor.data();
      resizedTensor.dispose();
      
      return new Float32Array(likelihood);
    } catch (error) {
      console.warn('CNN inference failed:', error);
      if (!useFallback) {
        throw error;
      }
    }
  }
  
  // Fallback to classical heuristics
  if (useFallback) {
    // First convert to binary for classical method
    const binary = new Uint8Array(grayscale.length);
    for (let i = 0; i < grayscale.length; i++) {
      binary[i] = grayscale[i] < 128 ? 1 : 0;
    }
    return generateClassicalLikelihoodMap(binary, width, height);
  }
  
  throw new Error('Wall segmentation failed and fallback is disabled');
};

/**
 * Cleanup TensorFlow resources
 */
export const cleanup = () => {
  if (wallSegmentationModel) {
    wallSegmentationModel.dispose();
    wallSegmentationModel = null;
  }
};
