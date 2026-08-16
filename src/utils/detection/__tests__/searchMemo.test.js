// The search memo (`cacheKey` -> wall networks + every closing-ladder rung) is
// what stops a room placement paying for a whole boundary trace, and until now
// nothing in the repo exercised it: `detectionBenchmark.mjs` passes no
// cacheKey, so every bench run measured the cold path only.
//
// The property that matters is not "the memo is fast" but "the memo cannot
// change the answer" — a warm trace must be bit-identical to a cold one.
//
// Split across three files (see searchMemoShared.js for why); this one holds
// the warm-equals-cold property, searchMemoKey covers the memo key, and
// searchMemoBudget covers the byte budget.
import { describe, expect, it, beforeAll, beforeEach } from 'vitest';
import { traceFloorplanBoundaryCore, detectRoomFromClickCore } from '../pipeline.js';
import { clearDetectionCache } from '../cache.js';
import { FIXTURES, geometryOf, loadFixtures } from './searchMemoShared.js';

let images;

beforeAll(() => {
  images = loadFixtures();
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
