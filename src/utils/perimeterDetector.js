import { detectWalls } from './wallDetector';
import { calculateInteriorEdge, calculateExteriorEdge } from './perimeterDetectorHybrid';

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
    console.log(`Detecting perimeter (${useInteriorWalls ? 'interior' : 'exterior'} edge) using hybrid wall detection system...`);

    // Get wall data (reuse if already computed)
    let wallData = existingWallData;
    if (!wallData) {
      wallData = await detectWalls(imageDataUrl, {
        minWallLength: 75,
        thresholdMethod: 'adaptive',
        orientationConstraints: true,
        fillGaps: true,
        maxGapLength: 100,
        debugMode: false
      });
    }

    // The wall detection system already provides a perimeter from exterior walls
    if (!wallData.perimeter || !wallData.perimeter.vertices) {
      console.log('Wall detection did not find a perimeter');
      return null;
    }

    const centerlinePerimeter = wallData.perimeter;

    // Estimate wall thickness from exterior walls
    let wallThickness = 10; // Default
    if (wallData.exterior && wallData.exterior.length > 0) {
      const thicknesses = wallData.exterior.map(wall => {
        const bbox = wall.boundingBox;
        return wall.isHorizontal
          ? (bbox.y2 - bbox.y1)
          : (bbox.x2 - bbox.x1);
      });
      wallThickness = thicknesses.reduce((sum, t) => sum + t, 0) / thicknesses.length;
    }

    // Calculate the appropriate edge vertices
    let finalVertices;
    if (useInteriorWalls) {
      finalVertices = calculateInteriorEdge(wallData.exterior, centerlinePerimeter, wallThickness / 2);
    } else {
      finalVertices = calculateExteriorEdge(wallData.exterior, centerlinePerimeter, wallThickness / 2);
    }

    // Fallback to centerline if edge calculation fails
    if (!finalVertices || finalVertices.length < 3) {
      console.log('Edge calculation failed, using centerline perimeter');
      finalVertices = centerlinePerimeter.vertices;
    }

    console.log(`✅ Perimeter detected: ${finalVertices.length} vertices on ${useInteriorWalls ? 'interior' : 'exterior'} edge`);

    return {
      vertices: finalVertices,
      wallData,
      edgeType: useInteriorWalls ? 'interior' : 'exterior',
      wallThickness,
      centerlineVertices: centerlinePerimeter.vertices
    };

  } catch (error) {
    console.error('Error in perimeter detection:', error);
    return null;
  }
};

/**
 * Switch perimeter from interior to exterior edge or vice versa
 * @param {Object} perimeterData - Existing perimeter data
 * @param {boolean} useInteriorWalls - True for interior, false for exterior
 * @returns {Object} Updated perimeter with new edge vertices
 */
export const switchPerimeterEdge = (perimeterData, useInteriorWalls) => {
  if (!perimeterData || !perimeterData.centerlineVertices || !perimeterData.wallData) {
    console.error('Cannot switch edge: missing perimeter data');
    return null;
  }

  console.log(`Switching perimeter to ${useInteriorWalls ? 'interior' : 'exterior'} edge...`);

  const centerlinePerimeter = { vertices: perimeterData.centerlineVertices };
  const wallThickness = perimeterData.wallThickness || 10;

  let newVertices;
  if (useInteriorWalls) {
    newVertices = calculateInteriorEdge(perimeterData.wallData.exterior, centerlinePerimeter, wallThickness / 2);
  } else {
    newVertices = calculateExteriorEdge(perimeterData.wallData.exterior, centerlinePerimeter, wallThickness / 2);
  }

  if (!newVertices || newVertices.length < 3) {
    console.log('Failed to calculate new edge vertices');
    return null;
  }

  console.log(`Switched to ${useInteriorWalls ? 'interior' : 'exterior'} edge`);

  return {
    ...perimeterData,
    vertices: newVertices,
    edgeType: useInteriorWalls ? 'interior' : 'exterior'
  };
};
