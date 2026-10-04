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
  // One test per plan, sharing its traces: every comparison below is against
  // the same unmemoised answer, so tracing it once per claim only bought time.
  it.each(FIXTURES)('%s traces identically cold, warm, unkeyed and after a room clamp', (name) => {
    const image = images.get(name);
    const unmemoised = geometryOf(traceFloorplanBoundaryCore(image, {}));

    clearDetectionCache();
    const cold = geometryOf(traceFloorplanBoundaryCore(image, { cacheKey: name }));
    const warm = geometryOf(traceFloorplanBoundaryCore(image, { cacheKey: name }));
    expect(cold, 'first keyed run vs no cacheKey at all').toEqual(unmemoised);
    expect(warm, 'second run on the same key').toEqual(unmemoised);

    // A room placement runs an `inclusive` clamp trace and then a perimeter
    // trace over the same cacheKey — the exact sequence App.jsx performs, and
    // the one the memo exists to serve. The clamp trace must not poison it.
    clearDetectionCache();
    detectRoomFromClickCore(
      image,
      { x: Math.round(image.width / 2), y: Math.round(image.height / 2) },
      { cacheKey: name },
    );
    const afterClamp = geometryOf(traceFloorplanBoundaryCore(image, { cacheKey: name }));
    expect(afterClamp, 'after a room-clamp trace on the same key').toEqual(unmemoised);
  });
});
