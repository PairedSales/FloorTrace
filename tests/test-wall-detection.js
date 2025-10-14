/**
 * Wall Detection Deep Testing Suite - Main Test Runner
 */

import { dataUrlToImage, imageToCanvas } from '../src/utils/imageLoader.js';
import { preprocessImage } from '../src/utils/imagePreprocessor.js';
import { segmentWalls } from '../src/utils/wallSegmentation.js';
import { detectLineSegments, mergeCollinearSegments } from '../src/utils/lineRefinement.js';
import { fillGapsInSegments } from '../src/utils/gapFilling.js';
import { postProcessSegments } from '../src/utils/wallPostProcessing.js';
import { detectWalls, findRoomFromWalls } from '../src/utils/wallDetector.js';
import { detectAllDimensions } from '../src/utils/roomDetector.js';
import {
  TestSuiteResult,
  TestStepResult,
  TestStatus,
  Validators,
  MetricsCalculators,
  TestLogger
} from '../src/utils/wallTestUtilities.js';
import {
  visualizeGrayscale,
  visualizeBinary,
  visualizeLikelihoodHeatmap,
  visualizeLineSegments,
  visualizeSegmentsByOrientation,
  visualizeExteriorInterior,
  visualizePerimeter,
  visualizeRoomFinding
} from '../src/utils/wallTestVisualizations.js';

let currentTestResults = null;
const logger = new TestLogger();

// Test History Management
const MAX_HISTORY_ITEMS = 15;
let testHistory = [];
let testCounter = 0;

// Get current settings as object
function getCurrentSettings() {
  return {
    // Preprocessing
    thresholdMethod: document.getElementById('thresholdMethod').value,
    adaptiveWindowSize: parseInt(document.getElementById('adaptiveWindowSize').value),
    adaptiveC: parseInt(document.getElementById('adaptiveC').value),
    globalThresholdValue: parseInt(document.getElementById('globalThresholdValue').value),
    closingKernelSize: parseInt(document.getElementById('closingKernelSize').value),
    minComponentSize: parseInt(document.getElementById('minComponentSize').value),
    useClosing: document.getElementById('useClosing').checked,
    removeNoise: document.getElementById('removeNoise').checked,
    
    // Line Detection
    edgeThresholdPercent: parseFloat(document.getElementById('edgeThresholdPercent').value),
    minEdgeThreshold: parseFloat(document.getElementById('minEdgeThreshold').value),
    minWallLength: parseInt(document.getElementById('minWallLength').value),
    minLineScore: parseFloat(document.getElementById('minLineScore').value),
    minChainLength: parseInt(document.getElementById('minChainLength').value),
    
    // Merging
    mergeMaxDistance: parseInt(document.getElementById('mergeMaxDistance').value),
    mergeMaxGap: parseInt(document.getElementById('mergeMaxGap').value),
    mergeAngleTolerance: parseFloat(document.getElementById('mergeAngleTolerance').value),
    
    // Gap Filling
    maxGapLength: parseInt(document.getElementById('maxGapLength').value),
    gapAngleTolerance: parseFloat(document.getElementById('gapAngleTolerance').value),
    gapMaxOffset: parseInt(document.getElementById('gapMaxOffset').value),
    fillGaps: document.getElementById('fillGaps').checked,
    
    // Post-Processing
    minFinalLength: parseInt(document.getElementById('minFinalLength').value),
    maxFinalLength: parseInt(document.getElementById('maxFinalLength').value),
    snapGridSize: parseInt(document.getElementById('snapGridSize').value),
    duplicateDistanceTolerance: parseInt(document.getElementById('duplicateDistanceTolerance').value),
    duplicateAngleTolerance: parseFloat(document.getElementById('duplicateAngleTolerance').value),
    orientationConstraints: document.getElementById('orientationConstraints').checked,
    snapToGrid: document.getElementById('snapToGrid').checked,
    removeDuplicates: document.getElementById('removeDuplicates').checked,
    
    // Features
    runOCR: document.getElementById('runOCR').checked
  };
}

// Apply settings to UI
function applySettings(settings) {
  Object.keys(settings).forEach(key => {
    const element = document.getElementById(key);
    if (element) {
      if (element.type === 'checkbox') {
        element.checked = settings[key];
      } else {
        element.value = settings[key];
      }
    }
  });
}

// Get friendly name for setting
function getSettingFriendlyName(key) {
  const names = {
    thresholdMethod: 'Threshold Method',
    adaptiveWindowSize: 'Adaptive Window',
    adaptiveC: 'Adaptive C',
    globalThresholdValue: 'Global Threshold',
    closingKernelSize: 'Closing Kernel',
    minComponentSize: 'Min Component',
    useClosing: 'Use Closing',
    removeNoise: 'Remove Noise',
    edgeThresholdPercent: 'Edge Threshold %',
    minEdgeThreshold: 'Min Edge Threshold',
    minWallLength: 'Min Wall Length',
    minLineScore: 'Min Line Score',
    minChainLength: 'Min Chain Length',
    mergeMaxDistance: 'Merge Max Distance',
    mergeMaxGap: 'Merge Max Gap',
    mergeAngleTolerance: 'Merge Angle',
    maxGapLength: 'Max Gap Length',
    gapAngleTolerance: 'Gap Angle',
    gapMaxOffset: 'Gap Max Offset',
    fillGaps: 'Fill Gaps',
    minFinalLength: 'Min Final Length',
    maxFinalLength: 'Max Final Length',
    snapGridSize: 'Snap Grid',
    duplicateDistanceTolerance: 'Duplicate Distance',
    duplicateAngleTolerance: 'Duplicate Angle',
    orientationConstraints: 'Orientation Constraints',
    snapToGrid: 'Snap to Grid',
    removeDuplicates: 'Remove Duplicates',
    runOCR: 'Run OCR'
  };
  return names[key] || key;
}

// Compare settings and return differences
function getSettingsDiff(oldSettings, newSettings) {
  const changes = [];
  Object.keys(newSettings).forEach(key => {
    if (oldSettings[key] !== newSettings[key]) {
      changes.push({
        key,
        name: getSettingFriendlyName(key),
        oldValue: oldSettings[key],
        newValue: newSettings[key]
      });
    }
  });
  return changes;
}

// Add test to history
function addToHistory(settings) {
  testCounter++;
  const previousSettings = testHistory.length > 0 ? testHistory[0].settings : null;
  const changes = previousSettings ? getSettingsDiff(previousSettings, settings) : [];
  
  const historyItem = {
    id: testCounter,
    timestamp: new Date(),
    settings: { ...settings },
    changes
  };
  
  testHistory.unshift(historyItem);
  
  // Keep only last 15 tests
  if (testHistory.length > MAX_HISTORY_ITEMS) {
    testHistory = testHistory.slice(0, MAX_HISTORY_ITEMS);
  }
  
  updateHistoryUI();
}

// Update history UI
function updateHistoryUI() {
  const historyList = document.getElementById('historyList');
  
  if (testHistory.length === 0) {
    historyList.innerHTML = '<div class="history-empty">No tests run yet. Run your first test to start tracking history.</div>';
    return;
  }
  
  let html = '';
  testHistory.forEach((item, index) => {
    const isBaseline = index === testHistory.length - 1;
    const timeStr = item.timestamp.toLocaleTimeString();
    
    let changesHtml = '';
    if (item.changes.length === 0) {
      changesHtml = '<div class="history-item-changes">Baseline test (no changes)</div>';
    } else {
      changesHtml = '<div class="history-item-changes">';
      item.changes.slice(0, 3).forEach(change => {
        changesHtml += `
          <div class="history-item-change">
            <strong>${change.name}:</strong>
            <span class="old-value">${change.oldValue}</span>
            → <span class="new-value">${change.newValue}</span>
          </div>
        `;
      });
      if (item.changes.length > 3) {
        changesHtml += `<div style="margin-top: 5px; color: #6c757d; font-style: italic;">+ ${item.changes.length - 3} more changes</div>`;
      }
      changesHtml += '</div>';
    }
    
    html += `
      <div class="history-item ${isBaseline ? 'history-item-baseline' : ''}" data-test-id="${item.id}">
        <div class="history-item-header">
          <div class="history-item-number">Test #${item.id}</div>
          <div class="history-item-time">${timeStr}</div>
        </div>
        ${changesHtml}
      </div>
    `;
  });
  
  historyList.innerHTML = html;
  
  // Add click handlers
  document.querySelectorAll('.history-item').forEach(item => {
    item.addEventListener('click', function() {
      const testId = parseInt(this.getAttribute('data-test-id'));
      revertToTest(testId);
    });
  });
}

// Revert to a previous test
function revertToTest(testId) {
  const test = testHistory.find(t => t.id === testId);
  if (!test) {
    alert('Test not found in history');
    return;
  }
  
  if (confirm(`Revert to Test #${testId} settings?\n\nThis will restore all settings from that test.`)) {
    applySettings(test.settings);
    alert(`Settings restored to Test #${testId}`);
  }
}

// Toggle history panel
function toggleHistoryPanel() {
  const panel = document.getElementById('historyPanel');
  const toggle = document.getElementById('toggleHistory');
  
  if (panel.classList.contains('collapsed')) {
    panel.classList.remove('collapsed');
    toggle.textContent = '−';
  } else {
    panel.classList.add('collapsed');
    toggle.textContent = '+';
  }
}

// Load test image
async function loadTestImage() {
  const response = await fetch('../ExampleFloorplan.png');
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
    // Get current settings and add to history
    const config = getCurrentSettings();
    addToHistory(config);
    
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
      adaptiveWindowSize: config.adaptiveWindowSize,
      adaptiveC: config.adaptiveC,
      globalThresholdValue: config.globalThresholdValue,
      removeNoise: config.removeNoise,
      minComponentSize: config.minComponentSize,
      useClosing: config.useClosing,
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
    
    const likelihood = await segmentWalls(preprocessed, width, height, {
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
      minScore: config.minLineScore,
      edgeThresholdPercent: config.edgeThresholdPercent,
      minEdgeThreshold: config.minEdgeThreshold,
      minChainLength: config.minChainLength
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
      maxDistance: config.mergeMaxDistance,
      maxGap: config.mergeMaxGap,
      angleTolerance: config.mergeAngleTolerance
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
        alignmentTolerance: config.gapMaxOffset,
        angleTolerance: config.gapAngleTolerance
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
      minLength: config.minFinalLength,
      maxLength: config.maxFinalLength,
      enforceOrientation: config.orientationConstraints,
      allowedOrientations: ['horizontal', 'vertical'],
      angleTolerance: Math.PI / 12,
      removeIsolated: false,
      connectionThreshold: 25,
      snapGrid: config.snapToGrid,
      gridSize: config.snapGridSize,
      snapOrientation: true,
      removeDups: config.removeDuplicates,
      duplicateThreshold: config.duplicateDistanceTolerance,
      duplicateAngleTolerance: config.duplicateAngleTolerance,
      applyConstraints: false,
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

// Reset to defaults
function resetDefaults() {
  // Preprocessing
  document.getElementById('thresholdMethod').value = 'adaptive';
  document.getElementById('adaptiveWindowSize').value = '15';
  document.getElementById('adaptiveC').value = '2';
  document.getElementById('globalThresholdValue').value = '128';
  document.getElementById('closingKernelSize').value = '9';
  document.getElementById('minComponentSize').value = '15';
  
  // Line Detection
  document.getElementById('edgeThresholdPercent').value = '5';
  document.getElementById('minEdgeThreshold').value = '0.1';
  document.getElementById('minWallLength').value = '50';
  document.getElementById('minLineScore').value = '0.15';
  document.getElementById('minChainLength').value = '3';
  
  // Merging
  document.getElementById('mergeMaxDistance').value = '20';
  document.getElementById('mergeMaxGap').value = '50';
  document.getElementById('mergeAngleTolerance').value = '0.15';
  
  // Gap Filling
  document.getElementById('maxGapLength').value = '100';
  document.getElementById('gapAngleTolerance').value = '0.1';
  document.getElementById('gapMaxOffset').value = '10';
  
  // Post-Processing
  document.getElementById('minFinalLength').value = '50';
  document.getElementById('maxFinalLength').value = '999999';
  document.getElementById('snapGridSize').value = '5';
  document.getElementById('duplicateDistanceTolerance').value = '10';
  document.getElementById('duplicateAngleTolerance').value = '0.1';
  
  // Feature Toggles
  document.getElementById('useClosing').checked = true;
  document.getElementById('removeNoise').checked = true;
  document.getElementById('fillGaps').checked = true;
  document.getElementById('orientationConstraints').checked = true;
  document.getElementById('snapToGrid').checked = true;
  document.getElementById('removeDuplicates').checked = true;
  document.getElementById('runOCR').checked = true;
  
  alert('Reset to default values');
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
document.getElementById('resetDefaults').addEventListener('click', resetDefaults);

// History panel handlers
document.getElementById('toggleHistory').addEventListener('click', toggleHistoryPanel);
document.querySelector('.history-header').addEventListener('click', toggleHistoryPanel);

// Batch testing functionality
import { testConfigurations } from './test-configurations.js';

let batchResults = [];
let isBatchRunning = false;

// Programmatically set parameters
function setParameters(params) {
  // Preprocessing
  document.getElementById('thresholdMethod').value = 'adaptive';
  document.getElementById('adaptiveWindowSize').value = params.adaptiveWindowSize;
  document.getElementById('adaptiveC').value = params.adaptiveC;
  document.getElementById('closingKernelSize').value = params.closingKernelSize;
  document.getElementById('useClosing').checked = true;
  document.getElementById('removeNoise').checked = true;
  document.getElementById('minComponentSize').value = 15;
  
  // Line Detection
  document.getElementById('edgeThresholdPercent').value = params.edgeThresholdPercent;
  document.getElementById('minEdgeThreshold').value = params.minEdgeThreshold;
  document.getElementById('minWallLength').value = params.minWallLength;
  document.getElementById('minLineScore').value = params.minLineScore;
  document.getElementById('minChainLength').value = 3;
  
  // Merging
  document.getElementById('mergeMaxDistance').value = 20;
  document.getElementById('mergeMaxGap').value = params.mergeMaxGap;
  document.getElementById('mergeAngleTolerance').value = 0.15;
  
  // Gap Filling
  document.getElementById('fillGaps').checked = params.fillGaps;
  document.getElementById('maxGapLength').value = params.maxGapLength;
  document.getElementById('gapAngleTolerance').value = 0.1;
  document.getElementById('gapMaxOffset').value = 10;
  
  // Post-Processing
  document.getElementById('minFinalLength').value = params.minFinalLength;
  document.getElementById('maxFinalLength').value = 999999;
  document.getElementById('orientationConstraints').checked = params.orientationConstraints;
  document.getElementById('snapToGrid').checked = true;
  document.getElementById('removeDuplicates').checked = true;
  document.getElementById('snapGridSize').value = 5;
  document.getElementById('duplicateDistanceTolerance').value = 10;
  document.getElementById('duplicateAngleTolerance').value = 0.1;
  
  document.getElementById('runOCR').checked = false; // Disable OCR for batch
}

// Extract visualizations from suite result
function extractVisualizations(suite) {
  const visualizations = [];
  suite.steps.forEach(step => {
    Object.entries(step.visualizations).forEach(([name, dataUrl]) => {
      visualizations.push({ name, dataUrl });
    });
  });
  return visualizations;
}

// Run batch tests
async function runBatchTests() {
  if (isBatchRunning) return;
  isBatchRunning = true;
  batchResults = [];
  
  const batchButton = document.getElementById('runBatch');
  if (batchButton) batchButton.disabled = true;
  
  console.log('\n╔════════════════════════════════════════════╗');
  console.log('║  Batch Wall Detection Tests - 25 Tests    ║');
  console.log('╚════════════════════════════════════════════╝\n');
  
  for (let i = 0; i < testConfigurations.length; i++) {
    const config = testConfigurations[i];
    console.log(`\n[${i + 1}/25] Running: ${config.name}`);
    console.log(`  ${config.description}`);
    
    try {
      // Set parameters
      setParameters(config.params);
      
      // Run test
      const suite = await runTestSuiteProgrammatic();
      
      // Extract results
      const visualizations = extractVisualizations(suite);
      
      batchResults.push({
        testNumber: i + 1,
        name: config.name,
        description: config.description,
        parameters: config.params,
        visualizations,
        timestamp: new Date().toISOString()
      });
      
      console.log(`  ✓ Completed - ${visualizations.length} visualizations saved`);
      
    } catch (error) {
      console.error(`  ✗ Error: ${error.message}`);
      batchResults.push({
        testNumber: i + 1,
        name: config.name,
        error: error.message
      });
    }
  }
  
  console.log('\n✓ All batch tests completed!');
  console.log(`${batchResults.length} tests completed\n`);
  
  if (batchButton) batchButton.disabled = false;
  isBatchRunning = false;
  
  // Enable download button
  const downloadButton = document.getElementById('downloadBatch');
  if (downloadButton) downloadButton.disabled = false;
}

// Download batch results
function downloadBatchResults() {
  if (batchResults.length === 0) {
    alert('No batch results to download. Run batch tests first.');
    return;
  }
  
  // Download index
  const index = {
    timestamp: new Date().toISOString(),
    totalTests: batchResults.length,
    tests: batchResults.map(r => ({
      testNumber: r.testNumber,
      name: r.name,
      description: r.description,
      parameters: r.parameters,
      visualizationCount: r.visualizations ? r.visualizations.length : 0
    }))
  };
  
  const indexBlob = new Blob([JSON.stringify(index, null, 2)], { type: 'application/json' });
  const indexUrl = URL.createObjectURL(indexBlob);
  const indexLink = document.createElement('a');
  indexLink.href = indexUrl;
  indexLink.download = `batch_test_index_${Date.now()}.json`;
  indexLink.click();
  URL.revokeObjectURL(indexUrl);
  
  // Download each test
  batchResults.forEach(result => {
    if (!result.visualizations) return;
    
    // Download parameters
    const paramsBlob = new Blob([JSON.stringify({
      testNumber: result.testNumber,
      name: result.name,
      description: result.description,
      parameters: result.parameters,
      timestamp: result.timestamp
    }, null, 2)], { type: 'application/json' });
    const paramsUrl = URL.createObjectURL(paramsBlob);
    const paramsLink = document.createElement('a');
    paramsLink.href = paramsUrl;
    paramsLink.download = `test_${result.testNumber.toString().padStart(2, '0')}_${result.name}_parameters.json`;
    paramsLink.click();
    URL.revokeObjectURL(paramsUrl);
    
    // Download visualizations
    result.visualizations.forEach((viz, idx) => {
      const link = document.createElement('a');
      link.href = viz.dataUrl;
      link.download = `test_${result.testNumber.toString().padStart(2, '0')}_${result.name}_${idx + 1}_${viz.name.replace(/\s+/g, '_')}.png`;
      link.click();
    });
  });
  
  alert(`Downloading results from ${batchResults.length} tests!`);
}

// Programmatic test runner (no DOM updates)
async function runTestSuiteProgrammatic() {
  const suite = new TestSuiteResult('Wall Detection Pipeline');
  const config = getCurrentSettings();
  
  const imageDataUrl = await loadTestImage();
  const img = await dataUrlToImage(imageDataUrl);
  const canvas = imageToCanvas(img);
  const ctx = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;
  const imageData = ctx.getImageData(0, 0, width, height);
  
  // Step 1: Preprocessing
  const step1 = new TestStepResult('Preprocessing & Binarization', 1);
  step1.start();
  const preprocessed = preprocessImage(imageData, {
    thresholdMethod: config.thresholdMethod,
    adaptiveWindowSize: config.adaptiveWindowSize,
    adaptiveC: config.adaptiveC,
    globalThresholdValue: config.globalThresholdValue,
    removeNoise: config.removeNoise,
    minComponentSize: config.minComponentSize,
    useClosing: config.useClosing,
    closingKernelSize: config.closingKernelSize
  });
  step1.addVisualization('Grayscale', visualizeGrayscale(preprocessed.grayscale, width, height));
  step1.addVisualization('Binary', visualizeBinary(preprocessed.binary, width, height));
  step1.finish(preprocessed);
  suite.addStep(step1);
  
  // Step 2: Segmentation
  const step2 = new TestStepResult('Wall Segmentation', 2);
  step2.start();
  const likelihood = await segmentWalls(preprocessed, width, height, {
    useModel: false,
    useFallback: true
  });
  step2.addVisualization('Likelihood Heatmap', visualizeLikelihoodHeatmap(likelihood, width, height));
  step2.finish(likelihood);
  suite.addStep(step2);
  
  // Step 3: Line Detection
  const step3 = new TestStepResult('Line Detection', 3);
  step3.start();
  let segments = detectLineSegments(likelihood, width, height, {
    minLength: config.minWallLength,
    minScore: config.minLineScore,
    edgeThresholdPercent: config.edgeThresholdPercent,
    minEdgeThreshold: config.minEdgeThreshold,
    minChainLength: config.minChainLength
  });
  step3.addVisualization('Detected Lines', visualizeLineSegments(segments, width, height));
  step3.addVisualization('By Orientation', visualizeSegmentsByOrientation(segments, width, height));
  step3.finish(segments);
  suite.addStep(step3);
  
  // Step 4: Merge Collinear
  const step4 = new TestStepResult('Collinear Merging', 4);
  step4.start();
  segments = mergeCollinearSegments(segments, {
    maxDistance: config.mergeMaxDistance,
    maxGap: config.mergeMaxGap,
    angleTolerance: config.mergeAngleTolerance
  });
  step4.addVisualization('After Merging', visualizeLineSegments(segments, width, height));
  step4.finish(segments);
  suite.addStep(step4);
  
  // Step 5: Gap Filling
  if (config.fillGaps) {
    const step5 = new TestStepResult('Gap Filling', 5);
    step5.start();
    segments = fillGapsInSegments(segments, {
      maxGapLength: config.maxGapLength,
      alignmentTolerance: config.gapMaxOffset,
      angleTolerance: config.gapAngleTolerance
    });
    step5.addVisualization('After Gap Filling', visualizeLineSegments(segments, width, height));
    step5.finish(segments);
    suite.addStep(step5);
  }
  
  // Step 6: Post-Processing
  const step6 = new TestStepResult('Post-Processing & Classification', 6);
  step6.start();
  const processed = postProcessSegments(segments, width, height, {
    minLength: config.minFinalLength,
    maxLength: config.maxFinalLength,
    enforceOrientation: config.orientationConstraints,
    allowedOrientations: ['horizontal', 'vertical'],
    angleTolerance: Math.PI / 12,
    removeIsolated: false,
    connectionThreshold: 25,
    snapGrid: config.snapToGrid,
    gridSize: config.snapGridSize,
    snapOrientation: true,
    removeDups: config.removeDuplicates,
    duplicateThreshold: config.duplicateDistanceTolerance,
    duplicateAngleTolerance: config.duplicateAngleTolerance,
    applyConstraints: false,
    classifyExterior: true
  });
  
  if (processed.exterior && processed.interior) {
    step6.addVisualization('Exterior/Interior', visualizeExteriorInterior(processed.exterior, processed.interior, width, height));
  }
  step6.addVisualization('Final Result', visualizeLineSegments(processed.all, width, height));
  step6.finish(processed);
  suite.addStep(step6);
  
  suite.finish();
  return suite;
}

// Expose batch functions globally
window.runBatchTests = runBatchTests;
window.downloadBatchResults = downloadBatchResults;

// Auto-run on load
window.addEventListener('load', () => {
  console.log('Wall Detection Test Suite Ready');
  setTimeout(() => {
    document.getElementById('runTest').click();
  }, 500);
});
