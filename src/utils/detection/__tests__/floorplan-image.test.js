import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import {
  traceFloorplanBoundaryCore,
  preprocessImage,
  fillExterior,
} from '../pipeline';
import { resizeNearest } from '../preprocess';
import { closeMask } from '../wallMask';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..', '..');
const OUTPUT_DIR = resolve(REPO_ROOT, 'test-output');

const loadPng = (relPath) => {
  const buffer = readFileSync(resolve(REPO_ROOT, relPath));
  const png = PNG.sync.read(buffer);
  return {
    width: png.width,
    height: png.height,
    data: new Uint8ClampedArray(png.data),
  };
};

const saveMaskPng = (mask, width, height, filePath) => {
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height; i += 1) {
    const v = mask[i] ? 255 : 0;
    png.data[i * 4] = v;
    png.data[i * 4 + 1] = v;
    png.data[i * 4 + 2] = v;
    png.data[i * 4 + 3] = 255;
  }
  writeFileSync(filePath, PNG.sync.write(png));
};

/** Bresenham line rasteriser for overlay drawing. */
const drawLineOnPng = (png, x0, y0, x1, y1, color, thickness = 2) => {
  let x = Math.round(x0);
  let y = Math.round(y0);
  const tx = Math.round(x1);
  const ty = Math.round(y1);
  const dx = Math.abs(tx - x);
  const sx = x < tx ? 1 : -1;
  const dy = -Math.abs(ty - y);
  const sy = y < ty ? 1 : -1;
  let error = dx + dy;

  const setPixel = (px, py) => {
    if (px < 0 || py < 0 || px >= png.width || py >= png.height) return;
    const idx = (py * png.width + px) * 4;
    png.data[idx] = color[0];
    png.data[idx + 1] = color[1];
    png.data[idx + 2] = color[2];
    png.data[idx + 3] = 255;
  };

  while (true) {
    for (let oy = -thickness; oy <= thickness; oy += 1) {
      for (let ox = -thickness; ox <= thickness; ox += 1) {
        setPixel(x + ox, y + oy);
      }
    }
    if (x === tx && y === ty) break;
    const e2 = 2 * error;
    if (e2 >= dy) { error += dy; x += sx; }
    if (e2 <= dx) { error += dx; y += sy; }
  }
};

/** Draw a filled circle on a PNG for vertex labels. */
const drawCircleOnPng = (png, cx, cy, radius, color) => {
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      if (dx * dx + dy * dy > radius * radius) continue;
      const px = cx + dx;
      const py = cy + dy;
      if (px < 0 || py < 0 || px >= png.width || py >= png.height) continue;
      const idx = (py * png.width + px) * 4;
      png.data[idx] = color[0];
      png.data[idx + 1] = color[1];
      png.data[idx + 2] = color[2];
      png.data[idx + 3] = 255;
    }
  }
};

const saveContourOverlay = (imageData, polygon, filePath) => {
  const { width, height, data } = imageData;
  const png = new PNG({ width, height });
  for (let i = 0; i < data.length; i += 1) png.data[i] = data[i];

  // Draw polygon edges in red (thickness 2)
  for (let i = 0; i < polygon.length; i += 1) {
    const p1 = polygon[i];
    const p2 = polygon[(i + 1) % polygon.length];
    drawLineOnPng(png, p1.x, p1.y, p2.x, p2.y, [255, 0, 0], 2);
  }

  // Label vertices with green circles
  for (let i = 0; i < polygon.length; i += 1) {
    drawCircleOnPng(png, Math.round(polygon[i].x), Math.round(polygon[i].y), 4, [0, 255, 0]);
  }

  writeFileSync(filePath, PNG.sync.write(png));
};

/* ------------------------------------------------------------------ */
/*  run_test_pipeline                                                  */
/* ------------------------------------------------------------------ */

/**
 * Run the full detection pipeline on a floorplan image.
 * Saves debug outputs (binary, cleaned, contour overlay) to disk and
 * returns the pipeline result for assertions.
 */
const runTestPipeline = (imagePath) => {
  mkdirSync(OUTPUT_DIR, { recursive: true });

  // Load
  const imageData = loadPng(imagePath);
  console.log(`[test-pipeline] Image: ${imagePath}  ${imageData.width}×${imageData.height}`);

  // Run pipeline
  const result = traceFloorplanBoundaryCore(imageData);

  // Save intermediate debug images
  const { binary } = preprocessImage(imageData);
  saveMaskPng(binary, imageData.width, imageData.height, resolve(OUTPUT_DIR, 'output_binary.png'));

  // Replicate the reduced-resolution processing for debug visualisation
  const maxWorkDim = 500;
  const longest = Math.max(imageData.width, imageData.height);
  const workScale = longest > maxWorkDim ? maxWorkDim / longest : 1;
  const ww = Math.max(1, Math.round(imageData.width * workScale));
  const wh = Math.max(1, Math.round(imageData.height * workScale));
  const workBinary = workScale < 1 ? resizeNearest(binary, imageData.width, imageData.height, ww, wh) : binary;
  const closeR = Math.max(5, Math.round(Math.min(ww, wh) * 0.04));
  const workClosed = closeMask(workBinary, ww, wh, closeR);
  const workFilled = fillExterior(workClosed, ww, wh);
  const filledFull = workScale < 1 ? resizeNearest(workFilled, ww, wh, imageData.width, imageData.height) : workFilled;

  saveMaskPng(filledFull, imageData.width, imageData.height, resolve(OUTPUT_DIR, 'output_clean.png'));
  saveMaskPng(filledFull, imageData.width, imageData.height, resolve(OUTPUT_DIR, 'output_filled.png'));

  if (result) {
    saveContourOverlay(imageData, result.outer, resolve(OUTPUT_DIR, 'output_contour.png'));

    console.log(`[test-pipeline] Contour area : ${result.debug.area.toFixed(0)}`);
    console.log(`[test-pipeline] Vertices     : ${result.debug.vertices}`);
    console.log(`[test-pipeline] Area ratio   : ${(result.debug.areaRatio * 100).toFixed(1)}%`);

    if (result.debug.areaRatio < 0.05) {
      console.warn('[test-pipeline] WARNING: contour area is very small — possible failure');
    }

    // Warn if contour touches image border
    const { width, height } = imageData;
    const touchesBorder = result.outer.some(
      (p) => p.x <= 1 || p.y <= 1 || p.x >= width - 2 || p.y >= height - 2,
    );
    if (touchesBorder) {
      console.warn('[test-pipeline] WARNING: contour touches image border');
    }
  } else {
    console.error('[test-pipeline] FAILED: no contour detected');
  }

  return result;
};

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('ExampleFloorplan.png – full pipeline', () => {
  it('detects outer boundary', { timeout: 30_000 }, () => {
    const result = runTestPipeline('ExampleFloorplan.png');
    expect(result).not.toBeNull();
    expect(result.outer).toBeDefined();
    expect(Array.isArray(result.outer)).toBe(true);
  });

  it('produces a polygon with ≥ 4 vertices', { timeout: 30_000 }, () => {
    const result = runTestPipeline('ExampleFloorplan.png');
    expect(result.outer.length).toBeGreaterThanOrEqual(4);
  });

  it('contour area is a reasonable fraction of the image', { timeout: 30_000 }, () => {
    const result = runTestPipeline('ExampleFloorplan.png');
    // The floorplan should cover at least 5 % of the image
    expect(result.debug.areaRatio).toBeGreaterThan(0.05);
    // …but less than 95 % (it shouldn't be the entire image)
    expect(result.debug.areaRatio).toBeLessThan(0.95);
  });

  it('polygon is wound clockwise (positive signed area in screen coords)', { timeout: 30_000 }, () => {
    const result = runTestPipeline('ExampleFloorplan.png');
    let area = 0;
    const pts = result.outer;
    for (let i = 0; i < pts.length; i += 1) {
      const j = (i + 1) % pts.length;
      area += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
    }
    expect(area).toBeGreaterThan(0);
  });

  it('saves debug images to test-output/', { timeout: 30_000 }, () => {
    runTestPipeline('ExampleFloorplan.png');
    // Simply verify the files were created
    const files = ['output_binary.png', 'output_clean.png', 'output_filled.png', 'output_contour.png'];
    for (const f of files) {
      const data = readFileSync(resolve(OUTPUT_DIR, f));
      expect(data.length).toBeGreaterThan(0);
    }
  });
});
