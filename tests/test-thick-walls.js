/**
 * Test Thick Wall Detection
 * Verify that the new thick wall detector preserves wall thickness
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import modules
const { preprocessImage } = await import('../src/utils/imagePreprocessor.js');
const { detectThickWalls, mergeThickWalls } = await import('../src/utils/thickWallDetector.js');
const { visualizeThickWalls, visualizeBinary, visualizeGrayscale } = await import('../src/utils/wallTestVisualizations.js');

// Setup canvas for DOM
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
/* eslint-disable no-undef */
global.document = dom.window.document;
global.Image = createCanvas.Image;
const originalCreateElement = global.document.createElement.bind(global.document);
global.document.createElement = function(tagName) {
  if (tagName.toLowerCase() === 'canvas') {
    return createCanvas(100, 100);
  }
  return originalCreateElement(tagName);
};
/* eslint-enable no-undef */

async function testThickWalls() {
  console.log('╔════════════════════════════════════════════╗');
  console.log('║   Testing Thick Wall Detection             ║');
  console.log('╚════════════════════════════════════════════╝\n');
  
  // Load image
  const imagePath = path.join(__dirname, '..', 'ExampleFloorplan.png');
  const img = await loadImage(imagePath);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  
  console.log(`Image: ${canvas.width}x${canvas.height}px\n`);
  
  // Preprocess
  console.log('Step 1: Preprocessing...');
  const preprocessed = preprocessImage(imageData, {
    thresholdMethod: 'adaptive',
    adaptiveWindowSize: 15,
    adaptiveC: 2,
    globalThresholdValue: 128,
    removeNoise: true,
    minComponentSize: 15,
    useClosing: true,
    closingKernelSize: 9
  });
  console.log('✓ Preprocessing complete\n');
  
  // Detect thick walls
  console.log('Step 2: Detecting thick walls...');
  let walls = detectThickWalls(preprocessed.binary, canvas.width, canvas.height, {
    minWallLength: 50,
    minThickness: 2,
    maxThickness: 30,
    minAspectRatio: 3
  });
  console.log(`✓ Found ${walls.length} thick walls\n`);
  
  // Merge nearby walls
  console.log('Step 3: Merging nearby walls...');
  walls = mergeThickWalls(walls, {
    maxDistance: 50,
    maxGap: 50
  });
  console.log(`✓ Merged into ${walls.length} thick walls\n`);
  
  // Analyze walls
  console.log('Wall Statistics:');
  const avgThickness = walls.reduce((sum, w) => sum + w.thickness, 0) / walls.length;
  const avgLength = walls.reduce((sum, w) => sum + w.length, 0) / walls.length;
  const horizontal = walls.filter(w => w.isHorizontal).length;
  const vertical = walls.filter(w => !w.isHorizontal).length;
  
  console.log(`  Average thickness: ${avgThickness.toFixed(1)}px`);
  console.log(`  Average length: ${avgLength.toFixed(1)}px`);
  console.log(`  Horizontal: ${horizontal}`);
  console.log(`  Vertical: ${vertical}\n`);
  
  // Create visualizations
  console.log('Creating visualizations...');
  const outputDir = path.join(__dirname, 'thick_wall_test');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  // Save grayscale
  const grayscaleViz = visualizeGrayscale(preprocessed.grayscale, canvas.width, canvas.height);
  const grayscaleData = grayscaleViz.replace(/^data:image\/png;base64,/, '');
  fs.writeFileSync(path.join(outputDir, '1_grayscale.png'), grayscaleData, 'base64');
  
  // Save binary
  const binaryViz = visualizeBinary(preprocessed.binary, canvas.width, canvas.height);
  const binaryData = binaryViz.replace(/^data:image\/png;base64,/, '');
  fs.writeFileSync(path.join(outputDir, '2_binary.png'), binaryData, 'base64');
  
  // Save thick walls
  const thickViz = visualizeThickWalls(walls, canvas.width, canvas.height);
  const thickData = thickViz.replace(/^data:image\/png;base64,/, '');
  fs.writeFileSync(path.join(outputDir, '3_thick_walls.png'), thickData, 'base64');
  
  // Save wall data
  const wallData = {
    totalWalls: walls.length,
    horizontal,
    vertical,
    avgThickness: avgThickness.toFixed(1),
    avgLength: avgLength.toFixed(1),
    walls: walls.map(w => w.toJSON())
  };
  fs.writeFileSync(path.join(outputDir, 'wall_data.json'), JSON.stringify(wallData, null, 2));
  
  console.log(`✓ Visualizations saved to: ${outputDir}\n`);
  console.log('═══════════════════════════════════════════');
  console.log('Test Complete! Check the output folder.');
  console.log('═══════════════════════════════════════════\n');
}

testThickWalls().catch(console.error);
