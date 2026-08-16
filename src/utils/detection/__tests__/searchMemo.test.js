// The search memo (`cacheKey` -> wall networks + every closing-ladder rung) is
// what stops a room placement paying for a whole boundary trace, and until now
// nothing in the repo exercised it: `detectionBenchmark.mjs` passes no
// cacheKey, so every bench run measured the cold path only.
//
// The property that matters is not "the memo is fast" but "the memo cannot
// change the answer" — a warm trace must be bit-identical to a cold one, and
// must stay identical when the memo gives up on its byte budget mid-search.
import fs from 'fs';
import path from 'path';
import { describe, expect, it, beforeAll, beforeEach, afterEach } from 'vitest';
import { PNG } from 'pngjs';
import { traceFloorplanBoundaryCore, detectRoomFromClickCore } from '../pipeline.js';
import { clearDetectionCache, setSearchBudgetBytes, searchCacheStats } from '../cache.js';

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..', '..');

const loadPng = (filePath) => {
  const png = PNG.sync.read(fs.readFileSync(filePath));
  return { width: png.width, height: png.height, data: new Uint8ClampedArray(png.data) };
};

// Everything a caller can observe about a trace's geometry. Deliberately not a
// tolerance comparison: warm and cold run the same code over the same rasters,
// so any difference at all is a memo bug.
const geometryOf = (result) => ({
  outer: result.outer?.polygon ?? null,
  inner: result.inner?.polygon ?? null,
  holes: result.holes ?? [],
  innerHoles: result.innerHoles ?? [],
  excludedRegions: result.excludedRegions,
  excludedGarages: result.excludedGarages,
  floors: (result.floors ?? []).map((f) => ({
    outer: f.outer?.polygon ?? null,
    inner: f.inner?.polygon ?? null,
    holes: f.holes,
    innerHoles: f.innerHoles,
    confidence: f.confidence,
    excluded: f.excluded,
    excludedGarages: f.excludedGarages,
    candidate: f.candidate,
  })),
  quality: {
    confidence: result.quality.confidence,
    usedFallback: result.quality.usedFallback,
    source: result.quality.source,
    floorCount: result.quality.floorCount,
    candidate: result.quality.candidate,
    areaPx: result.quality.areaPx,
    warnings: result.quality.warnings.map((w) => ({ code: w.code, severity: w.severity })),
  },
});

const FIXTURES = [
  'ExampleFloorplan.png',
  'ExampleFloorplan2.png',
  'ExampleFloorplan4.png',
  'ExampleFloorplan5.png',
  'ExampleFloorplan7.png',
];

const images = new Map();

beforeAll(() => {
  for (const name of FIXTURES) images.set(name, loadPng(path.join(ROOT, 'fixtures', name)));
});

beforeEach(() => {
  clearDetectionCache();
});

describe('search memo: a warm trace equals a cold trace', () => {
  it.each(FIXTURES)('%s traces identically on the second run', (name) => {
    const image = images.get(name);
    const cold = geometryOf(traceFloorplanBoundaryCore(image, { cacheKey: name }));
    const warm = geometryOf(traceFloorplanBoundaryCore(image, { cacheKey: name }));
    expect(warm).toEqual(cold);
  });

  it.each(FIXTURES)('%s traces identically with no cacheKey at all', (name) => {
    const image = images.get(name);
    const memoised = geometryOf(traceFloorplanBoundaryCore(image, { cacheKey: name }));
    clearDetectionCache();
    const unmemoised = geometryOf(traceFloorplanBoundaryCore(image, {}));
    expect(memoised).toEqual(unmemoised);
  });

  // A room placement runs an `inclusive` clamp trace and then a perimeter
  // trace over the same cacheKey — the exact sequence App.jsx performs, and
  // the one the memo exists to serve. The clamp trace must not poison it.
  it.each(FIXTURES)('%s traces identically after a room-clamp trace on the same key', (name) => {
    const image = images.get(name);
    const alone = geometryOf(traceFloorplanBoundaryCore(image, { cacheKey: name }));
    clearDetectionCache();
    detectRoomFromClickCore(
      image,
      { x: Math.round(image.width / 2), y: Math.round(image.height / 2) },
      { cacheKey: name },
    );
    const afterClamp = geometryOf(traceFloorplanBoundaryCore(image, { cacheKey: name }));
    expect(afterClamp).toEqual(alone);
  });
});

describe('search memo: the key covers what the search computes', () => {
  // `generateCandidates` derives `maxRadius`, and therefore the entire closing
  // ladder, from `options.maxCloseRadius`. The nets key carried that option and
  // the candidates key did not, so a second trace of one image at a different
  // radius was answered with the first radius's candidate set.
  it.each(FIXTURES)('%s traces per radius, not per image', (name) => {
    const image = images.get(name);

    const narrowAlone = geometryOf(traceFloorplanBoundaryCore(image, {
      cacheKey: name, boundary: { maxCloseRadius: 8 },
    }));
    clearDetectionCache();

    // Same cacheKey, wide first, then narrow: the narrow trace must equal the
    // one computed with no memo in the way.
    traceFloorplanBoundaryCore(image, { cacheKey: name, boundary: { maxCloseRadius: 48 } });
    const narrowAfterWide = geometryOf(traceFloorplanBoundaryCore(image, {
      cacheKey: name, boundary: { maxCloseRadius: 8 },
    }));

    expect(narrowAfterWide).toEqual(narrowAlone);
  });

  it('the two radii do change the answer somewhere in the fixture set', () => {
    let anyDiffer = false;
    for (const name of FIXTURES) {
      const image = images.get(name);
      clearDetectionCache();
      const wide = geometryOf(traceFloorplanBoundaryCore(image, { boundary: { maxCloseRadius: 48 } }));
      clearDetectionCache();
      const narrow = geometryOf(traceFloorplanBoundaryCore(image, { boundary: { maxCloseRadius: 8 } }));
      if (JSON.stringify(wide) !== JSON.stringify(narrow)) anyDiffer = true;
    }
    expect(anyDiffer).toBe(true);
  });
});

describe('search memo: giving up on budget cannot change the answer', () => {
  afterEach(() => {
    setSearchBudgetBytes(null);
  });

  // The cache stops storing once the search charges past its byte budget, and
  // `getSearchCache` only builds a new one when the key changes — so a starved
  // memo stays starved for as long as that image is open. That path is reached
  // on real multi-plan sheets, so a memo that only agreed with a cold trace
  // while it was alive would be worse than no memo at all.
  it.each(FIXTURES)('%s traces identically with a budget of one byte', (name) => {
    const image = images.get(name);
    const cold = geometryOf(traceFloorplanBoundaryCore(image, { cacheKey: name }));
    clearDetectionCache();

    setSearchBudgetBytes(1);
    const key = `${name}::starved`;
    const first = geometryOf(traceFloorplanBoundaryCore(image, { cacheKey: key }));
    // The second run meets the over-budget memo, which stored nothing at all.
    const second = geometryOf(traceFloorplanBoundaryCore(image, { cacheKey: key }));
    expect(first).toEqual(cold);
    expect(second).toEqual(cold);
  });

  // Tripping the budget used to CLEAR the cache, and since the key never
  // changes for one image the memo then stayed empty for as long as that image
  // was open — turning the perimeter trace back into a full cold trace. No
  // fixture is large enough to reach the real 32 MB budget, which is exactly
  // why it was never seen; a mid-search budget reproduces it.
  it.each(FIXTURES)('%s keeps its early rungs when the budget trips mid-search', (name) => {
    const image = images.get(name);
    const cold = geometryOf(traceFloorplanBoundaryCore(image, { cacheKey: name }));
    clearDetectionCache();

    // Large enough that the ladder stores real entries first, small enough that
    // the search charges past it before finishing.
    setSearchBudgetBytes(2 * 1024 * 1024);
    const key = `${name}::tripped`;
    const first = geometryOf(traceFloorplanBoundaryCore(image, { cacheKey: key }));
    const stats = searchCacheStats();

    expect(stats.overBudget).toBe(true);
    // The point of the fix: the memo degrades instead of dying.
    expect(stats.entries).toBeGreaterThan(0);

    const second = geometryOf(traceFloorplanBoundaryCore(image, { cacheKey: key }));
    expect(first).toEqual(cold);
    expect(second).toEqual(cold);
  });
});
