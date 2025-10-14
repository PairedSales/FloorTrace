/**
 * Automated Test Runner for 40 Thick Wall Detection Tests
 * Runs all configurations automatically and saves results with parameters and visualizations
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
const { testConfigurations } = await import('./test-configurations-thick-walls-40.js');
const { preprocessImage } = await import('../src/utils/imagePreprocessor.js');
const { detectThickWalls, mergeThickWalls } = await import('../src/utils/thickWallDetector.js');
const {
  visualizeGrayscale,
  visualizeBinary,
  visualizeThickWalls
} = await import('../src/utils/wallTestVisualizations.js');

// Create output directory with timestamp
const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
const outputDir = path.join(__dirname, 'test visualizations', `thick_walls_40_tests_${timestamp}`);
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
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; margin: 0; padding: 20px; background: #f5f7fa; }
    .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 12px; margin-bottom: 25px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
    h1 { margin: 0 0 10px 0; font-size: 28px; font-weight: 600; }
    .description { opacity: 0.95; font-size: 16px; line-height: 1.5; }
    .section { background: white; padding: 25px; border-radius: 12px; margin-bottom: 25px; box-shadow: 0 2px 4px rgba(0,0,0,0.08); }
    .section h2 { margin-top: 0; color: #2d3748; font-size: 20px; font-weight: 600; border-bottom: 2px solid #667eea; padding-bottom: 12px; margin-bottom: 20px; }
    .metrics-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 15px; margin-top: 15px; }
    .metric-card { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 20px; border-radius: 10px; text-align: center; box-shadow: 0 2px 8px rgba(102,126,234,0.3); }
    .metric-label { font-size: 11px; color: rgba(255,255,255,0.85); text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 8px; font-weight: 500; }
    .metric-value { font-size: 28px; font-weight: 700; color: white; }
    .params-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 15px; }
    .param-item { background: #f7fafc; padding: 15px; border-radius: 8px; border-left: 4px solid #667eea; transition: all 0.2s; }
    .param-item:hover { background: #edf2f7; transform: translateX(2px); }
    .param-label { font-weight: 600; color: #2d3748; font-size: 13px; margin-bottom: 6px; }
    .param-value { color: #4a5568; font-size: 18px; font-weight: 500; }
    .viz-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(450px, 1fr)); gap: 20px; }
    .viz-card { background: white; border-radius: 10px; overflow: hidden; box-shadow: 0 4px 8px rgba(0,0,0,0.1); transition: transform 0.2s; }
    .viz-card:hover { transform: translateY(-4px); box-shadow: 0 6px 12px rgba(0,0,0,0.15); }
    .viz-header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 15px; font-weight: 600; font-size: 14px; }
    .viz-content { padding: 15px; background: #fafafa; }
    .viz-content img { width: 100%; height: auto; border: 2px solid #e2e8f0; border-radius: 6px; }
    .test-number { background: rgba(255,255,255,0.2); display: inline-block; padding: 5px 15px; border-radius: 20px; font-size: 14px; margin-bottom: 10px; }
  </style>
</head>
<body>
  <div class="header">
    <div class="test-number">Test ${testNumber} of 40</div>
    <h1>${config.name}</h1>
    <div class="description">${config.description}</div>
  </div>

  <div class="section">
    <h2>📊 Detection Results</h2>
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
        <div class="metric-label">Horizontal</div>
        <div class="metric-value">${metrics.horizontalWalls || 0}</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Vertical</div>
        <div class="metric-value">${metrics.verticalWalls || 0}</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Avg Thickness</div>
        <div class="metric-value">${metrics.avgThickness || 0}<span style="font-size:16px">px</span></div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Avg Length</div>
        <div class="metric-value">${metrics.avgLength || 0}<span style="font-size:16px">px</span></div>
      </div>
    </div>
  </div>

  <div class="section">
    <h2>⚙️ Test Parameters</h2>
    <div class="params-grid">
      <div class="param-item">
        <div class="param-label">Min Wall Length</div>
        <div class="param-value">${config.params.minWallLength}px</div>
      </div>
      <div class="param-item">
        <div class="param-label">Min Thickness</div>
        <div class="param-value">${config.params.minThickness}px</div>
      </div>
      <div class="param-item">
        <div class="param-label">Max Thickness</div>
        <div class="param-value">${config.params.maxThickness}px</div>
      </div>
      <div class="param-item">
        <div class="param-label">Max Parallel Separation</div>
        <div class="param-value">${config.params.maxParallelSeparation}px</div>
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
        <div class="param-label">Adaptive Window Size</div>
        <div class="param-value">${config.params.adaptiveWindowSize}px</div>
      </div>
      <div class="param-item">
        <div class="param-label">Adaptive C</div>
        <div class="param-value">${config.params.adaptiveC}</div>
      </div>
      <div class="param-item">
        <div class="param-label">Closing Kernel Size</div>
        <div class="param-value">${config.params.closingKernelSize}px</div>
      </div>
      <div class="param-item">
        <div class="param-label">Min Final Length</div>
        <div class="param-value">${config.params.minFinalLength}px</div>
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
  console.log(`\n[${'='.repeat(60)}]`);
  console.log(`  Test ${testNumber}/40: ${config.name}`);
  console.log(`  ${config.description}`);
  console.log(`[${'='.repeat(60)}]`);
  
  const testDir = path.join(outputDir, `test_${testNumber.toString().padStart(2, '0')}_${config.name.replace(/[^a-z0-9]/gi, '_')}`);
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
    console.log('  → Preprocessing image...');
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
      name: '2. Binary (After Preprocessing)',
      dataUrl: visualizeBinary(preprocessed.binary, width, height)
    });
    
    // Step 2: Detect Thick Walls (solid + irregular parallel lines)
    console.log('  → Detecting thick walls...');
    let walls = detectThickWalls(preprocessed.binary, width, height, {
      minWallLength: config.params.minWallLength,
      minThickness: config.params.minThickness,
      maxThickness: config.params.maxThickness,
      minAspectRatio: 3,
      maxParallelSeparation: config.params.maxParallelSeparation
    });
    
    results.metrics.initialWalls = walls.length;
    const initialThickness = walls.length > 0 
      ? walls.reduce((sum, w) => sum + w.thickness, 0) / walls.length 
      : 0;
    results.metrics.avgInitialThickness = Math.round(initialThickness * 10) / 10;
    
    visualizations.push({
      name: '3. Detected Thick Walls (Initial)',
      dataUrl: visualizeThickWalls(walls, width, height)
    });
    
    // Step 3: Merge nearby walls (for dashed walls)
    console.log('  → Merging dashed walls...');
    walls = mergeThickWalls(walls, {
      maxDistance: config.params.mergeMaxGap,
      maxGap: config.params.maxGapLength
    });
    
    results.metrics.afterMerge = walls.length;
    
    visualizations.push({
      name: '4. After Merging Dashed Walls',
      dataUrl: visualizeThickWalls(walls, width, height)
    });
    
    // Step 4: Filter by minimum final length
    console.log('  → Filtering by length...');
    const minFinalLength = config.params.minFinalLength;
    walls = walls.filter(w => w.length >= minFinalLength);
    
    results.metrics.finalWalls = walls.length;
    
    // Calculate final statistics
    if (walls.length > 0) {
      const horizontal = walls.filter(w => w.isHorizontal);
      const vertical = walls.filter(w => !w.isHorizontal);
      const avgThickness = walls.reduce((sum, w) => sum + w.thickness, 0) / walls.length;
      const avgLength = walls.reduce((sum, w) => sum + w.length, 0) / walls.length;
      
      results.metrics.horizontalWalls = horizontal.length;
      results.metrics.verticalWalls = vertical.length;
      results.metrics.avgThickness = Math.round(avgThickness * 10) / 10;
      results.metrics.avgLength = Math.round(avgLength);
      results.metrics.minThickness = Math.min(...walls.map(w => w.thickness)).toFixed(1);
      results.metrics.maxThickness = Math.max(...walls.map(w => w.thickness)).toFixed(1);
      results.metrics.minLength = Math.round(Math.min(...walls.map(w => w.length)));
      results.metrics.maxLength = Math.round(Math.max(...walls.map(w => w.length)));
    } else {
      results.metrics.horizontalWalls = 0;
      results.metrics.verticalWalls = 0;
      results.metrics.avgThickness = 0;
      results.metrics.avgLength = 0;
    }
    
    visualizations.push({
      name: '5. Final Thick Walls',
      dataUrl: visualizeThickWalls(walls, width, height)
    });
    
    results.duration = Date.now() - startTime;
    results.status = 'success';
    
    // Create HTML report
    createHTMLReport(testDir, config, testNumber, visualizations, results.metrics);
    
    console.log(`  ✓ Completed in ${results.duration}ms`);
    console.log(`    Pipeline: ${results.metrics.initialWalls} → ${results.metrics.afterMerge} → ${results.metrics.finalWalls} walls`);
    console.log(`    Final: ${results.metrics.horizontalWalls} horiz, ${results.metrics.verticalWalls} vert`);
    console.log(`    Stats: Thickness ${results.metrics.avgThickness}px, Length ${results.metrics.avgLength}px`);
    
  } catch (error) {
    console.error(`  ✗ Error: ${error.message}`);
    console.error(error.stack);
    results.status = 'failed';
    results.error = error.message;
    results.errorStack = error.stack;
  }
  
  // Save parameters and results as JSON
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

// Create master index HTML
function createMasterIndex(allResults, imageSize) {
  const successful = allResults.filter(r => r.status === 'success');
  const failed = allResults.filter(r => r.status === 'failed');
  
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Thick Wall Detection - 40 Tests Results</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; margin: 0; padding: 20px; background: #f5f7fa; }
    .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 40px; border-radius: 12px; margin-bottom: 30px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
    h1 { margin: 0 0 10px 0; font-size: 32px; font-weight: 700; }
    .subtitle { opacity: 0.95; font-size: 18px; }
    .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 30px; }
    .summary-card { background: white; padding: 25px; border-radius: 12px; text-align: center; box-shadow: 0 2px 4px rgba(0,0,0,0.08); }
    .summary-value { font-size: 36px; font-weight: 700; color: #667eea; margin-bottom: 8px; }
    .summary-label { font-size: 13px; color: #718096; text-transform: uppercase; letter-spacing: 0.5px; }
    .tests-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 20px; }
    .test-card { background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1); transition: all 0.3s; }
    .test-card:hover { transform: translateY(-4px); box-shadow: 0 6px 16px rgba(0,0,0,0.15); }
    .test-card.failed { opacity: 0.6; }
    .test-header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; }
    .test-number { font-size: 12px; opacity: 0.9; margin-bottom: 5px; }
    .test-name { font-size: 18px; font-weight: 600; margin-bottom: 8px; }
    .test-desc { font-size: 13px; opacity: 0.9; line-height: 1.4; }
    .test-body { padding: 20px; }
    .test-metrics { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-bottom: 15px; }
    .metric-small { text-align: center; padding: 10px; background: #f7fafc; border-radius: 6px; }
    .metric-small-value { font-size: 20px; font-weight: 700; color: #667eea; }
    .metric-small-label { font-size: 11px; color: #718096; margin-top: 4px; }
    .test-link { display: block; text-align: center; padding: 12px; background: #667eea; color: white; text-decoration: none; border-radius: 6px; font-weight: 600; transition: background 0.2s; }
    .test-link:hover { background: #5568d3; }
    .section-title { font-size: 24px; font-weight: 600; color: #2d3748; margin: 40px 0 20px 0; }
    .status-badge { display: inline-block; padding: 4px 12px; border-radius: 12px; font-size: 11px; font-weight: 600; text-transform: uppercase; }
    .status-success { background: #c6f6d5; color: #22543d; }
    .status-failed { background: #fed7d7; color: #742a2a; }
  </style>
</head>
<body>
  <div class="header">
    <h1>🏗️ Thick Wall Detection Test Suite</h1>
    <div class="subtitle">Comprehensive parameter exploration with 40 automated tests</div>
  </div>

  <div class="summary">
    <div class="summary-card">
      <div class="summary-value">${allResults.length}</div>
      <div class="summary-label">Total Tests</div>
    </div>
    <div class="summary-card">
      <div class="summary-value" style="color: #48bb78;">${successful.length}</div>
      <div class="summary-label">Successful</div>
    </div>
    <div class="summary-card">
      <div class="summary-value" style="color: #f56565;">${failed.length}</div>
      <div class="summary-label">Failed</div>
    </div>
    <div class="summary-card">
      <div class="summary-value">${imageSize.width}×${imageSize.height}</div>
      <div class="summary-label">Image Size</div>
    </div>
  </div>

  <div class="section-title">All Test Results</div>
  <div class="tests-grid">
    ${allResults.map(result => `
      <div class="test-card ${result.status === 'failed' ? 'failed' : ''}">
        <div class="test-header">
          <div class="test-number">Test #${result.testNumber}</div>
          <div class="test-name">${result.name}</div>
          <div class="test-desc">${result.description}</div>
        </div>
        <div class="test-body">
          ${result.status === 'success' ? `
            <div class="test-metrics">
              <div class="metric-small">
                <div class="metric-small-value">${result.metrics.finalWalls || 0}</div>
                <div class="metric-small-label">Final Walls</div>
              </div>
              <div class="metric-small">
                <div class="metric-small-value">${result.metrics.avgThickness || 0}<span style="font-size:12px">px</span></div>
                <div class="metric-small-label">Avg Thickness</div>
              </div>
              <div class="metric-small">
                <div class="metric-small-value">${result.metrics.horizontalWalls || 0}</div>
                <div class="metric-small-label">Horizontal</div>
              </div>
              <div class="metric-small">
                <div class="metric-small-value">${result.metrics.verticalWalls || 0}</div>
                <div class="metric-small-label">Vertical</div>
              </div>
            </div>
            <a href="test_${result.testNumber.toString().padStart(2, '0')}_${result.name.replace(/[^a-z0-9]/gi, '_')}/report.html" class="test-link">View Full Report →</a>
          ` : `
            <div style="color: #e53e3e; padding: 15px; background: #fff5f5; border-radius: 6px; font-size: 13px;">
              <strong>Error:</strong> ${result.error || 'Test failed'}
            </div>
          `}
        </div>
      </div>
    `).join('')}
  </div>

  <div style="margin-top: 40px; padding: 20px; background: white; border-radius: 12px; text-align: center; color: #718096;">
    <p>Generated on ${new Date().toLocaleString()}</p>
  </div>
</body>
</html>`;

  fs.writeFileSync(path.join(outputDir, 'index.html'), html);
}

// Main execution
async function main() {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║   Thick Wall Detection Test Runner - 40 Tests             ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');
  console.log(`Output directory: ${outputDir}\n`);
  
  // Load image once
  console.log('Loading test image...');
  const { imageData, width, height } = await loadTestImage();
  console.log(`✓ Image loaded: ${width}x${height}px\n`);
  
  // Run all tests
  const allResults = [];
  for (let i = 0; i < testConfigurations.length; i++) {
    const result = await runSingleTest(
      testConfigurations[i],
      i + 1,
      imageData,
      width,
      height
    );
    allResults.push(result);
  }
  
  // Create summary files
  console.log('\n\nGenerating summary reports...');
  
  // Master index HTML
  createMasterIndex(allResults, { width, height });
  
  // Summary JSON
  const summaryIndex = {
    totalTests: testConfigurations.length,
    timestamp: new Date().toISOString(),
    imageSize: { width, height },
    successful: allResults.filter(r => r.status === 'success').length,
    failed: allResults.filter(r => r.status === 'failed').length,
    tests: allResults.map((result, i) => ({
      testNumber: i + 1,
      name: result.name,
      description: result.description,
      status: result.status,
      metrics: result.metrics,
      parameters: result.parameters,
      duration: result.duration,
      directory: `test_${(i + 1).toString().padStart(2, '0')}_${result.name.replace(/[^a-z0-9]/gi, '_')}`
    }))
  };
  
  fs.writeFileSync(
    path.join(outputDir, 'test_summary.json'),
    JSON.stringify(summaryIndex, null, 2)
  );
  
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║   All Tests Completed!                                     ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');
  console.log(`✓ ${allResults.length} tests completed`);
  console.log(`✓ ${allResults.filter(r => r.status === 'success').length} successful`);
  console.log(`✓ ${allResults.filter(r => r.status === 'failed').length} failed`);
  console.log(`\n✓ Results saved to: ${outputDir}`);
  console.log(`✓ Open index.html to view all results\n`);
  
  // Print path to index
  console.log(`📄 Master Index: ${path.join(outputDir, 'index.html')}\n`);
}

main().catch(console.error);
