import { detectWalls, findRoomFromWalls, canvasToDataUrl } from './wallDetector';
import { dataUrlToImage } from './imageLoader';

/**
 * Wall Detection Testing and Debugging Utilities
 * 
 * This module provides functions to test and visualize the wall detection system
 */

/**
 * Test wall detection on an image and return detailed results
 * @param {string} imageDataUrl - Image data URL
 * @param {Object} options - Test options
 * @returns {Object} Test results with visualizations
 */
export const testWallDetection = async (imageDataUrl, options = {}) => {
  const {
    minWallLength = 50,
    useCNN = false,
    thresholdMethod = 'adaptive',
    orientationConstraints = true,
    fillGaps = true,
    maxGapLength = 100,
    testPerimeter = true,
    testRoomDetection = false,
    dimensionBBox = null, // Required for room detection test
    showDebugInfo = true
  } = options;

  console.log('=== Hybrid Wall Detection Test Started ===');
  console.log('Options:', { 
    minWallLength, 
    useCNN,
    thresholdMethod,
    orientationConstraints,
    fillGaps,
    testPerimeter, 
    testRoomDetection 
  });

  const startTime = performance.now();

  // Run wall detection with debug mode
  const wallData = await detectWalls(imageDataUrl, {
    minWallLength,
    useCNN,
    thresholdMethod,
    orientationConstraints,
    fillGaps,
    maxGapLength,
    debugMode: true
  });

  const detectionTime = wallData.detectionTime || `${(performance.now() - startTime).toFixed(2)}ms`;

  // Prepare test results
  const results = {
    success: true,
    detectionTime,
    statistics: {
      totalWalls: wallData.allWalls.length,
      horizontalWalls: wallData.horizontal.length,
      verticalWalls: wallData.vertical.length,
      exteriorWalls: wallData.exterior.length,
      interiorWalls: wallData.interior.length,
      perimeterVertices: wallData.perimeter ? wallData.perimeter.vertices.length : 0
    },
    wallData,
    visualizations: {},
    errors: []
  };

  // Generate visualizations
  try {
    if (wallData.debug && wallData.debug.visualizations) {
      const viz = wallData.debug.visualizations;
      
      results.visualizations.allWalls = canvasToDataUrl(viz.allWallsCanvas);
      results.visualizations.exteriorWalls = canvasToDataUrl(viz.exteriorWallsCanvas);
      results.visualizations.interiorWalls = canvasToDataUrl(viz.interiorWallsCanvas);
      results.visualizations.perimeter = canvasToDataUrl(viz.perimeterCanvas);
    }

    // Create combined visualization
    results.visualizations.combined = await createCombinedVisualization(wallData);
  } catch (error) {
    console.error('Error creating visualizations:', error);
    results.errors.push(`Visualization error: ${error.message}`);
  }

  // Test perimeter detection
  if (testPerimeter) {
    const perimeterTest = testPerimeterQuality(wallData);
    results.perimeterTest = perimeterTest;
    
    if (!perimeterTest.passed) {
      results.errors.push(...perimeterTest.errors);
    }
  }

  // Test room detection
  if (testRoomDetection && dimensionBBox) {
    try {
      const roomBox = findRoomFromWalls(wallData, dimensionBBox);
      results.roomDetection = {
        success: roomBox !== null,
        roomBox,
        dimensionBBox
      };

      if (roomBox) {
        results.visualizations.room = await visualizeRoomDetection(
          imageDataUrl,
          roomBox,
          dimensionBBox
        );
      } else {
        results.errors.push('Room detection failed: No room box found');
      }
    } catch (error) {
      console.error('Error in room detection test:', error);
      results.errors.push(`Room detection error: ${error.message}`);
    }
  }

  // Print summary
  if (showDebugInfo) {
    printTestSummary(results);
  }

  console.log('=== Wall Detection Test Completed ===');
  return results;
};

/**
 * Test perimeter detection quality
 */
const testPerimeterQuality = (wallData) => {
  const test = {
    passed: true,
    errors: [],
    warnings: []
  };

  const { perimeter, exterior } = wallData;

  // Check if perimeter exists
  if (!perimeter || !perimeter.vertices) {
    test.passed = false;
    test.errors.push('Perimeter not detected');
    return test;
  }

  // Check minimum vertices
  if (perimeter.vertices.length < 4) {
    test.passed = false;
    test.errors.push(`Perimeter has only ${perimeter.vertices.length} vertices (minimum 4 required)`);
  }

  // Check if perimeter is closed (first and last vertices should be close)
  const first = perimeter.vertices[0];
  const last = perimeter.vertices[perimeter.vertices.length - 1];
  const closingDist = Math.sqrt((last.x - first.x) ** 2 + (last.y - first.y) ** 2);
  
  if (closingDist > 50) {
    test.warnings.push(`Perimeter may not be properly closed (gap: ${closingDist.toFixed(1)}px)`);
  }

  // Check if exterior walls were found
  if (exterior.length === 0) {
    test.passed = false;
    test.errors.push('No exterior walls detected');
  }

  return test;
};

/**
 * Create a combined visualization showing all detection results
 */
const createCombinedVisualization = async (wallData) => {
  const { imageSize, exterior, interior, perimeter } = wallData;
  const { width, height } = imageSize;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  // White background
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, width, height);

  // Draw exterior walls in red
  ctx.fillStyle = 'rgba(255, 0, 0, 0.3)';
  ctx.strokeStyle = 'rgba(255, 0, 0, 0.8)';
  ctx.lineWidth = 2;
  for (const wall of exterior) {
    const { x1, y1, x2, y2 } = wall.boundingBox;
    ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
    ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
  }

  // Draw interior walls in blue
  ctx.fillStyle = 'rgba(0, 0, 255, 0.3)';
  ctx.strokeStyle = 'rgba(0, 0, 255, 0.8)';
  for (const wall of interior) {
    const { x1, y1, x2, y2 } = wall.boundingBox;
    ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
    ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
  }

  // Draw perimeter in green
  if (perimeter && perimeter.vertices) {
    ctx.strokeStyle = 'rgba(0, 255, 0, 1)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    
    const vertices = perimeter.vertices;
    if (vertices.length > 0) {
      ctx.moveTo(vertices[0].x, vertices[0].y);
      for (let i = 1; i < vertices.length; i++) {
        ctx.lineTo(vertices[i].x, vertices[i].y);
      }
      ctx.closePath();
    }
    
    ctx.stroke();

    // Draw vertices as circles
    ctx.fillStyle = 'rgba(0, 255, 0, 1)';
    for (const vertex of vertices) {
      ctx.beginPath();
      ctx.arc(vertex.x, vertex.y, 6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Add legend
  drawLegend(ctx);

  return canvas.toDataURL();
};

/**
 * Draw legend on canvas
 */
const drawLegend = (ctx) => {
  const legendX = 10;
  const legendY = 10;
  const lineHeight = 25;

  ctx.font = 'bold 14px Arial';
  ctx.fillStyle = 'white';
  ctx.strokeStyle = 'black';
  ctx.lineWidth = 1;

  const items = [
    { color: 'rgba(255, 0, 0, 0.8)', label: 'Exterior Walls' },
    { color: 'rgba(0, 0, 255, 0.8)', label: 'Interior Walls' },
    { color: 'rgba(0, 255, 0, 1)', label: 'Perimeter' }
  ];

  items.forEach((item, index) => {
    const y = legendY + index * lineHeight;
    
    // Draw color box
    ctx.fillStyle = item.color;
    ctx.fillRect(legendX, y, 20, 15);
    ctx.strokeRect(legendX, y, 20, 15);
    
    // Draw label
    ctx.fillStyle = 'black';
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 3;
    ctx.strokeText(item.label, legendX + 30, y + 12);
    ctx.fillText(item.label, legendX + 30, y + 12);
  });
};

/**
 * Visualize room detection result
 */
const visualizeRoomDetection = async (imageDataUrl, roomBox, dimensionBBox) => {
  const img = await dataUrlToImage(imageDataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');

  // Draw original image
  ctx.drawImage(img, 0, 0);

  // Draw dimension bbox in yellow
  ctx.strokeStyle = 'yellow';
  ctx.lineWidth = 2;
  ctx.strokeRect(
    dimensionBBox.x,
    dimensionBBox.y,
    dimensionBBox.width,
    dimensionBBox.height
  );

  // Draw room box in green
  ctx.strokeStyle = 'lime';
  ctx.lineWidth = 3;
  ctx.strokeRect(
    roomBox.x1,
    roomBox.y1,
    roomBox.x2 - roomBox.x1,
    roomBox.y2 - roomBox.y1
  );

  // Add labels
  ctx.font = 'bold 16px Arial';
  ctx.fillStyle = 'yellow';
  ctx.strokeStyle = 'black';
  ctx.lineWidth = 3;
  ctx.strokeText('Dimension', dimensionBBox.x, dimensionBBox.y - 5);
  ctx.fillText('Dimension', dimensionBBox.x, dimensionBBox.y - 5);

  ctx.fillStyle = 'lime';
  ctx.strokeText('Room', roomBox.x1, roomBox.y1 - 5);
  ctx.fillText('Room', roomBox.x1, roomBox.y1 - 5);

  return canvas.toDataURL();
};

/**
 * Print test summary to console
 */
const printTestSummary = (results) => {
  console.log('\n=== Test Summary ===');
  console.log(`Detection Time: ${results.detectionTime}`);
  console.log('\nStatistics:');
  console.log(`  Total Walls: ${results.statistics.totalWalls}`);
  console.log(`  Horizontal: ${results.statistics.horizontalWalls}`);
  console.log(`  Vertical: ${results.statistics.verticalWalls}`);
  console.log(`  Exterior: ${results.statistics.exteriorWalls}`);
  console.log(`  Interior: ${results.statistics.interiorWalls}`);
  console.log(`  Perimeter Vertices: ${results.statistics.perimeterVertices}`);

  if (results.perimeterTest) {
    console.log('\nPerimeter Test:');
    console.log(`  Passed: ${results.perimeterTest.passed}`);
    if (results.perimeterTest.errors.length > 0) {
      console.log('  Errors:', results.perimeterTest.errors);
    }
    if (results.perimeterTest.warnings.length > 0) {
      console.log('  Warnings:', results.perimeterTest.warnings);
    }
  }

  if (results.roomDetection) {
    console.log('\nRoom Detection:');
    console.log(`  Success: ${results.roomDetection.success}`);
    if (results.roomDetection.roomBox) {
      const rb = results.roomDetection.roomBox;
      console.log(`  Room Box: (${rb.x1}, ${rb.y1}) to (${rb.x2}, ${rb.y2})`);
    }
  }

  if (results.errors.length > 0) {
    console.log('\nErrors:');
    results.errors.forEach(err => console.log(`  - ${err}`));
  }

  console.log('===================\n');
};

/**
 * Compare wall detection with different parameters
 * Useful for tuning detection parameters
 */
export const compareWallDetectionParameters = async (imageDataUrl, parameterSets = null) => {
  console.log('=== Parameter Comparison Test ===');
  
  // Default parameter sets to test
  if (!parameterSets) {
    parameterSets = [
      { minWallLength: 30, thresholdMethod: 'adaptive', fillGaps: true },
      { minWallLength: 50, thresholdMethod: 'adaptive', fillGaps: true },
      { minWallLength: 75, thresholdMethod: 'adaptive', fillGaps: true },
      { minWallLength: 50, thresholdMethod: 'otsu', fillGaps: true },
      { minWallLength: 50, thresholdMethod: 'adaptive', fillGaps: false }
    ];
  }
  
  console.log(`Testing ${parameterSets.length} parameter combinations`);

  const results = [];

  for (let i = 0; i < parameterSets.length; i++) {
    const params = parameterSets[i];
    console.log(`\nTest ${i + 1}/${parameterSets.length}:`, params);
    
    const result = await testWallDetection(imageDataUrl, {
      ...params,
      testPerimeter: true,
      showDebugInfo: false
    });

    results.push({
      parameters: params,
      statistics: result.statistics,
      perimeterPassed: result.perimeterTest ? result.perimeterTest.passed : false,
      errors: result.errors.length,
      detectionTime: result.detectionTime
    });
  }

  // Print comparison table
  console.log('\n=== Comparison Results ===');
  console.log('Test | minLen | Threshold | FillGaps | Total | Ext | Int | Perim | Time   | Pass');
  console.log('-----|--------|-----------|----------|-------|-----|-----|-------|--------|-----');
  
  results.forEach((r, i) => {
    const s = r.statistics;
    const p = r.parameters;
    console.log(
      `${String(i + 1).padStart(4)} | ` +
      `${String(p.minWallLength).padStart(6)} | ` +
      `${String(p.thresholdMethod).padStart(9)} | ` +
      `${String(p.fillGaps ? 'Yes' : 'No').padStart(8)} | ` +
      `${String(s.totalWalls).padStart(5)} | ` +
      `${String(s.exteriorWalls).padStart(3)} | ` +
      `${String(s.interiorWalls).padStart(3)} | ` +
      `${String(s.perimeterVertices).padStart(5)} | ` +
      `${String(r.detectionTime).padStart(6)} | ` +
      `${r.perimeterPassed ? ' ✓ ' : ' ✗ '}`
    );
  });

  console.log('=========================\n');

  return results;
};

/**
 * Batch test multiple images
 */
export const batchTestWallDetection = async (imageDataUrls, options = {}) => {
  console.log(`=== Batch Test: ${imageDataUrls.length} images ===`);

  const results = [];

  for (let i = 0; i < imageDataUrls.length; i++) {
    console.log(`\nTesting image ${i + 1}/${imageDataUrls.length}...`);
    
    try {
      const result = await testWallDetection(imageDataUrls[i], {
        ...options,
        showDebugInfo: false
      });
      
      results.push({
        index: i,
        success: result.success,
        statistics: result.statistics,
        errors: result.errors
      });
    } catch (error) {
      console.error(`Error testing image ${i + 1}:`, error);
      results.push({
        index: i,
        success: false,
        error: error.message
      });
    }
  }

  // Print batch summary
  console.log('\n=== Batch Test Summary ===');
  const successCount = results.filter(r => r.success).length;
  console.log(`Success Rate: ${successCount}/${imageDataUrls.length} (${(successCount / imageDataUrls.length * 100).toFixed(1)}%)`);
  
  console.log('\nPer-Image Results:');
  results.forEach(r => {
    if (r.success) {
      console.log(`  Image ${r.index + 1}: ✓ (${r.statistics.totalWalls} walls, ${r.statistics.perimeterVertices} vertices)`);
    } else {
      console.log(`  Image ${r.index + 1}: ✗ (${r.error || 'Unknown error'})`);
    }
  });

  console.log('=========================\n');

  return results;
};

/**
 * Export test results to JSON
 */
export const exportTestResults = (results, filename = 'wall-detection-test-results.json') => {
  const json = JSON.stringify(results, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  
  URL.revokeObjectURL(url);
  console.log(`Test results exported to ${filename}`);
};
