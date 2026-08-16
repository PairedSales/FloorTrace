// `wallSnapSegmentsCore` exists to make the snap request that already fires on
// every image change double as the analysis prewarm for the room and boundary
// stages. That is only legitimate if it returns exactly what the standalone
// snap engine returned — the snap engine binarized the image itself, and
// `analyzeFloorplan` binarizes it again as its first step, at the same 1400 px
// working scale. These tests pin both halves of that claim:
//
//   1. identical segments to `wallSnapEngine.wallSnapSegments`, and
//   2. the analysis it leaves behind is the one the room/boundary cores read,
//      so a trace after a snap request equals a trace without one.
import fs from 'fs';
import path from 'path';
import { describe, expect, it, beforeAll } from 'vitest';
import { PNG } from 'pngjs';
import {
  wallSnapSegmentsCore, traceFloorplanBoundaryCore, detectRoomFromClickCore,
  prewarmDetectionCore,
} from '../pipeline.js';
import { wallSnapSegments } from '../../wallSnapEngine.js';
import { clearDetectionCache } from '../cache.js';

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..', '..');

const loadPng = (filePath) => {
  const png = PNG.sync.read(fs.readFileSync(filePath));
  return { width: png.width, height: png.height, data: new Uint8ClampedArray(png.data) };
};

const FIXTURES = [
  'ExampleFloorplan.png',   // two floors on one sheet, attached garage
  'ExampleFloorplan2.png',  // four plans on one sheet
  'ExampleFloorplan4.png',  // the hardest fixture for OCR and the tracer alike
  'ExampleFloorplan5.png',  // charges closest to the search-memo budget
  'ExampleFloorplan6.png',  // small, clean, thin walls
  'ExampleFloorplan7.png',  // tall single plan
];

const images = {};

beforeAll(() => {
  for (const name of FIXTURES) {
    images[name] = loadPng(path.join(ROOT, 'fixtures', name));
  }
});

describe('wallSnapSegmentsCore matches the standalone snap engine', () => {
  for (const name of FIXTURES) {
    it(`${name} produces identical segments`, () => {
      clearDetectionCache();
      const viaAnalysis = wallSnapSegmentsCore(images[name], { cacheKey: `snap:${name}` });
      const standalone = wallSnapSegments(images[name]);

      expect(viaAnalysis.scaleX).toBe(standalone.scaleX);
      expect(viaAnalysis.scaleY).toBe(standalone.scaleY);
      // Deep equality on the segment lists: the snap engine's whole contract is
      // where an edge lands, so a single shifted face is a user-visible change.
      expect(viaAnalysis.vertical).toEqual(standalone.vertical);
      expect(viaAnalysis.horizontal).toEqual(standalone.horizontal);
    });
  }

  it('produces segments without a cacheKey too (the uncached fallback path)', () => {
    clearDetectionCache();
    const uncached = wallSnapSegmentsCore(images['ExampleFloorplan6.png']);
    const standalone = wallSnapSegments(images['ExampleFloorplan6.png']);
    expect(uncached.vertical).toEqual(standalone.vertical);
    expect(uncached.horizontal).toEqual(standalone.horizontal);
  });
});

describe('a snap request prewarms without changing any later result', () => {
  for (const name of FIXTURES) {
    it(`${name} traces identically after a snap request on the same key`, () => {
      clearDetectionCache();
      const cold = traceFloorplanBoundaryCore(images[name], { cacheKey: `cold:${name}` });

      clearDetectionCache();
      wallSnapSegmentsCore(images[name], { cacheKey: `warm:${name}` });
      const warm = traceFloorplanBoundaryCore(images[name], { cacheKey: `warm:${name}` });

      expect(warm.outer?.polygon).toEqual(cold.outer?.polygon);
      expect(warm.inner?.polygon).toEqual(cold.inner?.polygon);
      expect(warm.floors.length).toBe(cold.floors.length);
      expect(warm.quality.confidence).toBe(cold.quality.confidence);
      expect(warm.quality.warnings.map((w) => w.code).sort())
        .toEqual(cold.quality.warnings.map((w) => w.code).sort());
    });
  }

  it('room detection is unchanged after a snap request on the same key', () => {
    const image = images['ExampleFloorplan.png'];
    const click = { x: 250, y: 573 };

    clearDetectionCache();
    const cold = detectRoomFromClickCore(image, click, { cacheKey: 'cold:room' });

    clearDetectionCache();
    wallSnapSegmentsCore(image, { cacheKey: 'warm:room' });
    const warm = detectRoomFromClickCore(image, click, { cacheKey: 'warm:room' });

    expect(warm.rect).toEqual(cold.rect);
    expect(warm.confidence).toBe(cold.confidence);
    expect(warm.pixelsPerFoot).toEqual(cold.pixelsPerFoot);
  });
});

// `prewarmDetectionCore` goes further than the snap request: it also runs the
// room-clamp ladder, which is the expensive half of step 4. It resolves to the
// SAME memo entry `detectRoomFromClickCore` builds — not an approximation of it
// — so these assert that claim directly. If the prewarm ever keys differently
// these stay green while the speed-up silently disappears, which is what the
// timing assertion at the end is for.
describe('the detection prewarm cannot change the answer', () => {
  for (const name of FIXTURES) {
    it(`${name}: prewarm, then room + trace, equals room + trace alone`, () => {
      const image = images[name];
      const click = { x: Math.round(image.width / 2), y: Math.round(image.height / 2) };
      // The shape the app actually sends: parsed labels as known-inside points.
      const constraints = {
        rooms: [],
        interiorPoints: [
          { x: Math.round(image.width * 0.35), y: Math.round(image.height * 0.4), name: null },
          { x: Math.round(image.width * 0.6), y: Math.round(image.height * 0.6), name: null },
        ],
      };

      clearDetectionCache();
      const roomAlone = detectRoomFromClickCore(image, click, { cacheKey: `plain:${name}` });
      const traceAlone = traceFloorplanBoundaryCore(image, { cacheKey: `plain:${name}`, constraints });

      clearDetectionCache();
      const warmKey = `prewarmed:${name}`;
      prewarmDetectionCore(image, { cacheKey: warmKey });
      const roomWarm = detectRoomFromClickCore(image, click, { cacheKey: warmKey });
      const traceWarm = traceFloorplanBoundaryCore(image, { cacheKey: warmKey, constraints });

      expect(roomWarm?.rect).toEqual(roomAlone?.rect);
      expect(roomWarm?.confidence).toBe(roomAlone?.confidence);
      expect(roomWarm?.pixelsPerFoot).toEqual(roomAlone?.pixelsPerFoot);
      expect(roomWarm?.sides).toEqual(roomAlone?.sides);

      expect(traceWarm.outer?.polygon).toEqual(traceAlone.outer?.polygon);
      expect(traceWarm.inner?.polygon).toEqual(traceAlone.inner?.polygon);
      expect(traceWarm.quality.confidence).toBe(traceAlone.quality.confidence);
      expect(traceWarm.quality.warnings.map((w) => w.code).sort())
        .toEqual(traceAlone.quality.warnings.map((w) => w.code).sort());
    });
  }

  it('leaves the clamp memo populated, so step 4 is actually served from it', () => {
    const image = images['ExampleFloorplan.png'];
    clearDetectionCache();
    prewarmDetectionCore(image, { cacheKey: 'warm-only' });

    // The prewarm's whole purpose is only observable as time: a cold clamp on
    // this fixture is hundreds of ms, a memo hit is single-digit.
    const t0 = Date.now();
    detectRoomFromClickCore(image, { x: 400, y: 300 }, { cacheKey: 'warm-only' });
    const warmMs = Date.now() - t0;

    clearDetectionCache();
    const t1 = Date.now();
    detectRoomFromClickCore(image, { x: 400, y: 300 }, { cacheKey: 'cold-only' });
    const coldMs = Date.now() - t1;

    expect(warmMs).toBeLessThan(coldMs / 2);
  });
});
