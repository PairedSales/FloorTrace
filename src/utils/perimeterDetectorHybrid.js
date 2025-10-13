/**
 * Hybrid Perimeter Detector - Uses new wall detection system
 * Supports interior/exterior wall edge selection
 */

import { detectWalls } from './wallDetector';

/**
 * Calculate interior edge perimeter from exterior walls
 * Shifts perimeter inward by wall thickness
 * @param {Array} exteriorWalls - Exterior wall segments
 * @param {Object} perimeter - Perimeter with vertices
 * @param {number} wallThickness - Estimated wall thickness in pixels
 * @returns {Array} Interior edge vertices
 */
const calculateInteriorEdge = (exteriorWalls, perimeter, wallThickness = 10) => {
  if (!perimeter || !perimeter.vertices || perimeter.vertices.length < 3) {
    return null;
  }
  
  // Shift vertices inward by wall thickness
  // This creates the interior edge by moving vertices toward the center
  const centerX = perimeter.vertices.reduce((sum, v) => sum + v.x, 0) / perimeter.vertices.length;
  const centerY = perimeter.vertices.reduce((sum, v) => sum + v.y, 0) / perimeter.vertices.length;
  
  const interiorVertices = perimeter.vertices.map(vertex => {
    const dx = centerX - vertex.x;
    const dy = centerY - vertex.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    if (distance < 1) return vertex; // Avoid division by zero
    
    // Move vertex toward center by wall thickness
    const ratio = wallThickness / distance;
    
    return {
      x: vertex.x + dx * ratio,
      y: vertex.y + dy * ratio
    };
  });
  
  return interiorVertices;
};

/**
 * Calculate exterior edge perimeter from exterior walls
 * Shifts perimeter outward by wall thickness
 * @param {Array} exteriorWalls - Exterior wall segments
 * @param {Object} perimeter - Perimeter with vertices
 * @param {number} wallThickness - Estimated wall thickness in pixels
 * @returns {Array} Exterior edge vertices
 */
const calculateExteriorEdge = (exteriorWalls, perimeter, wallThickness = 10) => {
  if (!perimeter || !perimeter.vertices || perimeter.vertices.length < 3) {
    return null;
  }
  
  // Shift vertices outward by wall thickness
  // This creates the exterior edge by moving vertices away from center
  const centerX = perimeter.vertices.reduce((sum, v) => sum + v.x, 0) / perimeter.vertices.length;
  const centerY = perimeter.vertices.reduce((sum, v) => sum + v.y, 0) / perimeter.vertices.length;
  
  const exteriorVertices = perimeter.vertices.map(vertex => {
    const dx = centerX - vertex.x;
    const dy = centerY - vertex.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    if (distance < 1) return vertex; // Avoid division by zero
    
    // Move vertex away from center by wall thickness
    const ratio = wallThickness / distance;
    
    return {
      x: vertex.x - dx * ratio,
      y: vertex.y - dy * ratio
    };
  });
  
  return exteriorVertices;
};

/**
 * Detect perimeter using hybrid wall detection system
 * Supports interior/exterior wall edge selection
 * 
 * @param {string} imageDataUrl - The image data URL
 * @param {boolean} useInteriorWalls - True for interior edge (default), false for exterior edge
 * @param {Object} existingWallData - Optional pre-computed wall data from room detection
 * @returns {Object} Perimeter overlay with vertices and metadata
 */
export const detectPerimeterHybrid = async (imageDataUrl, useInteriorWalls = true, existingWallData = null) => {
  try {
    console.log(`\n=== Hybrid Perimeter Detection (${useInteriorWalls ? 'Interior' : 'Exterior'} Edge) ===`);
    
    let wallData = existingWallData;
    
    // If we don't have existing wall data, run hybrid detection
    if (!wallData) {
      console.log('Running hybrid wall detection for perimeter...');
      wallData = await detectWalls(imageDataUrl, {
        minWallLength: 75, // Higher threshold for perimeter to focus on main walls
        thresholdMethod: 'adaptive',
        orientationConstraints: true,
        fillGaps: true,
        maxGapLength: 100,
        debugMode: false
      });
    }
    
    if (!wallData || !wallData.perimeter || !wallData.perimeter.vertices) {
      console.log('Hybrid wall detection found no perimeter');
      return null;
    }
    
    // The perimeter from detectWalls is at the wall centerline
    const centerlinePerimeter = wallData.perimeter;
    
    console.log(`Detected perimeter with ${centerlinePerimeter.vertices.length} vertices at centerline`);
    
    // Estimate wall thickness from exterior walls
    let wallThickness = 10; // Default 10px
    if (wallData.exterior && wallData.exterior.length > 0) {
      // Calculate average wall thickness from exterior walls
      const thicknesses = wallData.exterior.map(wall => {
        const bbox = wall.boundingBox;
        return wall.isHorizontal 
          ? (bbox.y2 - bbox.y1)  // Height for horizontal walls
          : (bbox.x2 - bbox.x1); // Width for vertical walls
      });
      wallThickness = thicknesses.reduce((sum, t) => sum + t, 0) / thicknesses.length;
      console.log(`Estimated wall thickness: ${wallThickness.toFixed(1)}px`);
    }
    
    // Calculate interior or exterior edge vertices
    let finalVertices;
    if (useInteriorWalls) {
      console.log('Calculating interior edge (inner face of walls)...');
      finalVertices = calculateInteriorEdge(wallData.exterior, centerlinePerimeter, wallThickness / 2);
    } else {
      console.log('Calculating exterior edge (outer face of walls)...');
      finalVertices = calculateExteriorEdge(wallData.exterior, centerlinePerimeter, wallThickness / 2);
    }
    
    if (!finalVertices || finalVertices.length < 3) {
      console.log('Failed to calculate edge vertices, using centerline');
      finalVertices = centerlinePerimeter.vertices;
    }
    
    console.log(`Final perimeter: ${finalVertices.length} vertices on ${useInteriorWalls ? 'interior' : 'exterior'} edge`);
    console.log('=== Perimeter Detection Complete ===\n');
    
    return {
      vertices: finalVertices,
      wallData, // Return wall data for future use
      edgeType: useInteriorWalls ? 'interior' : 'exterior',
      wallThickness,
      centerlineVertices: centerlinePerimeter.vertices // Keep original for reference
    };
    
  } catch (error) {
    console.error('Error in hybrid perimeter detection:', error);
    return null;
  }
};

/**
 * Switch perimeter from interior to exterior edge or vice versa
 * @param {Object} perimeterData - Existing perimeter data from detectPerimeterHybrid
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
  
  // Calculate new edge vertices
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
