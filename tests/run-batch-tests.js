/**
 * Backend Batch Test Runner - Runs 25 tests automatically
 * Uses existing test infrastructure, runs on Node.js with jsdom
 */

import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Setup DOM environment with canvas support
const { createCanvas, Image: CanvasImage } = await import('@napi-rs/canvas');

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
  pretendToBeVisual: true,
  resources: 'usable'
});

/* eslint-disable no-undef */
global.document = dom.window.document;
global.window = dom.window;
global.Image = CanvasImage;

// Polyfill document.createElement to support canvas
const originalCreateElement = global.document.createElement.bind(global.document);
global.document.createElement = function(tagName) {
  if (tagName.toLowerCase() === 'canvas') {
    return createCanvas(100, 100); // Will be resized by the code
  }
  return originalCreateElement(tagName);
};
/* eslint-enable no-undef */

// Import test configurations and modules
const { testConfigurations } = await import('./test-configurations.js');
const { preprocessImage } = await import('../src/utils/imagePreprocessor.js');
const { detectThickWalls, mergeThickWalls } = await import('../src/utils/thickWallDetector.js');
const {
  visualizeGrayscale,
  visualizeBinary,
  visualizeThickWalls
} = await import('../src/utils/wallTestVisualizations.js');

// Create output directory
const outputDir = path.join(__dirname, 'test visualizations');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Load test image
async function loadTestImage() {
  const { loadImage } = await import('@napi-rs/canvas');
  const imagePath = path.join(__dirname, '..', 'ExampleFloorplan.png');
  
  const img = await loadImage(imagePath);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  
  return { imageData, width: canvas.width, height: canvas.height };
}

// Create HTML report for a test
function createHTMLReport(testDir, config, testNumber, visualizations, metrics) {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Test ${testNumber}: ${config.name}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
    .header { background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    h1 { margin: 0 0 10px 0; color: #333; }
    .description { color: #666; font-size: 16px; margin-bottom: 20px; }
    .section { background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .section h2 { margin-top: 0; color: #0066cc; border-bottom: 2px solid #0066cc; padding-bottom: 10px; }
    .params-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 15px; }
    .param-item { background: #f8f9fa; padding: 12px; border-radius: 4px; border-left: 3px solid #0066cc; }
    .param-label { font-weight: bold; color: #333; font-size: 14px; }
    .param-value { color: #666; font-size: 16px; margin-top: 4px; }
    .metrics-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-top: 15px; }
    .metric-card { background: #e7f3ff; padding: 15px; border-radius: 6px; text-align: center; }
    .metric-label { font-size: 12px; color: #666; text-transform: uppercase; letter-spacing: 0.5px; }
    .metric-value { font-size: 24px; font-weight: bold; color: #0066cc; margin-top: 5px; }
    .viz-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 20px; }
    .viz-card { background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .viz-header { background: #0066cc; color: white; padding: 12px; font-weight: bold; }
    .viz-content { padding: 10px; background: #fafafa; }
    .viz-content img { width: 100%; height: auto; border: 1px solid #ddd; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Test ${testNumber}: ${config.name}</h1>
    <div class="description">${config.description}</div>
  </div>

  <div class="section">
    <h2>📊 Results Metrics - Thick Walls</h2>
    <div class="metrics-grid">
      <div class="metric-card">
        <div class="metric-label">Initial Walls</div>
        <div class="metric-value">${metrics.initialWalls || 0}</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">After Merge</div>
        <div class="metric-value">${metrics.afterMerge || 0}</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Final Walls</div>
        <div class="metric-value">${metrics.finalWalls || 0}</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Avg Thickness</div>
        <div class="metric-value">${metrics.avgThickness || 0}px</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Avg Length</div>
        <div class="metric-value">${metrics.avgLength || 0}px</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Horizontal</div>
        <div class="metric-value">${metrics.horizontalWalls || 0}</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Vertical</div>
        <div class="metric-value">${metrics.verticalWalls || 0}</div>
      </div>
    </div>
  </div>

  <div class="section">
    <h2>⚙️ Test Parameters</h2>
    <div class="params-grid">
      <div class="param-item">
        <div class="param-label">Edge Threshold %</div>
        <div class="param-value">${config.params.edgeThresholdPercent}%</div>
      </div>
      <div class="param-item">
        <div class="param-label">Min Edge Threshold</div>
        <div class="param-value">${config.params.minEdgeThreshold}</div>
      </div>
      <div class="param-item">
        <div class="param-label">Min Wall Length</div>
        <div class="param-value">${config.params.minWallLength}px</div>
      </div>
      <div class="param-item">
        <div class="param-label">Min Line Score</div>
        <div class="param-value">${config.params.minLineScore}</div>
      </div>
      <div class="param-item">
        <div class="param-label">Closing Kernel Size</div>
        <div class="param-value">${config.params.closingKernelSize}px</div>
      </div>
      <div class="param-item">
        <div class="param-label">Merge Max Gap</div>
        <div class="param-value">${config.params.mergeMaxGap}px</div>
      </div>
      <div class="param-item">
        <div class="param-label">Max Gap Length</div>
        <div class="param-value">${config.params.maxGapLength}px</div>
      </div>
      <div class="param-item">
        <div class="param-label">Min Final Length</div>
        <div class="param-value">${config.params.minFinalLength}px</div>
      </div>
      <div class="param-item">
        <div class="param-label">Adaptive Window Size</div>
        <div class="param-value">${config.params.adaptiveWindowSize}px</div>
      </div>
      <div class="param-item">
        <div class="param-label">Adaptive C</div>
        <div class="param-value">${config.params.adaptiveC}</div>
      </div>
      <div class="param-item">
        <div class="param-label">Fill Gaps</div>
        <div class="param-value">${config.params.fillGaps ? 'Yes' : 'No'}</div>
      </div>
      <div class="param-item">
        <div class="param-label">Orientation Constraints</div>
        <div class="param-value">${config.params.orientationConstraints ? 'Yes' : 'No'}</div>
      </div>
    </div>
  </div>

  <div class="section">
    <h2>🎨 Visualizations</h2>
    <div class="viz-grid">
      ${visualizations.map(viz => `
        <div class="viz-card">
          <div class="viz-header">${viz.name}</div>
          <div class="viz-content">
            <img src="${viz.dataUrl}" alt="${viz.name}">
          </div>
        </div>
      `).join('')}
    </div>
  </div>
</body>
</html>`;

  fs.writeFileSync(path.join(testDir, 'report.html'), html);
}

// Run single test configuration
async function runSingleTest(config, testNumber, imageData, width, height) {
  console.log(`\n[${testNumber}/25] Running: ${config.name}`);
  console.log(`  Description: ${config.description}`);
  
  const testDir = path.join(outputDir, `test_${testNumber.toString().padStart(2, '0')}_${config.name}`);
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }
  
  const startTime = Date.now();
  const visualizations = [];
  const results = {
    testNumber,
    name: config.name,
    description: config.description,
    parameters: config.params,
    timestamp: new Date().toISOString(),
    metrics: {}
  };
  
  try {
    // Step 1: Preprocessing
    const preprocessed = preprocessImage(imageData, {
      thresholdMethod: 'adaptive',
      adaptiveWindowSize: config.params.adaptiveWindowSize,
      adaptiveC: config.params.adaptiveC,
      globalThresholdValue: 128,
      removeNoise: true,
      minComponentSize: 15,
      useClosing: true,
      closingKernelSize: config.params.closingKernelSize
    });
    
    visualizations.push({
      name: '1. Grayscale',
      dataUrl: visualizeGrayscale(preprocessed.grayscale, width, height)
    });
    
    visualizations.push({
      name: '2. Binary (Thick Walls)',
      dataUrl: visualizeBinary(preprocessed.binary, width, height)
    });
    
    // Step 2: Detect Thick Walls (solid + irregular parallel lines)
    let walls = detectThickWalls(preprocessed.binary, width, height, {
      minWallLength: config.params.minWallLength,
      minThickness: config.params.minThickness || 2,
      maxThickness: config.params.maxThickness || 30,
      minAspectRatio: 3,
      maxParallelSeparation: config.params.maxParallelSeparation || 30
    });
    
    results.metrics.initialWalls = walls.length;
    const initialThickness = walls.reduce((sum, w) => sum + w.thickness, 0) / walls.length;
    results.metrics.avgInitialThickness = Math.round(initialThickness * 10) / 10;
    
    visualizations.push({
      name: '3. Detected Thick Walls',
      dataUrl: visualizeThickWalls(walls, width, height)
    });
    
    // Step 3: Merge nearby walls (for dashed walls)
    walls = mergeThickWalls(walls, {
      maxDistance: config.params.mergeMaxGap || 50,
      maxGap: config.params.maxGapLength || 100
    });
    
    results.metrics.afterMerge = walls.length;
    
    visualizations.push({
      name: '4. After Merging',
      dataUrl: visualizeThickWalls(walls, width, height)
    });
    
    // Step 4: Filter by length
    const minFinalLength = config.params.minFinalLength || config.params.minWallLength;
    walls = walls.filter(w => w.length >= minFinalLength);
    
    results.metrics.finalWalls = walls.length;
    
    // Calculate statistics
    const horizontal = walls.filter(w => w.isHorizontal);
    const vertical = walls.filter(w => !w.isHorizontal);
    const avgThickness = walls.reduce((sum, w) => sum + w.thickness, 0) / walls.length;
    const avgLength = walls.reduce((sum, w) => sum + w.length, 0) / walls.length;
    
    results.metrics.horizontalWalls = horizontal.length;
    results.metrics.verticalWalls = vertical.length;
    results.metrics.avgThickness = Math.round(avgThickness * 10) / 10;
    results.metrics.avgLength = Math.round(avgLength);
    
    visualizations.push({
      name: '5. Final Thick Walls',
      dataUrl: visualizeThickWalls(walls, width, height)
    });
    
    results.duration = Date.now() - startTime;
    results.status = 'success';
    
    // Create HTML report
    createHTMLReport(testDir, config, testNumber, visualizations, results.metrics);
    
    console.log(`  ✓ Completed in ${results.duration}ms - ${visualizations.length} visualizations saved`);
    console.log(`    Initial: ${results.metrics.initialWalls} | After Merge: ${results.metrics.afterMerge} | Final: ${results.metrics.finalWalls}`);
    console.log(`    Thickness: ${results.metrics.avgThickness}px | Horizontal: ${results.metrics.horizontalWalls} | Vertical: ${results.metrics.verticalWalls}`);
    
  } catch (error) {
    console.error(`  ✗ Error: ${error.message}`);
    results.status = 'failed';
    results.error = error.message;
  }
  
  // Save parameters and results
  fs.writeFileSync(
    path.join(testDir, 'parameters.json'),
    JSON.stringify({
      testNumber,
      name: config.name,
      description: config.description,
      parameters: config.params,
      timestamp: new Date().toISOString()
    }, null, 2)
  );
  
  fs.writeFileSync(
    path.join(testDir, 'results.json'),
    JSON.stringify(results, null, 2)
  );
  
  return results;
}

// Main execution
async function main() {
  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║   Thick Wall Detection Test Runner                    ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');
  console.log(`Output directory: ${outputDir}\n`);
  
  // Load image once
  console.log('Loading test image...');
  const { imageData, width, height } = await loadTestImage();
  console.log(`✓ Image loaded: ${width}x${height}px\n`);
  
  // Run all tests
  const allResults = [];
  const startingTestNumber = 1;
  for (let i = 0; i < testConfigurations.length; i++) {
    const result = await runSingleTest(
      testConfigurations[i],
      startingTestNumber + i,
      imageData,
      width,
      height
    );
    allResults.push(result);
  }
  
  // Create summary index
  const summaryIndex = {
    totalTests: testConfigurations.length,
    startingTestNumber: startingTestNumber,
    timestamp: new Date().toISOString(),
    imageSize: { width, height },
    tests: allResults,
    testConfigurations: testConfigurations.map((config, i) => ({
      testNumber: startingTestNumber + i,
      name: config.name,
      description: config.description,
      directory: `test_${(startingTestNumber + i).toString().padStart(2, '0')}_${config.name}`,
      parameters: config.params
    }))
  };
  
  fs.writeFileSync(
    path.join(outputDir, 'test_index_thick_walls.json'),
    JSON.stringify(summaryIndex, null, 2)
  );
  
  console.log('\n╔════════════════════════════════════════════════════════╗');
  console.log('║   All Tests Completed!                                 ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');
  console.log(`✓ ${allResults.length} tests completed with thick wall detection`);
  console.log(`✓ Results saved to: ${outputDir}`);
  console.log(`✓ Test index: ${path.join(outputDir, 'test_index_thick_walls.json')}\n`);
  
  // Success summary
  const successful = allResults.filter(r => r.status === 'success').length;
  const failed = allResults.filter(r => r.status === 'failed').length;
  console.log(`Success: ${successful} | Failed: ${failed}\n`);
}

main().catch(console.error);
