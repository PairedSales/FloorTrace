/**
 * Wall Detection Deep Testing Suite - Main Test Runner
 */

import { dataUrlToImage, imageToCanvas } from './src/utils/imageLoader.js';
import { preprocessImage } from './src/utils/imagePreprocessor.js';
import { segmentWalls } from './src/utils/wallSegmentation.js';
import { detectLineSegments, mergeCollinearSegments } from './src/utils/lineRefinement.js';
import { fillGapsInSegments } from './src/utils/gapFilling.js';
import { postProcessSegments } from './src/utils/wallPostProcessing.js';
import { detectWalls, findRoomFromWalls } from './src/utils/wallDetector.js';
import { detectAllDimensions } from './src/utils/roomDetector.js';
import {
  TestSuiteResult,
  TestStepResult,
  TestStatus,
  Validators,
  MetricsCalculators,
  TestLogger
} from './src/utils/wallTestUtilities.js';
import {
  visualizeGrayscale,
  visualizeBinary,
  visualizeLikelihoodHeatmap,
  visualizeLineSegments,
  visualizeSegmentsByOrientation,
  visualizeExteriorInterior,
  visualizePerimeter,
  visualizeRoomFinding
} from './src/utils/wallTestVisualizations.js';

let currentTestResults = null;
const logger = new TestLogger();

// Load test image
async function loadTestImage() {
  const response = await fetch('./ExampleFloorplan.png');
  const blob = await response.blob();
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}

// Update progress
function updateProgress(current, total) {
  const percent = (current / total * 100);
  const fill = document.querySelector('.progress-fill');
  if (fill) fill.style.width = percent + '%';
}

// Render test step
function renderTestStep(step) {
  let html = `
    <div class="test-step ${step.status}" id="step-${step.stepNumber}">
      <div class="step-header">
        <div class="step-title">${step.stepNumber}. ${step.stepName}</div>
        <div class="step-status ${step.status}">${step.status}</div>
      </div>
  `;
  
  if (step.status === TestStatus.RUNNING) {
    html += '<div class="loading"><div class="spinner"></div><p>Processing...</p></div>';
  }
  
  if (step.duration) {
    html += `<div class="metric-card"><div class="metric-label">Duration</div><div class="metric-value">${step.duration.toFixed(2)}ms</div></div>`;
  }
  
  // Metrics
  if (Object.keys(step.metrics).length > 0) {
    html += '<div class="metrics-grid">';
    for (const [key, metric] of Object.entries(step.metrics)) {
      html += `<div class="metric-card"><div class="metric-label">${key}</div><div class="metric-value">${metric.value}${metric.unit}</div></div>`;
    }
    html += '</div>';
  }
  
  // Assertions
  if (step.assertions.length > 0) {
    html += `<div class="collapsible" onclick="toggleCollapse(this)">Assertions (${step.assertions.length})</div>`;
    html += '<div class="assertions-list collapsible-content">';
    for (const a of step.assertions) {
      html += `
        <div class="assertion ${a.passed ? 'passed' : 'failed'}">
          <div>${a.passed ? '✅' : '❌'}</div>
          <div>
            <div class="assertion-name">${a.name}</div>
            <div class="assertion-details">Expected: ${a.expected} | Actual: ${a.actual}</div>
          </div>
        </div>
      `;
    }
    html += '</div>';
  }
  
  // Visualizations
  if (Object.keys(step.visualizations).length > 0) {
    html += `<div class="collapsible" onclick="toggleCollapse(this)">Visualizations (${Object.keys(step.visualizations).length})</div>`;
    html += '<div class="viz-grid collapsible-content">';
    for (const [name, dataUrl] of Object.entries(step.visualizations)) {
      html += `<div class="viz-card"><div class="viz-header">${name}</div><div class="viz-content"><img src="${dataUrl}"></div></div>`;
    }
    html += '</div>';
  }
  
  html += '</div>';
  return html;
}

// Toggle collapse
window.toggleCollapse = function(el) {
  el.classList.toggle('collapsed');
  el.nextElementSibling?.classList.toggle('hidden');
};

// Run test suite
async function runTestSuite() {
  const resultsDiv = document.getElementById('results');
  resultsDiv.innerHTML = `
    <div class="status-banner info">🔄 Running test suite...</div>
    <div class="progress-bar"><div class="progress-fill"></div></div>
    <div id="test-steps"></div>
  `;
  
  const stepsDiv = document.getElementById('test-steps');
  const suite = new TestSuiteResult('Wall Detection Pipeline');
  
  try {
    const config = {
      minWallLength: parseInt(document.getElementById('minWallLength').value),
      thresholdMethod: document.getElementById('thresholdMethod').value,
      maxGapLength: parseInt(document.getElementById('maxGapLength').value),
      minComponentSize: parseInt(document.getElementById('minComponentSize').value),
      closingKernelSize: parseInt(document.getElementById('closingKernelSize').value),
      fillGaps: document.getElementById('fillGaps').checked,
      orientationConstraints: document.getElementById('orientationConstraints').checked,
      runOCR: document.getElementById('runOCR').checked
    };
    
    const imageDataUrl = await loadTestImage();
    const img = await dataUrlToImage(imageDataUrl);
    const canvas = imageToCanvas(img);
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    const imageData = ctx.getImageData(0, 0, width, height);
    
    const totalSteps = config.runOCR ? 9 : 8;
    let current = 0;
    
    // Step 1: Preprocessing
    current++;
    updateProgress(current, totalSteps);
    const step1 = new TestStepResult('Preprocessing & Binarization', current);
    step1.start();
    stepsDiv.innerHTML += renderTestStep(step1);
    
    const preprocessed = preprocessImage(imageData, {
      thresholdMethod: config.thresholdMethod,
      removeNoise: true,
      minComponentSize: config.minComponentSize,
      useClosing: true,
      closingKernelSize: config.closingKernelSize
    });
    
    Validators.validatePreprocessing(preprocessed, imageData).forEach(a => step1.addAssertion(a));
    Object.entries(MetricsCalculators.preprocessingMetrics(preprocessed)).forEach(([k, v]) => step1.addMetric(k, v));
    step1.addVisualization('Grayscale', visualizeGrayscale(preprocessed.grayscale, width, height));
    step1.addVisualization('Binary', visualizeBinary(preprocessed.binary, width, height));
    step1.finish(preprocessed);
    document.getElementById(`step-${step1.stepNumber}`).outerHTML = renderTestStep(step1);
    suite.addStep(step1);
    
    // Step 2: Segmentation
    current++;
    updateProgress(current, totalSteps);
    const step2 = new TestStepResult('Wall Segmentation', current);
    step2.start();
    stepsDiv.innerHTML += renderTestStep(step2);
    
    const likelihood = await segmentWalls(preprocessed.grayscale, width, height, {
      useModel: false,
      useFallback: true
    });
    
    Validators.validateSegmentation(likelihood, width, height).forEach(a => step2.addAssertion(a));
    Object.entries(MetricsCalculators.segmentationMetrics(likelihood)).forEach(([k, v]) => step2.addMetric(k, v));
    step2.addVisualization('Likelihood Heatmap', visualizeLikelihoodHeatmap(likelihood, width, height));
    step2.finish(likelihood);
    document.getElementById(`step-${step2.stepNumber}`).outerHTML = renderTestStep(step2);
    suite.addStep(step2);
    
    // Step 3: Line Detection
    current++;
    updateProgress(current, totalSteps);
    const step3 = new TestStepResult('Line Detection', current);
    step3.start();
    stepsDiv.innerHTML += renderTestStep(step3);
    
    let segments = detectLineSegments(likelihood, width, height, {
      minLength: config.minWallLength,
      minScore: 0.2,
      maxGap: 10,
      orientationConstraint: config.orientationConstraints,
      angleTolerance: Math.PI / 12
    });
    
    Validators.validateLineDetection(segments, config.minWallLength).forEach(a => step3.addAssertion(a));
    Object.entries(MetricsCalculators.lineDetectionMetrics(segments)).forEach(([k, v]) => step3.addMetric(k, v));
    step3.addVisualization('Detected Lines', visualizeLineSegments(segments, width, height));
    step3.addVisualization('By Orientation', visualizeSegmentsByOrientation(segments, width, height));
    step3.finish(segments);
    document.getElementById(`step-${step3.stepNumber}`).outerHTML = renderTestStep(step3);
    suite.addStep(step3);
    
    // Step 4: Merge Collinear
    current++;
    updateProgress(current, totalSteps);
    const step4 = new TestStepResult('Collinear Merging', current);
    step4.start();
    stepsDiv.innerHTML += renderTestStep(step4);
    
    const beforeMerge = segments.length;
    segments = mergeCollinearSegments(segments, {
      maxDistance: 15,
      maxGap: 30,
      angleTolerance: 0.15
    });
    
    step4.addMetric('Before', beforeMerge);
    step4.addMetric('After', segments.length);
    step4.addMetric('Reduction', ((1 - segments.length / beforeMerge) * 100).toFixed(1) + '%');
    step4.addVisualization('After Merging', visualizeLineSegments(segments, width, height));
    step4.finish(segments);
    document.getElementById(`step-${step4.stepNumber}`).outerHTML = renderTestStep(step4);
    suite.addStep(step4);
    
    // Step 5: Gap Filling
    if (config.fillGaps) {
      current++;
      updateProgress(current, totalSteps);
      const step5 = new TestStepResult('Gap Filling', current);
      step5.start();
      stepsDiv.innerHTML += renderTestStep(step5);
      
      const beforeGap = segments.length;
      segments = fillGapsInSegments(segments, {
        maxGapLength: config.maxGapLength,
        alignmentTolerance: 10,
        angleTolerance: 0.1
      });
      
      Validators.validateGapFilling([...Array(beforeGap)], segments).forEach(a => step5.addAssertion(a));
      step5.addMetric('Before', beforeGap);
      step5.addMetric('After', segments.length);
      step5.addVisualization('After Gap Filling', visualizeLineSegments(segments, width, height));
      step5.finish(segments);
      document.getElementById(`step-${step5.stepNumber}`).outerHTML = renderTestStep(step5);
      suite.addStep(step5);
    }
    
    // Step 6: Post-Processing
    current++;
    updateProgress(current, totalSteps);
    const step6 = new TestStepResult('Post-Processing & Classification', current);
    step6.start();
    stepsDiv.innerHTML += renderTestStep(step6);
    
    const processed = postProcessSegments(segments, width, height, {
      minLength: config.minWallLength,
      enforceOrientation: config.orientationConstraints,
      allowedOrientations: ['horizontal', 'vertical'],
      angleTolerance: Math.PI / 12,
      removeIsolated: false, // Disabled - too aggressive
      connectionThreshold: 25,
      snapGrid: true,
      gridSize: 5,
      snapOrientation: true,
      removeDups: true,
      duplicateThreshold: 10,
      applyConstraints: false, // Disabled to avoid over-filtering
      classifyExterior: true
    });
    
    Validators.validatePostProcessing(processed).forEach(a => step6.addAssertion(a));
    Object.entries(MetricsCalculators.postProcessingMetrics(processed)).forEach(([k, v]) => step6.addMetric(k, v));
    step6.finish(processed);
    document.getElementById(`step-${step6.stepNumber}`).outerHTML = renderTestStep(step6);
    suite.addStep(step6);
    
    // Step 7: Full Pipeline Test
    current++;
    updateProgress(current, totalSteps);
    const step7 = new TestStepResult('Complete Pipeline Integration', current);
    step7.start();
    stepsDiv.innerHTML += renderTestStep(step7);
    
    const wallData = await detectWalls(imageDataUrl, {
      minWallLength: config.minWallLength,
      thresholdMethod: config.thresholdMethod,
      orientationConstraints: config.orientationConstraints,
      fillGaps: config.fillGaps,
      maxGapLength: config.maxGapLength
    });
    
    step7.addMetric('Total Walls', wallData.allWalls.length);
    step7.addMetric('Horizontal', wallData.horizontal.length);
    step7.addMetric('Vertical', wallData.vertical.length);
    step7.addMetric('Exterior', wallData.exterior.length);
    step7.addMetric('Interior', wallData.interior.length);
    
    if (wallData.exterior && wallData.interior) {
      step7.addVisualization('Exterior/Interior', visualizeExteriorInterior(
        wallData.exterior,
        wallData.interior,
        width,
        height
      ));
    }
    
    if (wallData.perimeter) {
      Validators.validatePerimeter(wallData.perimeter, width, height).forEach(a => step7.addAssertion(a));
      step7.addVisualization('Perimeter', visualizePerimeter(wallData.perimeter, width, height));
    }
    
    step7.finish(wallData);
    document.getElementById(`step-${step7.stepNumber}`).outerHTML = renderTestStep(step7);
    suite.addStep(step7);
    
    // Step 8: Room Finding (if OCR enabled)
    if (config.runOCR) {
      current++;
      updateProgress(current, totalSteps);
      const step8 = new TestStepResult('Room Finding with OCR', current);
      step8.start();
      stepsDiv.innerHTML += renderTestStep(step8);
      
      const { dimensions } = await detectAllDimensions(imageDataUrl);
      const rooms = dimensions.map(dim => findRoomFromWalls(wallData, dim.bbox));
      
      Validators.validateRoomFinding(wallData, dimensions, rooms).forEach(a => step8.addAssertion(a));
      step8.addMetric('Dimensions Found', dimensions.length);
      step8.addMetric('Rooms Found', rooms.filter(r => r !== null).length);
      
      const roomViz = await visualizeRoomFinding(imageDataUrl, wallData, dimensions, rooms, width, height);
      step8.addVisualization('Room Finding Results', roomViz);
      
      step8.finish({ dimensions, rooms });
      document.getElementById(`step-${step8.stepNumber}`).outerHTML = renderTestStep(step8);
      suite.addStep(step8);
    }
    
    // Finish and show summary
    suite.finish();
    const summary = suite.getSummary();
    
    let summaryHTML = `
      <h2 class="section-title">Test Summary</h2>
      <div class="status-banner ${summary.overallStatus === TestStatus.PASSED ? 'success' : summary.overallStatus === TestStatus.WARNING ? 'warning' : 'error'}">
        ${summary.overallStatus === TestStatus.PASSED ? '✅' : summary.overallStatus === TestStatus.WARNING ? '⚠️' : '❌'}
        Test Suite ${summary.overallStatus} - ${summary.successRate}% success rate
      </div>
      <div class="summary-grid">
        <div class="summary-card">
          <div class="summary-label">Total Steps</div>
          <div class="summary-value">${summary.totalSteps}</div>
        </div>
        <div class="summary-card">
          <div class="summary-label">Passed</div>
          <div class="summary-value">${summary.passed}</div>
        </div>
        <div class="summary-card">
          <div class="summary-label">Failed</div>
          <div class="summary-value">${summary.failed}</div>
        </div>
        <div class="summary-card">
          <div class="summary-label">Warnings</div>
          <div class="summary-value">${summary.warnings}</div>
        </div>
        <div class="summary-card">
          <div class="summary-label">Duration</div>
          <div class="summary-value">${(summary.totalDuration / 1000).toFixed(2)}s</div>
        </div>
      </div>
    `;
    
    resultsDiv.innerHTML = summaryHTML + stepsDiv.outerHTML;
    currentTestResults = suite;
    
  } catch (error) {
    resultsDiv.innerHTML += `
      <div class="status-banner error">
        ❌ Test suite failed: ${error.message}
        <pre>${error.stack}</pre>
      </div>
    `;
    console.error('Test error:', error);
  }
}

// Export results
function exportResults() {
  if (!currentTestResults) {
    alert('No test results to export. Run a test first.');
    return;
  }
  
  const report = {
    timestamp: new Date().toISOString(),
    suiteName: currentTestResults.suiteName,
    summary: currentTestResults.getSummary(),
    steps: currentTestResults.steps.map(step => ({
      stepNumber: step.stepNumber,
      stepName: step.stepName,
      status: step.status,
      duration: step.duration,
      metrics: step.metrics,
      assertions: step.assertions.map(a => ({
        name: a.name,
        passed: a.passed,
        expected: a.expected,
        actual: a.actual
      })),
      warnings: step.warnings,
      errors: step.errors
    })),
    logs: logger.getLogs()
  };
  
  const json = JSON.stringify(report, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `wall-detection-test-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// Clear results
function clearResults() {
  document.getElementById('results').innerHTML = '';
  currentTestResults = null;
}

// Event listeners
document.getElementById('runTest').addEventListener('click', () => {
  document.getElementById('runTest').disabled = true;
  runTestSuite().finally(() => {
    document.getElementById('runTest').disabled = false;
  });
});

document.getElementById('exportResults').addEventListener('click', exportResults);
document.getElementById('clearResults').addEventListener('click', clearResults);

// Auto-run on load
window.addEventListener('load', () => {
  console.log('Wall Detection Test Suite Ready');
  setTimeout(() => {
    document.getElementById('runTest').click();
  }, 500);
});
