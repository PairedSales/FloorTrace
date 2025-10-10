import { dataUrlToImage } from './imageLoader';
import { detectLines, findPerimeter } from './lineDetector';

/**
 * Detect the perimeter of a floor plan using line detection
 * @param {string} imageDataUrl - The image data URL
 * @param {boolean} useInterior - True for interior walls, false for exterior walls
 * @param {Object} existingLineData - Optional pre-computed line data from room detection
 * @returns {Object} Perimeter overlay with vertices
 */
export const detectPerimeter = async (imageDataUrl, useInterior = true, existingLineData = null) => {
  try {
    let lineData = existingLineData;
    
    // If we don't have existing line data, detect lines now
    if (!lineData) {
      console.log('Detecting lines for perimeter...');
      const img = await dataUrlToImage(imageDataUrl);
      lineData = detectLines(img);
      console.log(`Found ${lineData.horizontal.length} horizontal and ${lineData.vertical.length} vertical lines`);
    }
    
    // Find the perimeter using the detected lines
    const vertices = findPerimeter(lineData.horizontal, lineData.vertical, useInterior);
    
    if (!vertices || vertices.length < 3) {
      console.log('Could not detect perimeter from lines');
      return null;
    }
    
    console.log(`Perimeter detected with ${vertices.length} vertices`);
    
    return {
      vertices,
      lineData // Return line data for future use
    };
  } catch (error) {
    console.error('Error in perimeter detection:', error);
    return null;
  }
};
