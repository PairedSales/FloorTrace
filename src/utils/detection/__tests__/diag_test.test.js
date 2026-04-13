import fs from 'fs';
import path from 'path';
import { describe, it } from 'vitest';
import { PNG } from 'pngjs';
import { traceFloorplanBoundaryCore } from '../pipeline';
import { normalizeImageData } from '../preprocess';
import { closeMask } from '../wallMask';

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..', '..');
const EXAMPLE_PATH = path.join(ROOT, 'ExampleFloorplan.png');

const loadPng = (p) => {
  const raw = fs.readFileSync(p);
  const png = PNG.sync.read(raw);
  return { width: png.width, height: png.height, data: new Uint8ClampedArray(png.data) };
};

describe('diagnostic', () => {
  it('analyze exterior boundary', () => {
    const img = loadPng(EXAMPLE_PATH);
    console.log(`Image: ${img.width}x${img.height}`);

    const result = traceFloorplanBoundaryCore(img);
    const poly = result.outer.polygon;

    console.log('Debug:', JSON.stringify(result.debug));
    console.log('Outer vertices:', poly.length);
    console.log('Inner vertices:', result.inner.polygon.length);

    // Segment analysis
    let shortSegs = 0, totalLen = 0;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const len = Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
      totalLen += len;
      if (len < 20) shortSegs++;
    }
    console.log('Perimeter:', totalLen.toFixed(0), 'px');
    console.log('Short segs (<20px):', shortSegs, 'of', poly.length);
    console.log('Avg seg len:', (totalLen / poly.length).toFixed(1), 'px');

    // Print all vertices
    console.log('\n--- All outer polygon vertices ---');
    poly.forEach((p, i) => console.log(`  ${i}: (${p.x.toFixed(1)}, ${p.y.toFixed(1)})`));

    // Analyze preprocessing
    const preprocess = normalizeImageData(img);
    console.log(`\nNormalized size: ${preprocess.width}x${preprocess.height}, scale: ${preprocess.scale.toFixed(4)}`);

    const DARK_PIXEL_THRESHOLD = 200;
    const w = preprocess.width;
    const h = preprocess.height;
    const edgeScanMask = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      edgeScanMask[i] = preprocess.gray[i] < DARK_PIXEL_THRESHOLD ? 1 : 0;
    }
    const closedMask = closeMask(edgeScanMask, w, h, 2);

    // Sample profiles to understand the boundary behavior
    console.log('\n--- Right edge profile sample (closed mask, scan from right) ---');
    for (let y = 0; y < h; y += Math.floor(h / 40)) {
      let firstDark = -1;
      for (let x = w - 1; x >= 0; x--) {
        if (closedMask[y * w + x]) { firstDark = x; break; }
      }
      console.log(`  row ${y}: firstDarkFromRight=${firstDark} (maxX=${w - 1})`);
    }

    console.log('\n--- Left edge profile sample ---');
    for (let y = 0; y < h; y += Math.floor(h / 40)) {
      let firstDark = -1;
      for (let x = 0; x < w; x++) {
        if (closedMask[y * w + x]) { firstDark = x; break; }
      }
      console.log(`  row ${y}: firstDarkFromLeft=${firstDark} (minX=0)`);
    }

    // Save footprint visualization
    const outDir = path.join(ROOT, 'test-output');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    // Visualize the polygon on original image
    const vizPng = new PNG({ width: img.width, height: img.height });
    for (let i = 0; i < img.data.length; i++) vizPng.data[i] = img.data[i];

    // Draw polygon edges in red (thick)
    const drawLine = (x0, y0, x1, y1, r, g, b) => {
      const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
      const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
      let err = dx - dy, x = x0, y = y0;
      for (let step = 0; step < 20000; step++) {
        for (let t = -2; t <= 2; t++) {
          for (let u = -2; u <= 2; u++) {
            const px = x + t, py = y + u;
            if (px >= 0 && px < img.width && py >= 0 && py < img.height) {
              const idx = (py * img.width + px) * 4;
              vizPng.data[idx] = r; vizPng.data[idx + 1] = g; vizPng.data[idx + 2] = b; vizPng.data[idx + 3] = 255;
            }
          }
        }
        if (x === x1 && y === y1) break;
        const e2 = 2 * err;
        if (e2 > -dy) { err -= dy; x += sx; }
        if (e2 < dx) { err += dx; y += sy; }
      }
    };

    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      drawLine(Math.round(a.x), Math.round(a.y), Math.round(b.x), Math.round(b.y), 255, 0, 0);
    }

    // Draw vertices as green circles
    for (const p of poly) {
      for (let dy = -5; dy <= 5; dy++) {
        for (let dx = -5; dx <= 5; dx++) {
          if (dx * dx + dy * dy > 25) continue;
          const x = Math.round(p.x) + dx, y = Math.round(p.y) + dy;
          if (x >= 0 && x < img.width && y >= 0 && y < img.height) {
            const idx = (y * img.width + x) * 4;
            vizPng.data[idx] = 0; vizPng.data[idx + 1] = 255; vizPng.data[idx + 2] = 0; vizPng.data[idx + 3] = 255;
          }
        }
      }
    }

    fs.writeFileSync(path.join(outDir, 'diagnostic_boundary.png'), PNG.sync.write(vizPng));
    console.log('\nSaved: test-output/diagnostic_boundary.png');

    // Deep dive into bottom rows - check actual gray values
    console.log('\n--- Gray values at critical bottom rows (normalized) ---');
    for (let y = 800; y < Math.min(h, 960); y += 10) {
      // Find darkest pixel in row and its position
      let darkest = 255, darkX = -1;
      let darkCount = 0;
      for (let x = 0; x < w; x++) {
        const g = preprocess.gray[y * w + x];
        if (g < 200) darkCount++;
        if (g < darkest) { darkest = g; darkX = x; }
      }
      console.log(`  row ${y} (orig~${Math.round(y/preprocess.scale)}): darkest=${darkest} at x=${darkX}, darkPixels(<200)=${darkCount}`);
    }

    // Check bottom profile too
    console.log('\n--- Bottom edge profile sample (scan from bottom up) ---');
    for (let x = 0; x < w; x += Math.floor(w / 30)) {
      let firstDark = -1;
      for (let y = h - 1; y >= 0; y--) {
        if (closedMask[y * w + x]) { firstDark = y; break; }
      }
      console.log(`  col ${x} (orig~${Math.round(x/preprocess.scale)}): bottomProfile=${firstDark}`);
    }

    // Check top profile too
    console.log('\n--- Top edge profile sample (scan from top down) ---');
    for (let x = 0; x < w; x += Math.floor(w / 30)) {
      let firstDark = -1;
      for (let y = 0; y < h; y++) {
        if (closedMask[y * w + x]) { firstDark = y; break; }
      }
      console.log(`  col ${x} (orig~${Math.round(x/preprocess.scale)}): topProfile=${firstDark}`);
    }

    // Save the edge scan mask as PNG for visual inspection
    const maskPng = new PNG({ width: w, height: h });
    for (let i = 0; i < w * h; i++) {
      const val = closedMask[i] ? 255 : 0;
      maskPng.data[i * 4] = val;
      maskPng.data[i * 4 + 1] = val;
      maskPng.data[i * 4 + 2] = val;
      maskPng.data[i * 4 + 3] = 255;
    }
    fs.writeFileSync(path.join(outDir, 'diagnostic_closed_mask.png'), PNG.sync.write(maskPng));
    console.log('\nSaved: test-output/diagnostic_closed_mask.png');

    // Save grayscale image
    const grayPng = new PNG({ width: w, height: h });
    for (let i = 0; i < w * h; i++) {
      const val = preprocess.gray[i];
      grayPng.data[i * 4] = val;
      grayPng.data[i * 4 + 1] = val;
      grayPng.data[i * 4 + 2] = val;
      grayPng.data[i * 4 + 3] = 255;
    }
    fs.writeFileSync(path.join(outDir, 'diagnostic_gray.png'), PNG.sync.write(grayPng));
    console.log('Saved: test-output/diagnostic_gray.png');
  }, 30000);
});
