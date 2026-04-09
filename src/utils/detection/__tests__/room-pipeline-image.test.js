import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import { runFullPipeline } from '../pipeline';

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

/** Deterministic colour palette for room visualisation. */
const ROOM_COLORS = [
  [255, 99, 71], [50, 205, 50], [30, 144, 255], [255, 215, 0],
  [255, 105, 180], [0, 206, 209], [255, 165, 0], [138, 43, 226],
  [0, 255, 127], [220, 20, 60], [100, 149, 237], [255, 69, 0],
  [127, 255, 0], [186, 85, 211], [64, 224, 208], [240, 128, 128],
];

const getColor = (idx) => ROOM_COLORS[idx % ROOM_COLORS.length];

/** Draw a filled circle on a PNG. */
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

/** Draw a line (Bresenham) on a PNG. */
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

  while (true) {
    for (let oy = -thickness; oy <= thickness; oy += 1) {
      for (let ox = -thickness; ox <= thickness; ox += 1) {
        const px = x + ox;
        const py = y + oy;
        if (px < 0 || py < 0 || px >= png.width || py >= png.height) continue;
        const idx = (py * png.width + px) * 4;
        png.data[idx] = color[0];
        png.data[idx + 1] = color[1];
        png.data[idx + 2] = color[2];
        png.data[idx + 3] = 255;
      }
    }
    if (x === tx && y === ty) break;
    const e2 = 2 * error;
    if (e2 >= dy) { error += dy; x += sx; }
    if (e2 <= dx) { error += dx; y += sy; }
  }
};

/** Draw a rectangle outline on a PNG. */
const drawRectOnPng = (png, rx, ry, rw, rh, color, thickness = 1) => {
  drawLineOnPng(png, rx, ry, rx + rw, ry, color, thickness);
  drawLineOnPng(png, rx + rw, ry, rx + rw, ry + rh, color, thickness);
  drawLineOnPng(png, rx + rw, ry + rh, rx, ry + rh, color, thickness);
  drawLineOnPng(png, rx, ry + rh, rx, ry, color, thickness);
};

/* ------------------------------------------------------------------ */
/*  Debug image generators                                             */
/* ------------------------------------------------------------------ */

/**
 * Save rooms image: each room filled with a unique colour.
 */
const saveRoomsImage = (roomLabels, rooms, width, height, filePath) => {
  const png = new PNG({ width, height });
  // Black background
  for (let i = 0; i < width * height; i += 1) {
    png.data[i * 4 + 3] = 255;
  }

  // Build id→color map
  const idColorMap = new Map();
  rooms.forEach((room, idx) => {
    idColorMap.set(room.id, getColor(idx));
  });

  for (let i = 0; i < width * height; i += 1) {
    const label = roomLabels[i];
    const color = idColorMap.get(label);
    if (color) {
      png.data[i * 4] = color[0];
      png.data[i * 4 + 1] = color[1];
      png.data[i * 4 + 2] = color[2];
    }
  }

  writeFileSync(filePath, PNG.sync.write(png));
};

/**
 * Save contours image: room boundaries drawn on a blank canvas.
 */
const saveContoursImage = (rooms, width, height, filePath) => {
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height; i += 1) {
    png.data[i * 4] = 255;
    png.data[i * 4 + 1] = 255;
    png.data[i * 4 + 2] = 255;
    png.data[i * 4 + 3] = 255;
  }

  rooms.forEach((room, idx) => {
    const color = getColor(idx);
    const contour = room.contour;
    if (!contour || contour.length < 2) return;

    for (let i = 0; i < contour.length; i += 1) {
      const p1 = contour[i];
      const p2 = contour[(i + 1) % contour.length];
      drawLineOnPng(png, p1.x, p1.y, p2.x, p2.y, color, 1);
    }

    // Centroid
    drawCircleOnPng(png, room.centroid.x, room.centroid.y, 3, [255, 0, 0]);
  });

  writeFileSync(filePath, PNG.sync.write(png));
};

/**
 * Save text mapping image: OCR boxes drawn on top of room colours.
 */
const saveTextMappingImage = (imageData, rooms, ocrResults, width, height, filePath) => {
  const png = new PNG({ width, height });
  for (let i = 0; i < imageData.data.length; i += 1) {
    png.data[i] = imageData.data[i];
  }

  // Draw OCR bounding boxes
  for (const ocr of ocrResults) {
    drawRectOnPng(png, ocr.bbox.x, ocr.bbox.y, ocr.bbox.w, ocr.bbox.h, [0, 0, 255], 1);
  }

  // Draw room centroids with room index
  rooms.forEach((room, idx) => {
    const color = getColor(idx);
    drawCircleOnPng(png, room.centroid.x, room.centroid.y, 5, color);
  });

  writeFileSync(filePath, PNG.sync.write(png));
};

/**
 * Save final overlay: rooms + outer boundary + centroids + scale info.
 */
const saveFinalOverlay = (imageData, result, width, height, filePath) => {
  const png = new PNG({ width, height });
  for (let i = 0; i < imageData.data.length; i += 1) {
    png.data[i] = imageData.data[i];
  }

  // Semi-transparent room fills
  const idColorMap = new Map();
  result.rooms.forEach((room, idx) => {
    idColorMap.set(room.id, getColor(idx));
  });

  for (let i = 0; i < width * height; i += 1) {
    const label = result.roomLabels[i];
    const color = idColorMap.get(label);
    if (color) {
      const idx = i * 4;
      png.data[idx] = Math.round(png.data[idx] * 0.5 + color[0] * 0.5);
      png.data[idx + 1] = Math.round(png.data[idx + 1] * 0.5 + color[1] * 0.5);
      png.data[idx + 2] = Math.round(png.data[idx + 2] * 0.5 + color[2] * 0.5);
    }
  }

  // Outer boundary in thick red
  if (result.boundary?.outer) {
    const outer = result.boundary.outer;
    for (let i = 0; i < outer.length; i += 1) {
      const p1 = outer[i];
      const p2 = outer[(i + 1) % outer.length];
      drawLineOnPng(png, p1.x, p1.y, p2.x, p2.y, [255, 0, 0], 3);
    }
  }

  // Room centroids
  for (const room of result.rooms) {
    drawCircleOnPng(png, room.centroid.x, room.centroid.y, 4, [0, 255, 0]);
  }

  writeFileSync(filePath, PNG.sync.write(png));
};

/* ------------------------------------------------------------------ */
/*  Full integration test                                              */
/* ------------------------------------------------------------------ */

describe('ExampleFloorplan.png – full room segmentation pipeline', () => {
  // Stubbed OCR results (realistic positions for the example floorplan)
  const sampleOcrResults = [
    { text: 'BEDROOM', bbox: { x: 300, y: 400, w: 200, h: 40 } },
    { text: "13' 5\" x 12' 11\"", bbox: { x: 280, y: 450, w: 250, h: 30 } },
    { text: 'KITCHEN', bbox: { x: 900, y: 400, w: 200, h: 40 } },
    { text: "10' 2\" x 9' 8\"", bbox: { x: 880, y: 450, w: 250, h: 30 } },
    { text: 'LIVING ROOM', bbox: { x: 600, y: 800, w: 250, h: 40 } },
    { text: 'BATHROOM', bbox: { x: 1400, y: 300, w: 200, h: 40 } },
  ];

  let pipelineResult = null;
  let imageData = null;

  it('runs full pipeline successfully', { timeout: 30_000 }, () => {
    mkdirSync(OUTPUT_DIR, { recursive: true });
    imageData = loadPng('ExampleFloorplan.png');
    console.log(`[room-pipeline] Image: ${imageData.width}×${imageData.height}`);

    pipelineResult = runFullPipeline(imageData, sampleOcrResults);
    expect(pipelineResult).not.toBeNull();
    expect(pipelineResult.rooms).toBeDefined();
    expect(Array.isArray(pipelineResult.rooms)).toBe(true);

    console.log(`[room-pipeline] Rooms detected  : ${pipelineResult.log.roomCount}`);
    console.log(`[room-pipeline] OCR assigned    : ${pipelineResult.log.ocrAssigned}`);
    console.log(`[room-pipeline] OCR unassigned  : ${pipelineResult.log.ocrUnassigned}`);
    if (pipelineResult.scale) {
      console.log(`[room-pipeline] Scale mean      : ${pipelineResult.scale.meanScale.toFixed(4)}`);
      console.log(`[room-pipeline] Scale std       : ${pipelineResult.scale.stdScale.toFixed(4)}`);
    }
    for (const w of pipelineResult.log.warnings) {
      console.warn(`[room-pipeline] WARNING: ${w}`);
    }
  });

  it('detects at least 2 rooms', { timeout: 30_000 }, () => {
    if (!pipelineResult) {
      imageData = loadPng('ExampleFloorplan.png');
      pipelineResult = runFullPipeline(imageData, sampleOcrResults);
    }
    expect(pipelineResult.rooms.length).toBeGreaterThanOrEqual(2);
  });

  it('each room has valid features', { timeout: 30_000 }, () => {
    if (!pipelineResult) {
      imageData = loadPng('ExampleFloorplan.png');
      pipelineResult = runFullPipeline(imageData, sampleOcrResults);
    }
    for (const room of pipelineResult.rooms) {
      expect(room.contour.length).toBeGreaterThanOrEqual(3);
      expect(room.area).toBeGreaterThan(0);
      expect(room.centroid).toBeDefined();
      expect(room.bbox).toBeDefined();
    }
  });

  it('saves output_binary.png', { timeout: 30_000 }, () => {
    if (!pipelineResult) {
      imageData = loadPng('ExampleFloorplan.png');
      pipelineResult = runFullPipeline(imageData, sampleOcrResults);
    }
    const { width, height } = pipelineResult;
    saveMaskPng(pipelineResult.binary, width, height, resolve(OUTPUT_DIR, 'output_binary.png'));
    expect(existsSync(resolve(OUTPUT_DIR, 'output_binary.png'))).toBe(true);
  });

  it('saves output_cleaned_walls.png', { timeout: 30_000 }, () => {
    if (!pipelineResult) {
      imageData = loadPng('ExampleFloorplan.png');
      pipelineResult = runFullPipeline(imageData, sampleOcrResults);
    }
    const { width, height } = pipelineResult;
    saveMaskPng(pipelineResult.closedWalls, width, height, resolve(OUTPUT_DIR, 'output_cleaned_walls.png'));
    expect(existsSync(resolve(OUTPUT_DIR, 'output_cleaned_walls.png'))).toBe(true);
  });

  it('saves output_rooms.png', { timeout: 30_000 }, () => {
    if (!pipelineResult) {
      imageData = loadPng('ExampleFloorplan.png');
      pipelineResult = runFullPipeline(imageData, sampleOcrResults);
    }
    const { width, height } = pipelineResult;
    saveRoomsImage(pipelineResult.roomLabels, pipelineResult.rooms, width, height,
      resolve(OUTPUT_DIR, 'output_rooms.png'));
    expect(existsSync(resolve(OUTPUT_DIR, 'output_rooms.png'))).toBe(true);
  });

  it('saves output_contours.png', { timeout: 30_000 }, () => {
    if (!pipelineResult) {
      imageData = loadPng('ExampleFloorplan.png');
      pipelineResult = runFullPipeline(imageData, sampleOcrResults);
    }
    const { width, height } = pipelineResult;
    saveContoursImage(pipelineResult.rooms, width, height,
      resolve(OUTPUT_DIR, 'output_contours.png'));
    expect(existsSync(resolve(OUTPUT_DIR, 'output_contours.png'))).toBe(true);
  });

  it('saves output_text_mapping.png', { timeout: 30_000 }, () => {
    if (!pipelineResult) {
      imageData = loadPng('ExampleFloorplan.png');
      pipelineResult = runFullPipeline(imageData, sampleOcrResults);
    }
    const { width, height } = pipelineResult;
    saveTextMappingImage(imageData, pipelineResult.rooms, sampleOcrResults, width, height,
      resolve(OUTPUT_DIR, 'output_text_mapping.png'));
    expect(existsSync(resolve(OUTPUT_DIR, 'output_text_mapping.png'))).toBe(true);
  });

  it('saves output_final_overlay.png', { timeout: 30_000 }, () => {
    if (!pipelineResult) {
      imageData = loadPng('ExampleFloorplan.png');
      pipelineResult = runFullPipeline(imageData, sampleOcrResults);
    }
    const { width, height } = pipelineResult;
    saveFinalOverlay(imageData, pipelineResult, width, height,
      resolve(OUTPUT_DIR, 'output_final_overlay.png'));
    expect(existsSync(resolve(OUTPUT_DIR, 'output_final_overlay.png'))).toBe(true);
  });
});
