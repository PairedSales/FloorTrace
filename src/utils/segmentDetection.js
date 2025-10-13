/**
 * segmentDetection.js
 * Line segment detection using OpenCV.js (Canny + Hough Transform)
 */

import { lineLength, lineAngle, normalizeLine } from './geometryUtils.js';

/**
 * Load OpenCV.js dynamically if not already loaded
 * @returns {Promise<Object>} OpenCV cv object
 */
export async function loadOpenCV() {
  if (window.cv && window.cv.Mat) {
    return window.cv;
  }
  
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://docs.opencv.org/4.8.0/opencv.js';
    script.async = true;
    
    script.onload = () => {
      // Wait for cv to be ready
      const checkCV = setInterval(() => {
        if (window.cv && window.cv.Mat) {
          clearInterval(checkCV);
          resolve(window.cv);
        }
      }, 100);
      
      // Timeout after 10 seconds
      setTimeout(() => {
        clearInterval(checkCV);
        reject(new Error('OpenCV loading timeout'));
      }, 10000);
    };
    
    script.onerror = () => reject(new Error('Failed to load OpenCV.js'));
    document.head.appendChild(script);
  });
}

/**
 * Convert Image/Canvas to OpenCV Mat
 * @param {HTMLImageElement|HTMLCanvasElement} source - Image or canvas element
 * @param {Object} cv - OpenCV object
 * @returns {Object} OpenCV Mat
 */
export function imageToMat(source, cv) {
  let canvas;
  
  if (source instanceof HTMLImageElement) {
    canvas = document.createElement('canvas');
    canvas.width = source.naturalWidth || source.width;
    canvas.height = source.naturalHeight || source.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(source, 0, 0);
  } else if (source instanceof HTMLCanvasElement) {
    canvas = source;
  } else {
    throw new Error('Source must be an Image or Canvas element');
  }
  
  return cv.imread(canvas);
}

/**
 * Detect line segments using Canny edge detection + Hough Transform
 * @param {Object} cv - OpenCV object
 * @param {Object} imageMat - OpenCV Mat of the image
 * @param {Object} options - Detection parameters
 * @param {number} options.cannyLow - Canny low threshold (default: 50)
 * @param {number} options.cannyHigh - Canny high threshold (default: 150)
 * @param {number} options.houghThreshold - Hough accumulator threshold (default: 50)
 * @param {number} options.minLineLength - Minimum line length in pixels (default: 30)
 * @param {number} options.maxLineGap - Maximum gap between line segments (default: 10)
 * @param {number} options.blurKernel - Gaussian blur kernel size (default: 5)
 * @param {number} options.minSegmentLength - Filter segments shorter than this (default: 15)
 * @returns {Array} Array of line segments with metadata
 */
export function detectSegments(cv, imageMat, options = {}) {
  const {
    cannyLow = 50,
    cannyHigh = 150,
    houghThreshold = 50,
    minLineLength = 30,
    maxLineGap = 10,
    blurKernel = 5,
    minSegmentLength = 15
  } = options;
  
  // Convert to grayscale
  const gray = new cv.Mat();
  if (imageMat.channels() === 4) {
    cv.cvtColor(imageMat, gray, cv.COLOR_RGBA2GRAY);
  } else if (imageMat.channels() === 3) {
    cv.cvtColor(imageMat, gray, cv.COLOR_RGB2GRAY);
  } else {
    imageMat.copyTo(gray);
  }
  
  // Apply Gaussian blur to reduce noise
  const blurred = new cv.Mat();
  const ksize = new cv.Size(blurKernel, blurKernel);
  cv.GaussianBlur(gray, blurred, ksize, 0, 0, cv.BORDER_DEFAULT);
  
  // Canny edge detection
  const edges = new cv.Mat();
  cv.Canny(blurred, edges, cannyLow, cannyHigh, 3, false);
  
  // Hough Line Transform (Probabilistic)
  const lines = new cv.Mat();
  cv.HoughLinesP(
    edges,
    lines,
    1,                           // rho resolution
    Math.PI / 180,               // theta resolution
    houghThreshold,              // accumulator threshold
    minLineLength,               // minimum line length
    maxLineGap                   // maximum gap between segments
  );
  
  // Extract segments
  const segments = [];
  for (let i = 0; i < lines.rows; i++) {
    const x1 = lines.data32S[i * 4];
    const y1 = lines.data32S[i * 4 + 1];
    const x2 = lines.data32S[i * 4 + 2];
    const y2 = lines.data32S[i * 4 + 3];
    
    const segment = { x1, y1, x2, y2 };
    const length = lineLength(segment);
    
    // Filter out very short segments
    if (length >= minSegmentLength) {
      const normalized = normalizeLine(segment);
      segments.push({
        ...normalized,
        length,
        angle: lineAngle(normalized),
        id: `seg_${i}`
      });
    }
  }
  
  // Clean up
  gray.delete();
  blurred.delete();
  edges.delete();
  lines.delete();
  
  return segments;
}

/**
 * Detect segments from an image source (convenience wrapper)
 * @param {HTMLImageElement|HTMLCanvasElement} source - Image or canvas
 * @param {Object} options - Detection options
 * @returns {Promise<Array>} Array of detected segments
 */
export async function detectSegmentsFromImage(source, options = {}) {
  const cv = await loadOpenCV();
  const mat = imageToMat(source, cv);
  const segments = detectSegments(cv, mat, options);
  mat.delete();
  return segments;
}

/**
 * Enhanced segment detection with adaptive thresholding
 * Runs detection multiple times with different parameters and merges results
 * @param {Object} cv - OpenCV object
 * @param {Object} imageMat - OpenCV Mat
 * @param {Object} options - Detection options
 * @returns {Array} Enhanced segment list
 */
export function detectSegmentsAdaptive(cv, imageMat, options = {}) {
  const segments = [];
  
  // Run with standard parameters
  const standard = detectSegments(cv, imageMat, options);
  segments.push(...standard);
  
  // Run with more sensitive parameters for fine details
  const sensitive = detectSegments(cv, imageMat, {
    ...options,
    cannyLow: 30,
    cannyHigh: 100,
    houghThreshold: 30,
    minLineLength: 20
  });
  segments.push(...sensitive);
  
  // Deduplicate similar segments
  return deduplicateSegments(segments);
}

/**
 * Remove duplicate or very similar segments
 * @param {Array} segments - Array of segments
 * @param {number} distanceThreshold - Max distance for duplicates (default: 3)
 * @param {number} angleThreshold - Max angle difference in degrees (default: 2)
 * @returns {Array} Deduplicated segments
 */
export function deduplicateSegments(segments, distanceThreshold = 3, angleThreshold = 2) {
  if (segments.length === 0) return [];
  
  const unique = [];
  const used = new Set();
  
  for (let i = 0; i < segments.length; i++) {
    if (used.has(i)) continue;
    
    const seg1 = segments[i];
    let isDuplicate = false;
    
    for (let j = 0; j < unique.length; j++) {
      const seg2 = unique[j];
      
      // Check if endpoints are very close
      const dx1 = Math.abs(seg1.x1 - seg2.x1);
      const dy1 = Math.abs(seg1.y1 - seg2.y1);
      const dx2 = Math.abs(seg1.x2 - seg2.x2);
      const dy2 = Math.abs(seg1.y2 - seg2.y2);
      
      const endpointsClose = (dx1 + dy1 + dx2 + dy2) < distanceThreshold * 4;
      
      // Check angle similarity
      const angleDiff = Math.abs(seg1.angle - seg2.angle) * (180 / Math.PI);
      const anglesClose = angleDiff < angleThreshold || angleDiff > (180 - angleThreshold);
      
      if (endpointsClose && anglesClose) {
        isDuplicate = true;
        used.add(i);
        break;
      }
    }
    
    if (!isDuplicate) {
      unique.push(seg1);
    }
  }
  
  return unique;
}

/**
 * Filter segments by orientation
 * @param {Array} segments - Array of segments
 * @param {string} orientation - "horizontal", "vertical", or "all"
 * @param {number} threshold - Angle threshold in degrees (default: 15)
 * @returns {Array} Filtered segments
 */
export function filterByOrientation(segments, orientation = "all", threshold = 15) {
  if (orientation === "all") return segments;
  
  return segments.filter(seg => {
    const angle = Math.abs(seg.angle * (180 / Math.PI)) % 180;
    
    if (orientation === "horizontal") {
      return angle < threshold || angle > (180 - threshold);
    } else if (orientation === "vertical") {
      return Math.abs(angle - 90) < threshold;
    }
    
    return true;
  });
}

/**
 * Get edge image for visualization
 * @param {Object} cv - OpenCV object
 * @param {Object} imageMat - OpenCV Mat
 * @param {number} cannyLow - Canny low threshold
 * @param {number} cannyHigh - Canny high threshold
 * @returns {HTMLCanvasElement} Canvas with edge visualization
 */
export function getEdgeCanvas(cv, imageMat, cannyLow = 50, cannyHigh = 150) {
  const gray = new cv.Mat();
  if (imageMat.channels() === 4) {
    cv.cvtColor(imageMat, gray, cv.COLOR_RGBA2GRAY);
  } else if (imageMat.channels() === 3) {
    cv.cvtColor(imageMat, gray, cv.COLOR_RGB2GRAY);
  } else {
    imageMat.copyTo(gray);
  }
  
  const edges = new cv.Mat();
  cv.Canny(gray, edges, cannyLow, cannyHigh);
  
  const canvas = document.createElement('canvas');
  cv.imshow(canvas, edges);
  
  gray.delete();
  edges.delete();
  
  return canvas;
}
