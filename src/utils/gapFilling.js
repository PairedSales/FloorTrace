/**
 * Gap Filling and Bridging Module
 * 
 * Handles gaps in walls caused by:
 * - Door openings
 * - Window openings
 * - Symbol gaps
 * - Worn/faded lines
 * 
 * Implements various gap bridging strategies
 */

import { LineSegment } from './lineRefinement.js';

/**
 * Fill gaps in line segments
 * @param {Array<LineSegment>} segments - Input line segments
 * @param {Object} options - Gap filling options
 * @returns {Array<LineSegment>} Segments with gaps filled
 */
export const fillGapsInSegments = (segments, options = {}) => {
  const {
    maxGapLength = 100,
    alignmentTolerance = 10,
    angleTolerance = 0.1
  } = options;
  
  console.log('Filling gaps in line segments...');
  
  // Separate by orientation
  const horizontal = segments.filter(s => s.isHorizontal(angleTolerance));
  const vertical = segments.filter(s => s.isVertical(angleTolerance));
  
  // Fill gaps within each orientation
  const filledHorizontal = fillGapsInGroup(horizontal, true, maxGapLength, alignmentTolerance);
  const filledVertical = fillGapsInGroup(vertical, false, maxGapLength, alignmentTolerance);
  
  const result = [...filledHorizontal, ...filledVertical];
  
  console.log(`Gap filling: ${segments.length} -> ${result.length} segments`);
  
  return result;
};

/**
 * Fill gaps within a group of aligned segments
 */
const fillGapsInGroup = (segments, isHorizontal, maxGapLength, alignmentTolerance) => {
  if (segments.length === 0) return [];
  
  const result = [];
  const used = new Set();
  
  // Sort segments
  if (isHorizontal) {
    segments.sort((a, b) => a.centerY - b.centerY || a.x1 - b.x1);
  } else {
    segments.sort((a, b) => a.centerX - b.centerX || a.y1 - b.y1);
  }
  
  for (let i = 0; i < segments.length; i++) {
    if (used.has(i)) continue;
    
    const current = segments[i];
    const chain = [current];
    used.add(i);
    
    // Find segments that can be connected
    let changed = true;
    while (changed) {
      changed = false;
      
      for (let j = 0; j < segments.length; j++) {
        if (used.has(j)) continue;
        
        const candidate = segments[j];
        
        // Check if candidate can connect to any segment in chain
        for (const chainSeg of chain) {
          if (canConnect(chainSeg, candidate, isHorizontal, maxGapLength, alignmentTolerance)) {
            chain.push(candidate);
            used.add(j);
            changed = true;
            break;
          }
        }
      }
    }
    
    // Merge chain into single segment
    if (chain.length === 1) {
      result.push(chain[0]);
    } else {
      result.push(mergeSegmentChain(chain, isHorizontal));
    }
  }
  
  return result;
};

/**
 * Check if two segments can be connected
 */
const canConnect = (seg1, seg2, isHorizontal, maxGapLength, alignmentTolerance) => {
  if (isHorizontal) {
    // Check vertical alignment
    if (Math.abs(seg1.centerY - seg2.centerY) > alignmentTolerance) {
      return false;
    }
    
    // Check gap length
    const gap = Math.min(
      Math.abs(seg2.x1 - seg1.x2),
      Math.abs(seg2.x2 - seg1.x1),
      Math.abs(seg1.x1 - seg2.x2),
      Math.abs(seg1.x2 - seg2.x1)
    );
    
    return gap <= maxGapLength;
  } else {
    // Check horizontal alignment
    if (Math.abs(seg1.centerX - seg2.centerX) > alignmentTolerance) {
      return false;
    }
    
    // Check gap length
    const gap = Math.min(
      Math.abs(seg2.y1 - seg1.y2),
      Math.abs(seg2.y2 - seg1.y1),
      Math.abs(seg1.y1 - seg2.y2),
      Math.abs(seg1.y2 - seg2.y1)
    );
    
    return gap <= maxGapLength;
  }
};

/**
 * Merge a chain of segments
 */
const mergeSegmentChain = (chain, isHorizontal) => {
  if (isHorizontal) {
    const minX = Math.min(...chain.map(s => Math.min(s.x1, s.x2)));
    const maxX = Math.max(...chain.map(s => Math.max(s.x1, s.x2)));
    const avgY = chain.reduce((sum, s) => sum + s.centerY, 0) / chain.length;
    const avgScore = chain.reduce((sum, s) => sum + s.score, 0) / chain.length;
    
    return new LineSegment(minX, avgY, maxX, avgY, avgScore);
  } else {
    const minY = Math.min(...chain.map(s => Math.min(s.y1, s.y2)));
    const maxY = Math.max(...chain.map(s => Math.max(s.y1, s.y2)));
    const avgX = chain.reduce((sum, s) => sum + s.centerX, 0) / chain.length;
    const avgScore = chain.reduce((sum, s) => sum + s.score, 0) / chain.length;
    
    return new LineSegment(avgX, minY, avgX, maxY, avgScore);
  }
};

/**
 * Morphological closing on binary image to bridge small gaps
 * @param {Uint8Array} binary - Binary image
 * @param {number} width - Image width
 * @param {number} height - Image height
 * @param {Object} options - Closing options
 * @returns {Uint8Array} Image with gaps filled
 */
export const morphologicalGapBridging = (binary, width, height, options = {}) => {
  const {
    horizontalKernel = 15,
    verticalKernel = 15
  } = options;
  
  console.log('Applying morphological gap bridging...');
  
  // Apply horizontal closing
  let result = horizontalClosing(binary, width, height, horizontalKernel);
  
  // Apply vertical closing
  result = verticalClosing(result, width, height, verticalKernel);
  
  return result;
};

/**
 * Horizontal morphological closing
 */
const horizontalClosing = (binary, width, height, kernelSize) => {
  // Dilate horizontally
  let temp = new Uint8Array(width * height);
  const halfKernel = Math.floor(kernelSize / 2);
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      let hasPixel = false;
      
      for (let kx = -halfKernel; kx <= halfKernel; kx++) {
        const nx = x + kx;
        if (nx >= 0 && nx < width) {
          if (binary[y * width + nx] === 1) {
            hasPixel = true;
            break;
          }
        }
      }
      
      temp[idx] = hasPixel ? 1 : 0;
    }
  }
  
  // Erode horizontally
  const result = new Uint8Array(width * height);
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      let allPixels = true;
      
      for (let kx = -halfKernel; kx <= halfKernel; kx++) {
        const nx = x + kx;
        if (nx >= 0 && nx < width) {
          if (temp[y * width + nx] === 0) {
            allPixels = false;
            break;
          }
        }
      }
      
      result[idx] = allPixels ? 1 : 0;
    }
  }
  
  return result;
};

/**
 * Vertical morphological closing
 */
const verticalClosing = (binary, width, height, kernelSize) => {
  // Dilate vertically
  let temp = new Uint8Array(width * height);
  const halfKernel = Math.floor(kernelSize / 2);
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      let hasPixel = false;
      
      for (let ky = -halfKernel; ky <= halfKernel; ky++) {
        const ny = y + ky;
        if (ny >= 0 && ny < height) {
          if (binary[ny * width + x] === 1) {
            hasPixel = true;
            break;
          }
        }
      }
      
      temp[idx] = hasPixel ? 1 : 0;
    }
  }
  
  // Erode vertically
  const result = new Uint8Array(width * height);
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      let allPixels = true;
      
      for (let ky = -halfKernel; ky <= halfKernel; ky++) {
        const ny = y + ky;
        if (ny >= 0 && ny < height) {
          if (temp[ny * width + x] === 0) {
            allPixels = false;
            break;
          }
        }
      }
      
      result[idx] = allPixels ? 1 : 0;
    }
  }
  
  return result;
};

/**
 * Intelligent gap filling using context
 * Analyzes surrounding walls to determine if gap should be filled
 * @param {Array<LineSegment>} segments - Line segments
 * @param {number} width - Image width
 * @param {number} height - Image height
 * @returns {Array<LineSegment>} Segments with intelligent gap filling
 */
export const intelligentGapFilling = (segments, width, height) => {
  console.log('Applying intelligent gap filling...');
  
  const result = [...segments];
  const maxDoorWidth = 80; // Typical door width in pixels
  const maxWindowGap = 60;
  
  // Find potential gaps
  const gaps = findPotentialGaps(segments, maxDoorWidth);
  
  console.log(`Found ${gaps.length} potential gaps`);
  
  // Analyze each gap
  for (const gap of gaps) {
    if (shouldFillGap(gap, segments, maxWindowGap)) {
      // Create bridging segment
      const bridge = createBridgeSegment(gap);
      result.push(bridge);
    }
  }
  
  return result;
};

/**
 * Find potential gaps between segments
 */
const findPotentialGaps = (segments, maxGapSize) => {
  const gaps = [];
  
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      const seg1 = segments[i];
      const seg2 = segments[j];
      
      // Check if segments are aligned and close
      const gap = analyzeGap(seg1, seg2);
      
      if (gap && gap.size <= maxGapSize) {
        gaps.push({ seg1, seg2, ...gap });
      }
    }
  }
  
  return gaps;
};

/**
 * Analyze gap between two segments
 */
const analyzeGap = (seg1, seg2) => {
  const angleDiff = Math.abs(seg1.angle - seg2.angle);
  const normalizedAngle = Math.min(angleDiff, Math.PI - angleDiff);
  
  // Must be roughly parallel
  if (normalizedAngle > Math.PI / 12) return null;
  
  const isHorizontal = seg1.isHorizontal();
  
  if (isHorizontal) {
    // Check vertical alignment
    const yDiff = Math.abs(seg1.centerY - seg2.centerY);
    if (yDiff > 15) return null;
    
    // Calculate gap size
    const gap = Math.min(
      Math.abs(seg2.x1 - seg1.x2),
      Math.abs(seg1.x1 - seg2.x2)
    );
    
    if (gap < 0) return null; // Overlapping
    
    return {
      size: gap,
      orientation: 'horizontal',
      position: {
        x1: Math.min(seg1.x2, seg2.x2),
        x2: Math.max(seg1.x1, seg2.x1),
        y: (seg1.centerY + seg2.centerY) / 2
      }
    };
  } else {
    // Check horizontal alignment
    const xDiff = Math.abs(seg1.centerX - seg2.centerX);
    if (xDiff > 15) return null;
    
    // Calculate gap size
    const gap = Math.min(
      Math.abs(seg2.y1 - seg1.y2),
      Math.abs(seg1.y1 - seg2.y2)
    );
    
    if (gap < 0) return null; // Overlapping
    
    return {
      size: gap,
      orientation: 'vertical',
      position: {
        y1: Math.min(seg1.y2, seg2.y2),
        y2: Math.max(seg1.y1, seg2.y1),
        x: (seg1.centerX + seg2.centerX) / 2
      }
    };
  }
};

/**
 * Determine if a gap should be filled
 * Small gaps (windows) might be filled, large gaps (doors) might not
 */
const shouldFillGap = (gap, allSegments, maxWindowGap) => {
  // Small gaps are likely windows - fill them
  if (gap.size <= maxWindowGap) {
    return true;
  }
  
  // Larger gaps might be doors - use context to decide
  // For now, don't fill large gaps
  return false;
};

/**
 * Create a bridge segment to fill a gap
 */
const createBridgeSegment = (gap) => {
  const pos = gap.position;
  
  if (gap.orientation === 'horizontal') {
    return new LineSegment(pos.x1, pos.y, pos.x2, pos.y, 0.5);
  } else {
    return new LineSegment(pos.x, pos.y1, pos.x, pos.y2, 0.5);
  }
};
