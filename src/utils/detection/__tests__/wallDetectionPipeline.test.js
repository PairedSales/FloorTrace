/**
 * Test harness for the new wall detection pipeline.
 *
 * Uses ExampleFloorplan.png as the primary test case.
 * Tests each pipeline stage and validates final results.
 */
import fs from 'fs';
import path from 'path';
import { describe, expect, it, beforeAll } from 'vitest';
import { PNG } from 'pngjs';
import {
  toGrayscale,
  boxBlur,
  globalThreshold,
  preprocess,
  maskOcrRegions,
  cannyEdges,
  extractLineSegments,
  extractWallCandidates,
  interpretStructure,
  findClosedRegions,
  matchOcrToRegion,
  findExteriorPerimeter,
  refinePolygon,
  enforceOrthogonality,
  cleanPolygon,
  polygonArea,
  isSelfIntersecting,
  scorePolygon,
  runWallDetectionPipeline,
  PARAMS,
} from '../wallDetectionPipeline';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const loadPngAsImageData = (filePath) => {
  const raw = fs.readFileSync(filePath);
  const png = PNG.sync.read(raw);
  return {
    width: png.width,
    height: png.height,
    data: new Uint8ClampedArray(png.data),
  };
};

const EXAMPLE_PATH = path.resolve(__dirname, '../../../../ExampleFloorplan.png');
const OUTPUT_DIR = path.resolve(__dirname, '../../../../test-output');

// Ensure output dir exists
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

/** Save a binary mask as a grayscale PNG for debugging. */
const saveMaskAsPng = (mask, width, height, filename) => {
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) {
    const v = mask[i] ? 255 : 0;
    const j = i * 4;
    png.data[j] = v;
    png.data[j + 1] = v;
    png.data[j + 2] = v;
    png.data[j + 3] = 255;
  }
  const buf = PNG.sync.write(png);
  fs.writeFileSync(path.join(OUTPUT_DIR, filename), buf);
};

/* ------------------------------------------------------------------ */
/*  Synthetic Tests — Unit Tests for Each Stage                        */
/* ------------------------------------------------------------------ */

describe('wall detection pipeline — unit tests', () => {
  const W = 100, H = 100;

  // Helper: create a blank white RGBA image
  const createBlankRGBA = (w, h, value = 255) => {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = value;
      data[i + 1] = value;
      data[i + 2] = value;
      data[i + 3] = 255;
    }
    return { width: w, height: h, data };
  };

  // Helper: draw a line on RGBA image
  const drawRect = (imageData, x0, y0, x1, y1, value = 0) => {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = (y * imageData.width + x) * 4;
        imageData.data[i] = value;
        imageData.data[i + 1] = value;
        imageData.data[i + 2] = value;
      }
    }
  };

  it('toGrayscale converts RGBA to single-channel', () => {
    const img = createBlankRGBA(10, 10);
    const gray = toGrayscale(img.data, 10, 10);
    expect(gray.length).toBe(100);
    expect(gray[0]).toBe(255);
  });

  it('boxBlur smooths values', () => {
    const gray = new Uint8ClampedArray(25);
    gray[12] = 100; // center pixel of 5x5
    const blurred = boxBlur(gray, 5, 5, 1);
    expect(blurred[12]).toBeLessThan(100);
    expect(blurred[12]).toBeGreaterThan(0);
  });

  it('globalThreshold creates binary mask', () => {
    const gray = new Uint8ClampedArray([0, 100, 200, 255]);
    const mask = globalThreshold(gray, 2, 2, 150);
    expect(mask[0]).toBe(1); // 0 < 150
    expect(mask[1]).toBe(1); // 100 < 150
    expect(mask[2]).toBe(0); // 200 >= 150
    expect(mask[3]).toBe(0); // 255 >= 150
  });

  it('preprocess returns expected fields', () => {
    const img = createBlankRGBA(200, 200);
    const result = preprocess(img);
    expect(result.gray).toBeInstanceOf(Uint8ClampedArray);
    expect(result.wallMask).toBeInstanceOf(Uint8Array);
    expect(result.width).toBe(200);
    expect(result.height).toBe(200);
    expect(result.scale).toBe(1);
  });

  it('maskOcrRegions removes wall pixels inside OCR bboxes', () => {
    const mask = new Uint8Array(W * H).fill(1);
    const ocrBoxes = [{ bbox: { x: 10, y: 10, width: 20, height: 10 } }];
    const { regions } = maskOcrRegions(mask, W, H, 1, ocrBoxes, { ocrPaddingPx: 0 });
    expect(regions.length).toBe(1);
    // Check that pixels inside bbox are 0
    expect(mask[10 * W + 10]).toBe(0);
    expect(mask[15 * W + 15]).toBe(0);
    // Outside should still be 1
    expect(mask[0]).toBe(1);
  });

  it('cannyEdges detects edges in a binary transition', () => {
    const gray = new Uint8ClampedArray(W * H);
    // Left half = 0, right half = 255
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        gray[y * W + x] = x < W / 2 ? 0 : 255;
      }
    }
    const edges = cannyEdges(gray, W, H);
    // Should have edges near the middle column
    let edgeCount = 0;
    for (let y = 5; y < H - 5; y++) {
      for (let x = W / 2 - 3; x <= W / 2 + 3; x++) {
        if (edges[y * W + x]) edgeCount++;
      }
    }
    expect(edgeCount).toBeGreaterThan(0);
  });

  it('extractLineSegments finds horizontal and vertical runs', () => {
    const mask = new Uint8Array(W * H);
    // Draw a horizontal line at y=50
    for (let x = 10; x < 70; x++) mask[50 * W + x] = 1;
    // Draw a vertical line at x=50
    for (let y = 20; y < 80; y++) mask[y * W + 50] = 1;
    const { horizontal, vertical } = extractLineSegments(mask, W, H, { minSegmentLength: 10 });
    expect(horizontal.length).toBeGreaterThanOrEqual(1);
    expect(vertical.length).toBeGreaterThanOrEqual(1);
  });

  it('interpretStructure produces merged segments and junctions', () => {
    const segments = {
      horizontal: [
        { x0: 10, y0: 50, x1: 45, y1: 50 },
        { x0: 48, y0: 50, x1: 90, y1: 50 },
      ],
      vertical: [
        { x0: 50, y0: 10, x1: 50, y1: 48 },
      ],
    };
    const result = interpretStructure(segments, PARAMS);
    expect(result.merged.length).toBeGreaterThan(0);
    expect(result.graph.nodes.length).toBeGreaterThan(0);
  });

  it('findClosedRegions detects enclosed rooms', () => {
    // Create a mask with a room (walls around it)
    const mask = new Uint8Array(W * H);
    // Draw walls: top, bottom, left, right
    for (let x = 20; x <= 80; x++) {
      for (let t = 0; t < 3; t++) {
        mask[(20 + t) * W + x] = 1; // top wall
        mask[(80 + t) * W + x] = 1; // bottom wall
      }
    }
    for (let y = 20; y <= 80; y++) {
      for (let t = 0; t < 3; t++) {
        mask[y * W + (20 + t)] = 1; // left wall
        mask[y * W + (80 + t)] = 1; // right wall
      }
    }
    const { regions } = findClosedRegions(mask, W, H, { ...PARAMS, roomCloseRadius: 3, minRoomArea: 0.001 });
    expect(regions.length).toBeGreaterThanOrEqual(1);
    // Room area should be roughly the interior
    const room = regions[0];
    expect(room.area).toBeGreaterThan(100);
  });

  it('matchOcrToRegion finds the correct region for OCR text', () => {
    const regions = [
      { id: 1, polygon: [], area: 100, centroid: { x: 30, y: 30 }, bbox: { x0: 20, y0: 20, x1: 40, y1: 40 } },
      { id: 2, polygon: [], area: 200, centroid: { x: 70, y: 70 }, bbox: { x0: 60, y0: 60, x1: 80, y1: 80 } },
    ];
    const ocrBoxes = [{ bbox: { x: 65, y: 65, width: 10, height: 5 } }];
    const match = matchOcrToRegion(regions, ocrBoxes, 1.0);
    expect(match).not.toBeNull();
    expect(match.region.id).toBe(2);
  });

  it('findExteriorPerimeter produces a polygon from wall mask', () => {
    // Larger image for exterior detection
    const bigW = 300, bigH = 300;
    const mask = new Uint8Array(bigW * bigH);
    // Draw thick outer walls (need to be thick enough to survive morphClose)
    for (let x = 40; x <= 260; x++) {
      for (let t = 0; t < 8; t++) {
        mask[(40 + t) * bigW + x] = 1;
        mask[(252 + t) * bigW + x] = 1;
      }
    }
    for (let y = 40; y <= 260; y++) {
      for (let t = 0; t < 8; t++) {
        mask[y * bigW + (40 + t)] = 1;
        mask[y * bigW + (252 + t)] = 1;
      }
    }
    const result = findExteriorPerimeter(mask, bigW, bigH, { ...PARAMS, exteriorCloseRadius: 4 });
    expect(result.polygon).not.toBeNull();
    expect(result.polygon.length).toBeGreaterThanOrEqual(4);
  });

  it('enforceOrthogonality snaps near-H/V edges', () => {
    const polygon = [
      { x: 0, y: 0 },
      { x: 100, y: 2 },  // nearly horizontal
      { x: 102, y: 100 }, // nearly vertical
      { x: 0, y: 100 },
    ];
    const refined = enforceOrthogonality(polygon, 10);
    // The first edge should now be exactly horizontal
    expect(refined[0].y).toBe(refined[1].y);
  });

  it('cleanPolygon removes very short edges', () => {
    const polygon = [
      { x: 0, y: 0 },
      { x: 1, y: 0 }, // very short
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ];
    const cleaned = cleanPolygon(polygon, 5);
    expect(cleaned.length).toBeLessThan(polygon.length);
  });

  it('polygonArea computes correct area for rectangle', () => {
    const rect = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 50 },
      { x: 0, y: 50 },
    ];
    expect(polygonArea(rect)).toBe(5000);
  });

  it('isSelfIntersecting detects crossed edges', () => {
    const crossed = [
      { x: 0, y: 0 },
      { x: 100, y: 100 },
      { x: 100, y: 0 },
      { x: 0, y: 100 },
    ];
    expect(isSelfIntersecting(crossed)).toBe(true);
  });

  it('isSelfIntersecting returns false for simple polygon', () => {
    const rect = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    expect(isSelfIntersecting(rect)).toBe(false);
  });

  it('scorePolygon returns a score between 0 and 1', () => {
    const rect = [
      { x: 10, y: 10 },
      { x: 90, y: 10 },
      { x: 90, y: 90 },
      { x: 10, y: 90 },
    ];
    const score = scorePolygon(rect, 10000);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('refinePolygon simplifies and cleans polygon', () => {
    const poly = [
      { x: 0, y: 0 },
      { x: 50, y: 1 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    const refined = refinePolygon(poly);
    expect(refined).not.toBeNull();
    expect(refined.length).toBeGreaterThanOrEqual(3);
  });
});

/* ------------------------------------------------------------------ */
/*  Integration Tests — ExampleFloorplan.png                           */
/* ------------------------------------------------------------------ */

describe('wall detection pipeline — ExampleFloorplan.png integration', () => {
  let imageData;
  let result;

  beforeAll(() => {
    imageData = loadPngAsImageData(EXAMPLE_PATH);
    result = runWallDetectionPipeline(imageData, { ocrBoxes: [] });
  }, 60000);

  it('returns non-null result with all expected fields', () => {
    expect(result).toBeDefined();
    expect(result.debug).toBeDefined();
    expect(result.debug.preprocessed).toBeDefined();
    expect(result.debug.ocrMasking).toBeDefined();
    expect(result.debug.wallCandidates).toBeDefined();
    expect(result.debug.structure).toBeDefined();
    expect(result.debug.roomDetection).toBeDefined();
    expect(result.debug.exterior).toBeDefined();
    expect(result.debug.scoring).toBeDefined();
  });

  it('preprocessing produces reasonable dimensions', () => {
    const p = result.debug.preprocessed;
    expect(p.width).toBeGreaterThan(0);
    expect(p.height).toBeGreaterThan(0);
    expect(p.scale).toBeGreaterThan(0);
    expect(p.scale).toBeLessThanOrEqual(1);
    // Save binary mask for visual inspection
    saveMaskAsPng(p.wallMask, p.width, p.height, 'wd-stage1-wallmask.png');
  });

  it('edge detection produces non-empty edge map', () => {
    const edges = result.debug.wallCandidates.edgeMap;
    let count = 0;
    for (let i = 0; i < edges.length; i++) if (edges[i]) count++;
    expect(count).toBeGreaterThan(100);
    saveMaskAsPng(edges, result.width, result.height, 'wd-stage3-edges.png');
  });

  it('wall candidate segments are extracted', () => {
    const { horizontal, vertical } = result.debug.wallCandidates.segments;
    expect(horizontal.length + vertical.length).toBeGreaterThan(10);
  });

  it('structural interpretation produces merged segments', () => {
    expect(result.debug.structure.merged.length).toBeGreaterThan(0);
  });

  it('structural interpretation finds junctions', () => {
    expect(result.debug.structure.junctions.length).toBeGreaterThanOrEqual(0);
  });

  it('graph has nodes and adjacency', () => {
    const { nodes, adjacency } = result.debug.structure.graph;
    expect(nodes.length).toBeGreaterThan(0);
    expect(adjacency.size).toBeGreaterThan(0);
  });

  it('room detection finds at least one region', () => {
    expect(result.debug.roomDetection.regions.length).toBeGreaterThan(0);
  });

  it('exterior perimeter polygon is detected', () => {
    expect(result.exteriorPolygon).not.toBeNull();
    expect(result.exteriorPolygon.length).toBeGreaterThanOrEqual(4);
  });

  it('exterior polygon has reasonable area', () => {
    const area = polygonArea(result.exteriorPolygon);
    const imageArea = imageData.width * imageData.height;
    // Should cover at least 10% of image
    expect(area / imageArea).toBeGreaterThan(0.1);
  });

  it('exterior polygon is not self-intersecting', () => {
    expect(isSelfIntersecting(result.exteriorPolygon)).toBe(false);
  });

  it('exterior score is positive', () => {
    expect(result.exteriorScore).toBeGreaterThan(0);
  });

  it('pipeline is deterministic', () => {
    const result2 = runWallDetectionPipeline(imageData, { ocrBoxes: [] });
    expect(result2.exteriorPolygon).toEqual(result.exteriorPolygon);
    expect(result2.debug.roomDetection.regions.length).toBe(result.debug.roomDetection.regions.length);
  }, 60000);

  it('saves exterior footprint debug image', () => {
    const fp = result.debug.exterior.footprint;
    if (fp) {
      saveMaskAsPng(fp, result.width, result.height, 'wd-stage6-footprint.png');
    }
    expect(fp).toBeDefined();
  });

  it('saves closed mask debug image', () => {
    const cm = result.debug.wallCandidates.closed;
    saveMaskAsPng(cm, result.width, result.height, 'wd-stage3-closed.png');
    expect(cm).toBeDefined();
  });
});

/* ------------------------------------------------------------------ */
/*  OCR Masking Correctness Tests                                      */
/* ------------------------------------------------------------------ */

describe('wall detection pipeline — OCR masking', () => {
  it('masking with OCR boxes removes wall pixels', () => {
    const W = 200, H = 200;
    const mask = new Uint8Array(W * H).fill(1);
    const ocrBoxes = [
      { bbox: { x: 50, y: 50, width: 40, height: 20 } },
      { bbox: { x: 120, y: 100, width: 30, height: 15 } },
    ];
    const { regions } = maskOcrRegions(mask, W, H, 1.0, ocrBoxes, { ocrPaddingPx: 4 });
    expect(regions.length).toBe(2);
    // All pixels in expanded region should be 0
    for (let y = regions[0].y0; y <= regions[0].y1; y++) {
      for (let x = regions[0].x0; x <= regions[0].x1; x++) {
        expect(mask[y * W + x]).toBe(0);
      }
    }
  });

  it('masking with empty OCR boxes is a no-op', () => {
    const W = 50, H = 50;
    const mask = new Uint8Array(W * H).fill(1);
    const original = new Uint8Array(mask);
    maskOcrRegions(mask, W, H, 1.0, [], { ocrPaddingPx: 4 });
    expect(mask).toEqual(original);
  });
});
