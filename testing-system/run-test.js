/**
 * Comprehensive Wall Detection Testing System
 * 
 * This script:
 * 1. Loads input parameters from inputs.json
 * 2. Processes ExampleFloorplan.png using the wall detection system
 * 3. Saves all outputs (walls, images, metrics) to a timestamped folder
 * 4. Generates a comprehensive test report
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createCanvas, loadImage } from 'canvas';

// Get directory paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import wall detection modules
import { detectWalls } from '../src/utils/wallDetector.js';
import { detectThickWalls, mergeThickWalls } from '../src/utils/thickWallDetector.js';
import { preprocessImage } from '../src/utils/imagePreprocessor.js';

/**
 * Main test runner
 */
async function runTest() {
  console.log('========================================');
  console.log('WALL DETECTION COMPREHENSIVE TEST');
  console.log('========================================\n');
  
  // Create timestamp for this test run
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const outputDir = path.join(__dirname, 'test-results', timestamp);
  
  // Create output directory
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  console.log(`Output directory: ${outputDir}\n`);
  
  try {
    // STEP 1: Load inputs.json
    console.log('STEP 1: Loading test configuration...');
    const inputsPath = path.join(__dirname, 'inputs.json');
    const inputs = JSON.parse(fs.readFileSync(inputsPath, 'utf-8'));
    console.log('✓ Configuration loaded\n');
    
    // Save inputs to output directory
    fs.writeFileSync(
      path.join(outputDir, 'inputs-used.json'),
      JSON.stringify(inputs, null, 2)
    );
    
    // STEP 2: Load test image
    console.log('STEP 2: Loading test image...');
    const imagePath = path.resolve(__dirname, inputs.inputImage);
    const image = await loadImage(imagePath);
    console.log(`✓ Image loaded: ${image.width}x${image.height}px\n`);
    
    // Convert image to canvas
    const canvas = createCanvas(image.width, image.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    const imageData = ctx.getImageData(0, 0, image.width, image.height);
    
    // STEP 3: Run wall detection
    console.log('STEP 3: Running wall detection...');
    const startTime = Date.now();
    
    const detectionOptions = {
      minWallLength: inputs.wallDetection.minWallLength,
      thresholdMethod: inputs.preprocessing.thresholdMethod,
      orientationConstraints: inputs.lineDetection.orientationConstraint,
      fillGaps: inputs.wallDetection.fillGaps,
      maxGapLength: inputs.wallDetection.maxGapLength,
      debugMode: inputs.wallDetection.debugMode
    };
    
    // Add preprocessing options
    Object.assign(detectionOptions, {
      globalThresholdValue: inputs.preprocessing.globalThresholdValue,
      adaptiveWindowSize: inputs.preprocessing.adaptiveWindowSize,
      adaptiveC: inputs.preprocessing.adaptiveC,
      removeNoise: inputs.preprocessing.removeNoise,
      minComponentSize: inputs.preprocessing.minComponentSize,
      useClosing: inputs.preprocessing.useClosing,
      closingKernelSize: inputs.preprocessing.closingKernelSize
    });
    
    const results = await detectWalls(image, detectionOptions);
    
    const endTime = Date.now();
    const processingTime = endTime - startTime;
    
    console.log(`✓ Detection complete in ${processingTime}ms\n`);
    
    // STEP 4: Process and analyze results
    console.log('STEP 4: Analyzing results...');
    
    const analysis = {
      timestamp,
      processingTime,
      imageSize: {
        width: image.width,
        height: image.height
      },
      wallCounts: {
        total: results.allWalls.length,
        horizontal: results.horizontal.length,
        vertical: results.vertical.length,
        exterior: results.exterior.length,
        interior: results.interior.length
      },
      perimeter: results.perimeter ? {
        vertexCount: results.perimeter.vertices.length
      } : null
    };
    
    // Calculate wall statistics
    if (results.allWalls.length > 0) {
      const lengths = results.allWalls.map(w => w.length);
      const thicknesses = results.allWalls.map(w => w.thickness);
      
      analysis.wallStatistics = {
        length: {
          min: Math.min(...lengths).toFixed(2),
          max: Math.max(...lengths).toFixed(2),
          avg: (lengths.reduce((a, b) => a + b, 0) / lengths.length).toFixed(2)
        },
        thickness: {
          min: Math.min(...thicknesses).toFixed(2),
          max: Math.max(...thicknesses).toFixed(2),
          avg: (thicknesses.reduce((a, b) => a + b, 0) / thicknesses.length).toFixed(2)
        }
      };
    }
    
    console.log('✓ Analysis complete\n');
    
    // STEP 5: Save results
    console.log('STEP 5: Saving results...');
    
    // Save analysis report
    fs.writeFileSync(
      path.join(outputDir, 'analysis.json'),
      JSON.stringify(analysis, null, 2)
    );
    
    // Save wall data
    const wallData = {
      allWalls: results.allWalls.map(serializeWall),
      horizontal: results.horizontal.map(serializeWall),
      vertical: results.vertical.map(serializeWall),
      exterior: results.exterior.map(serializeWall),
      interior: results.interior.map(serializeWall),
      perimeter: results.perimeter
    };
    
    fs.writeFileSync(
      path.join(outputDir, 'walls.json'),
      JSON.stringify(wallData, null, 2)
    );
    
    // STEP 6: Generate visualizations
    console.log('STEP 6: Generating visualizations...');
    
    // Original image
    fs.writeFileSync(
      path.join(outputDir, '1-original.png'),
      canvas.toBuffer('image/png')
    );
    
    // All walls
    const allWallsCanvas = createVisualization(
      image.width,
      image.height,
      results.allWalls,
      'All Detected Walls',
      '#000000'
    );
    fs.writeFileSync(
      path.join(outputDir, '2-all-walls.png'),
      allWallsCanvas.toBuffer('image/png')
    );
    
    // Exterior walls
    const exteriorCanvas = createVisualization(
      image.width,
      image.height,
      results.exterior,
      'Exterior Walls',
      '#FF0000'
    );
    fs.writeFileSync(
      path.join(outputDir, '3-exterior-walls.png'),
      exteriorCanvas.toBuffer('image/png')
    );
    
    // Interior walls
    const interiorCanvas = createVisualization(
      image.width,
      image.height,
      results.interior,
      'Interior Walls',
      '#0000FF'
    );
    fs.writeFileSync(
      path.join(outputDir, '4-interior-walls.png'),
      interiorCanvas.toBuffer('image/png')
    );
    
    // Combined visualization
    const combinedCanvas = createCombinedVisualization(
      image.width,
      image.height,
      results.exterior,
      results.interior,
      results.perimeter
    );
    fs.writeFileSync(
      path.join(outputDir, '5-combined.png'),
      combinedCanvas.toBuffer('image/png')
    );
    
    // Overlay on original
    const overlayCanvas = createOverlay(
      image,
      results.exterior,
      results.interior,
      results.perimeter
    );
    fs.writeFileSync(
      path.join(outputDir, '6-overlay.png'),
      overlayCanvas.toBuffer('image/png')
    );
    
    console.log('✓ Visualizations saved\n');
    
    // STEP 7: Generate HTML report
    console.log('STEP 7: Generating HTML report...');
    const htmlReport = generateHTMLReport(analysis, inputs);
    fs.writeFileSync(
      path.join(outputDir, 'report.html'),
      htmlReport
    );
    console.log('✓ HTML report generated\n');
    
    // STEP 8: Print summary
    console.log('========================================');
    console.log('TEST COMPLETE - SUMMARY');
    console.log('========================================');
    console.log(`Processing Time: ${processingTime}ms`);
    console.log(`Total Walls: ${analysis.wallCounts.total}`);
    console.log(`  - Horizontal: ${analysis.wallCounts.horizontal}`);
    console.log(`  - Vertical: ${analysis.wallCounts.vertical}`);
    console.log(`  - Exterior: ${analysis.wallCounts.exterior}`);
    console.log(`  - Interior: ${analysis.wallCounts.interior}`);
    if (analysis.perimeter) {
      console.log(`Perimeter Vertices: ${analysis.perimeter.vertexCount}`);
    }
    console.log(`\nResults saved to: ${outputDir}`);
    console.log('========================================\n');
    
  } catch (error) {
    console.error('ERROR:', error);
    
    // Save error log
    fs.writeFileSync(
      path.join(outputDir, 'error.log'),
      `${error.stack || error.message}`
    );
    
    process.exit(1);
  }
}

/**
 * Serialize wall object for JSON output
 */
function serializeWall(wall) {
  return {
    boundingBox: wall.boundingBox,
    length: wall.length,
    thickness: wall.thickness,
    isHorizontal: wall.isHorizontal,
    centerX: wall.centerX,
    centerY: wall.centerY,
    pixelCount: wall.pixels ? wall.pixels.length : 0
  };
}

/**
 * Create visualization canvas
 */
function createVisualization(width, height, walls, title, color) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  
  // White background
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, width, height);
  
  // Draw walls
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  
  for (const wall of walls) {
    const { x1, y1, x2, y2 } = wall.boundingBox;
    ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
  }
  
  // Add title
  ctx.fillStyle = '#000000';
  ctx.font = 'bold 20px Arial';
  ctx.fillText(title, 10, 30);
  
  return canvas;
}

/**
 * Create combined visualization
 */
function createCombinedVisualization(width, height, exterior, interior, perimeter) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  
  // White background
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, width, height);
  
  // Draw exterior walls (red)
  ctx.fillStyle = 'rgba(255, 0, 0, 0.6)';
  for (const wall of exterior) {
    const { x1, y1, x2, y2 } = wall.boundingBox;
    ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
  }
  
  // Draw interior walls (blue)
  ctx.fillStyle = 'rgba(0, 0, 255, 0.6)';
  for (const wall of interior) {
    const { x1, y1, x2, y2 } = wall.boundingBox;
    ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
  }
  
  // Draw perimeter (green outline)
  if (perimeter && perimeter.vertices) {
    ctx.strokeStyle = '#00FF00';
    ctx.lineWidth = 3;
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
  }
  
  // Add legend
  ctx.font = '14px Arial';
  
  ctx.fillStyle = '#FF0000';
  ctx.fillRect(10, 10, 20, 20);
  ctx.fillStyle = '#000000';
  ctx.fillText('Exterior Walls', 35, 25);
  
  ctx.fillStyle = '#0000FF';
  ctx.fillRect(10, 40, 20, 20);
  ctx.fillStyle = '#000000';
  ctx.fillText('Interior Walls', 35, 55);
  
  if (perimeter && perimeter.vertices) {
    ctx.strokeStyle = '#00FF00';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(10, 80);
    ctx.lineTo(30, 80);
    ctx.stroke();
    ctx.fillStyle = '#000000';
    ctx.fillText('Perimeter', 35, 85);
  }
  
  return canvas;
}

/**
 * Create overlay on original image
 */
function createOverlay(image, exterior, interior, perimeter) {
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext('2d');
  
  // Draw original image (slightly faded)
  ctx.globalAlpha = 0.5;
  ctx.drawImage(image, 0, 0);
  ctx.globalAlpha = 1.0;
  
  // Draw exterior walls (red)
  ctx.strokeStyle = '#FF0000';
  ctx.lineWidth = 3;
  for (const wall of exterior) {
    const { x1, y1, x2, y2 } = wall.boundingBox;
    ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
  }
  
  // Draw interior walls (blue)
  ctx.strokeStyle = '#0000FF';
  ctx.lineWidth = 2;
  for (const wall of interior) {
    const { x1, y1, x2, y2 } = wall.boundingBox;
    ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
  }
  
  // Draw perimeter (green)
  if (perimeter && perimeter.vertices) {
    ctx.strokeStyle = '#00FF00';
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
  }
  
  return canvas;
}

/**
 * Generate HTML report
 */
function generateHTMLReport(analysis, inputs) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Wall Detection Test Report - ${analysis.timestamp}</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      max-width: 1200px;
      margin: 0 auto;
      padding: 20px;
      background: #f5f5f5;
    }
    .header {
      background: #2c3e50;
      color: white;
      padding: 20px;
      border-radius: 5px;
      margin-bottom: 20px;
    }
    .section {
      background: white;
      padding: 20px;
      margin-bottom: 20px;
      border-radius: 5px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    h1, h2 { margin-top: 0; }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th, td {
      padding: 10px;
      text-align: left;
      border-bottom: 1px solid #ddd;
    }
    th {
      background: #34495e;
      color: white;
    }
    .images {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 20px;
    }
    .image-card {
      border: 1px solid #ddd;
      border-radius: 5px;
      overflow: hidden;
    }
    .image-card img {
      width: 100%;
      height: auto;
      display: block;
    }
    .image-card .title {
      padding: 10px;
      background: #ecf0f1;
      font-weight: bold;
    }
    .metric {
      display: inline-block;
      padding: 10px 20px;
      margin: 5px;
      background: #3498db;
      color: white;
      border-radius: 5px;
    }
    pre {
      background: #f8f8f8;
      padding: 15px;
      border-radius: 5px;
      overflow-x: auto;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>Wall Detection Test Report</h1>
    <p>Test Run: ${analysis.timestamp}</p>
    <p>Processing Time: ${analysis.processingTime}ms</p>
  </div>

  <div class="section">
    <h2>Results Summary</h2>
    <div class="metric">Total Walls: ${analysis.wallCounts.total}</div>
    <div class="metric">Horizontal: ${analysis.wallCounts.horizontal}</div>
    <div class="metric">Vertical: ${analysis.wallCounts.vertical}</div>
    <div class="metric">Exterior: ${analysis.wallCounts.exterior}</div>
    <div class="metric">Interior: ${analysis.wallCounts.interior}</div>
  </div>

  ${analysis.wallStatistics ? `
  <div class="section">
    <h2>Wall Statistics</h2>
    <table>
      <tr>
        <th>Metric</th>
        <th>Minimum</th>
        <th>Average</th>
        <th>Maximum</th>
      </tr>
      <tr>
        <td><strong>Length (px)</strong></td>
        <td>${analysis.wallStatistics.length.min}</td>
        <td>${analysis.wallStatistics.length.avg}</td>
        <td>${analysis.wallStatistics.length.max}</td>
      </tr>
      <tr>
        <td><strong>Thickness (px)</strong></td>
        <td>${analysis.wallStatistics.thickness.min}</td>
        <td>${analysis.wallStatistics.thickness.avg}</td>
        <td>${analysis.wallStatistics.thickness.max}</td>
      </tr>
    </table>
  </div>
  ` : ''}

  <div class="section">
    <h2>Visualizations</h2>
    <div class="images">
      <div class="image-card">
        <img src="1-original.png" alt="Original">
        <div class="title">Original Image</div>
      </div>
      <div class="image-card">
        <img src="2-all-walls.png" alt="All Walls">
        <div class="title">All Detected Walls</div>
      </div>
      <div class="image-card">
        <img src="3-exterior-walls.png" alt="Exterior">
        <div class="title">Exterior Walls</div>
      </div>
      <div class="image-card">
        <img src="4-interior-walls.png" alt="Interior">
        <div class="title">Interior Walls</div>
      </div>
      <div class="image-card">
        <img src="5-combined.png" alt="Combined">
        <div class="title">Combined View</div>
      </div>
      <div class="image-card">
        <img src="6-overlay.png" alt="Overlay">
        <div class="title">Overlay on Original</div>
      </div>
    </div>
  </div>

  <div class="section">
    <h2>Input Configuration</h2>
    <pre>${JSON.stringify(inputs, null, 2)}</pre>
  </div>

  <div class="section">
    <h2>Full Analysis Data</h2>
    <pre>${JSON.stringify(analysis, null, 2)}</pre>
  </div>
</body>
</html>`;
}

// Run the test
runTest().catch(console.error);
