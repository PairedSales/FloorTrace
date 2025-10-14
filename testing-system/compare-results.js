/**
 * Compare Two Test Results
 * 
 * Usage: node compare-results.js <timestamp1> <timestamp2>
 * Example: node compare-results.js 2024-01-15T10-30-45 2024-01-15T11-45-30
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function compareResults(timestamp1, timestamp2) {
  console.log('========================================');
  console.log('COMPARING TEST RESULTS');
  console.log('========================================\n');
  
  // Load analysis files
  const dir1 = path.join(__dirname, 'test-results', timestamp1);
  const dir2 = path.join(__dirname, 'test-results', timestamp2);
  
  if (!fs.existsSync(dir1)) {
    console.error(`Error: ${dir1} not found`);
    process.exit(1);
  }
  
  if (!fs.existsSync(dir2)) {
    console.error(`Error: ${dir2} not found`);
    process.exit(1);
  }
  
  const analysis1 = JSON.parse(fs.readFileSync(path.join(dir1, 'analysis.json'), 'utf-8'));
  const analysis2 = JSON.parse(fs.readFileSync(path.join(dir2, 'analysis.json'), 'utf-8'));
  
  const inputs1 = JSON.parse(fs.readFileSync(path.join(dir1, 'inputs-used.json'), 'utf-8'));
  const inputs2 = JSON.parse(fs.readFileSync(path.join(dir2, 'inputs-used.json'), 'utf-8'));
  
  console.log('Test 1:', timestamp1);
  console.log('Test 2:', timestamp2);
  console.log('');
  
  // Compare metrics
  console.log('WALL COUNTS COMPARISON');
  console.log('─────────────────────────────────────────');
  console.log(`                    Test 1    Test 2    Diff`);
  console.log('─────────────────────────────────────────');
  
  const metrics = [
    ['Total Walls', 'total'],
    ['Horizontal', 'horizontal'],
    ['Vertical', 'vertical'],
    ['Exterior', 'exterior'],
    ['Interior', 'interior']
  ];
  
  for (const [label, key] of metrics) {
    const val1 = analysis1.wallCounts[key];
    const val2 = analysis2.wallCounts[key];
    const diff = val2 - val1;
    const diffStr = diff > 0 ? `+${diff}` : diff.toString();
    const diffColor = diff > 0 ? '↑' : diff < 0 ? '↓' : '=';
    
    console.log(`${label.padEnd(20)} ${val1.toString().padStart(6)}   ${val2.toString().padStart(6)}   ${diffStr.padStart(6)} ${diffColor}`);
  }
  
  console.log('─────────────────────────────────────────\n');
  
  // Compare processing time
  console.log('PROCESSING TIME');
  console.log('─────────────────────────────────────────');
  const time1 = analysis1.processingTime;
  const time2 = analysis2.processingTime;
  const timeDiff = time2 - time1;
  const timeDiffStr = timeDiff > 0 ? `+${timeDiff}` : timeDiff.toString();
  console.log(`Test 1: ${time1}ms`);
  console.log(`Test 2: ${time2}ms`);
  console.log(`Difference: ${timeDiffStr}ms\n`);
  
  // Compare wall statistics if available
  if (analysis1.wallStatistics && analysis2.wallStatistics) {
    console.log('WALL STATISTICS COMPARISON');
    console.log('─────────────────────────────────────────');
    console.log('Average Length:');
    console.log(`  Test 1: ${analysis1.wallStatistics.length.avg}px`);
    console.log(`  Test 2: ${analysis2.wallStatistics.length.avg}px`);
    console.log('');
    console.log('Average Thickness:');
    console.log(`  Test 1: ${analysis1.wallStatistics.thickness.avg}px`);
    console.log(`  Test 2: ${analysis2.wallStatistics.thickness.avg}px\n`);
  }
  
  // Find parameter differences
  console.log('PARAMETER DIFFERENCES');
  console.log('─────────────────────────────────────────');
  
  const differences = findDifferences(inputs1, inputs2);
  
  if (differences.length === 0) {
    console.log('No parameter differences found!\n');
  } else {
    for (const diff of differences) {
      console.log(`${diff.path}:`);
      console.log(`  Test 1: ${JSON.stringify(diff.value1)}`);
      console.log(`  Test 2: ${JSON.stringify(diff.value2)}`);
    }
    console.log('');
  }
  
  // Summary
  console.log('========================================');
  console.log('SUMMARY');
  console.log('========================================');
  
  const totalDiff = analysis2.wallCounts.total - analysis1.wallCounts.total;
  
  if (totalDiff > 0) {
    console.log(`✓ Test 2 detected ${totalDiff} MORE walls`);
  } else if (totalDiff < 0) {
    console.log(`✓ Test 2 detected ${Math.abs(totalDiff)} FEWER walls`);
  } else {
    console.log(`= Same number of walls detected`);
  }
  
  if (timeDiff < 0) {
    console.log(`✓ Test 2 was ${Math.abs(timeDiff)}ms FASTER`);
  } else if (timeDiff > 0) {
    console.log(`✓ Test 2 was ${timeDiff}ms SLOWER`);
  } else {
    console.log(`= Same processing time`);
  }
  
  console.log(`\nChanged parameters: ${differences.length}`);
  console.log('========================================\n');
  
  // Generate comparison report
  generateComparisonReport(timestamp1, timestamp2, analysis1, analysis2, inputs1, inputs2, differences);
}

function findDifferences(obj1, obj2, prefix = '') {
  const differences = [];
  
  const keys = new Set([...Object.keys(obj1), ...Object.keys(obj2)]);
  
  for (const key of keys) {
    const path = prefix ? `${prefix}.${key}` : key;
    const val1 = obj1[key];
    const val2 = obj2[key];
    
    if (typeof val1 === 'object' && typeof val2 === 'object' && !Array.isArray(val1) && !Array.isArray(val2)) {
      differences.push(...findDifferences(val1 || {}, val2 || {}, path));
    } else if (JSON.stringify(val1) !== JSON.stringify(val2)) {
      differences.push({ path, value1: val1, value2: val2 });
    }
  }
  
  return differences;
}

function generateComparisonReport(ts1, ts2, analysis1, analysis2, inputs1, inputs2, differences) {
  const outputPath = path.join(__dirname, 'test-results', `comparison-${ts1}-vs-${ts2}.html`);
  
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Test Comparison: ${ts1} vs ${ts2}</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      max-width: 1400px;
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
    .comparison {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
      margin-bottom: 20px;
    }
    .test-card {
      background: white;
      padding: 20px;
      border-radius: 5px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .test-1 { border-left: 4px solid #3498db; }
    .test-2 { border-left: 4px solid #e74c3c; }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 20px 0;
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
    .diff-positive { color: #27ae60; font-weight: bold; }
    .diff-negative { color: #e74c3c; font-weight: bold; }
    .diff-neutral { color: #95a5a6; }
    .section {
      background: white;
      padding: 20px;
      margin-bottom: 20px;
      border-radius: 5px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    pre {
      background: #f8f8f8;
      padding: 10px;
      border-radius: 3px;
      overflow-x: auto;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>Test Comparison Report</h1>
    <p>Test 1: ${ts1}</p>
    <p>Test 2: ${ts2}</p>
  </div>

  <div class="comparison">
    <div class="test-card test-1">
      <h2>Test 1</h2>
      <p><strong>Total Walls:</strong> ${analysis1.wallCounts.total}</p>
      <p><strong>Exterior:</strong> ${analysis1.wallCounts.exterior}</p>
      <p><strong>Interior:</strong> ${analysis1.wallCounts.interior}</p>
      <p><strong>Time:</strong> ${analysis1.processingTime}ms</p>
    </div>
    
    <div class="test-card test-2">
      <h2>Test 2</h2>
      <p><strong>Total Walls:</strong> ${analysis2.wallCounts.total}</p>
      <p><strong>Exterior:</strong> ${analysis2.wallCounts.exterior}</p>
      <p><strong>Interior:</strong> ${analysis2.wallCounts.interior}</p>
      <p><strong>Time:</strong> ${analysis2.processingTime}ms</p>
    </div>
  </div>

  <div class="section">
    <h2>Metric Comparison</h2>
    <table>
      <tr>
        <th>Metric</th>
        <th>Test 1</th>
        <th>Test 2</th>
        <th>Difference</th>
      </tr>
      ${generateComparisonRows(analysis1, analysis2)}
    </table>
  </div>

  <div class="section">
    <h2>Parameter Differences (${differences.length})</h2>
    ${differences.length === 0 ? '<p>No parameter changes detected.</p>' : `
    <table>
      <tr>
        <th>Parameter</th>
        <th>Test 1 Value</th>
        <th>Test 2 Value</th>
      </tr>
      ${differences.map(d => `
      <tr>
        <td><code>${d.path}</code></td>
        <td>${JSON.stringify(d.value1)}</td>
        <td>${JSON.stringify(d.value2)}</td>
      </tr>
      `).join('')}
    </table>
    `}
  </div>

  <div class="section">
    <h2>Image Comparisons</h2>
    <h3>Test 1 - Overlay</h3>
    <img src="${ts1}/6-overlay.png" style="max-width: 100%; border: 1px solid #ddd;">
    
    <h3>Test 2 - Overlay</h3>
    <img src="${ts2}/6-overlay.png" style="max-width: 100%; border: 1px solid #ddd;">
  </div>
</body>
</html>`;

  fs.writeFileSync(outputPath, html);
  console.log(`Comparison report saved to: ${outputPath}\n`);
}

function generateComparisonRows(a1, a2) {
  const metrics = [
    ['Total Walls', a1.wallCounts.total, a2.wallCounts.total],
    ['Horizontal', a1.wallCounts.horizontal, a2.wallCounts.horizontal],
    ['Vertical', a1.wallCounts.vertical, a2.wallCounts.vertical],
    ['Exterior', a1.wallCounts.exterior, a2.wallCounts.exterior],
    ['Interior', a1.wallCounts.interior, a2.wallCounts.interior],
    ['Processing Time (ms)', a1.processingTime, a2.processingTime]
  ];
  
  return metrics.map(([label, v1, v2]) => {
    const diff = v2 - v1;
    const diffClass = diff > 0 ? 'diff-positive' : diff < 0 ? 'diff-negative' : 'diff-neutral';
    const diffStr = diff > 0 ? `+${diff}` : diff.toString();
    const arrow = diff > 0 ? '↑' : diff < 0 ? '↓' : '=';
    
    return `
    <tr>
      <td><strong>${label}</strong></td>
      <td>${v1}</td>
      <td>${v2}</td>
      <td class="${diffClass}">${diffStr} ${arrow}</td>
    </tr>`;
  }).join('');
}

// Main
const args = process.argv.slice(2);

if (args.length !== 2) {
  console.log('Usage: node compare-results.js <timestamp1> <timestamp2>');
  console.log('\nExample:');
  console.log('  node compare-results.js 2024-01-15T10-30-45 2024-01-15T11-45-30');
  console.log('\nAvailable test results:');
  
  const resultsDir = path.join(__dirname, 'test-results');
  if (fs.existsSync(resultsDir)) {
    const dirs = fs.readdirSync(resultsDir)
      .filter(f => fs.statSync(path.join(resultsDir, f)).isDirectory())
      .sort()
      .reverse();
    
    dirs.forEach(dir => console.log(`  - ${dir}`));
  }
  
  process.exit(1);
}

compareResults(args[0], args[1]);
