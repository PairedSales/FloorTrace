import { dataUrlToImage } from './imageLoader';
import { detectLines, findPerimeter } from './lineDetector';
import { detectPerimeterMorphological } from './morphologicalPerimeterDetector';
import { detectWalls } from './wallDetector';
import { detectPerimeterHybrid } from './perimeterDetectorHybrid';

/**
 * Detect the perimeter of a floor plan using the HYBRID wall detection system
 * Supports interior/exterior wall edge selection
 * 
 * @param {string} imageDataUrl - The image data URL
 * @param {boolean} useInteriorWalls - True for interior edge (default), false for exterior edge
 * @param {Object} existingWallData - Optional pre-computed wall data from room detection
 * @returns {Object} Perimeter overlay with vertices and metadata
 */
export const detectPerimeter = async (imageDataUrl, useInteriorWalls = true, existingWallData = null) => {
  try {
    // PRIMARY METHOD: Use new hybrid wall detection system with interior/exterior edge support
    console.log('Using HYBRID wall detection system for perimeter...');
    const hybridResult = await detectPerimeterHybrid(imageDataUrl, useInteriorWalls, existingWallData);
    
    if (hybridResult && hybridResult.vertices && hybridResult.vertices.length >= 4) {
      console.log(`✅ Hybrid detection successful: ${hybridResult.vertices.length} vertices on ${useInteriorWalls ? 'interior' : 'exterior'} edge`);
      return hybridResult;
    }
    
    // FALLBACK 1: Try legacy wall-based detection
    console.log('Hybrid detection failed, trying legacy wall-based detection...');
    const wallResult = await detectPerimeterWallBased(imageDataUrl);
    
    if (wallResult && wallResult.vertices && wallResult.vertices.length >= 4) {
      console.log(`Wall-based detection successful: ${wallResult.vertices.length} vertices`);
      return wallResult;
    }
    
    // FALLBACK 2: Morphological approach
    console.log('Wall-based detection failed, trying morphological detection...');
    const morphResult = await detectPerimeterMorphological(imageDataUrl);
    
    if (morphResult && morphResult.vertices && morphResult.vertices.length >= 4) {
      console.log(`Morphological detection successful: ${morphResult.vertices.length} vertices`);
      return morphResult;
    }
    
    // FALLBACK 3: Line-based detection
    console.log('Morphological detection failed, falling back to line detection...');
    return await detectPerimeterLinesBased(imageDataUrl, useInteriorWalls, existingWallData);
    
  } catch (error) {
    console.error('Error in perimeter detection:', error);
    
    // Try final fallback method
    try {
      console.log('Attempting fallback line detection...');
      return await detectPerimeterLinesBased(imageDataUrl, useInteriorWalls, existingWallData);
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
/**
 * Wall-based perimeter detection (primary method)
 * Uses the new wall detection system
 */
const detectPerimeterWallBased = async (imageDataUrl) => {
  try {
    const wallData = await detectWalls(imageDataUrl, {
      minWallLength: 100,
      debugMode: false
    });
    
    if (!wallData.perimeter || !wallData.perimeter.vertices) {
      console.log('Wall-based perimeter detection found no perimeter');
      return null;
    }
    
    return {
      vertices: wallData.perimeter.vertices,
      wallData // Return wall data for future use
    };
  } catch (error) {
    console.error('Error in wall-based perimeter detection:', error);
    return null;
  }
};

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
