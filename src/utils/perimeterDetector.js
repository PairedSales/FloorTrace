import { dataUrlToImage } from './imageLoader';
import { detectLines, findPerimeter } from './lineDetector';
import { detectPerimeterMorphological } from './morphologicalPerimeterDetector';

/**
 * Detect the perimeter of a floor plan using morphological closing and contour detection
 * This is the primary method that handles complex floorplans with varying wall thicknesses,
 * window openings, and corner columns.
 * 
 * @param {string} imageDataUrl - The image data URL
 * @param {boolean} useInterior - True for interior walls, false for exterior walls (legacy parameter)
 * @param {Object} existingLineData - Optional pre-computed line data from room detection (legacy parameter)
 * @returns {Object} Perimeter overlay with vertices
 */
export const detectPerimeter = async (imageDataUrl, useInterior = true, existingLineData = null) => {
  try {
    console.log('Using morphological perimeter detection...');
    
    // Use the new morphological approach
    const result = await detectPerimeterMorphological(imageDataUrl);
    
    if (result && result.vertices && result.vertices.length >= 4) {
      console.log(`Morphological detection successful: ${result.vertices.length} vertices`);
      return result;
    }
    
    // Fallback to line-based detection if morphological fails
    console.log('Morphological detection failed, falling back to line detection...');
    return await detectPerimeterLinesBased(imageDataUrl, useInterior, existingLineData);
    
  } catch (error) {
    console.error('Error in perimeter detection:', error);
    
    // Try fallback method
    try {
      console.log('Attempting fallback line detection...');
      return await detectPerimeterLinesBased(imageDataUrl, useInterior, existingLineData);
    } catch (fallbackError) {
      console.error('Fallback detection also failed:', fallbackError);
      return null;
    }
  }
};

/**
 * Legacy line-based perimeter detection (fallback method)
 * @param {string} imageDataUrl - The image data URL
 * @param {boolean} useInterior - True for interior walls, false for exterior walls
 * @param {Object} existingLineData - Optional pre-computed line data from room detection
 * @returns {Object} Perimeter overlay with vertices
 */
const detectPerimeterLinesBased = async (imageDataUrl, useInterior = true, existingLineData = null) => {
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
};
