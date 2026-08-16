// The memo's byte budget, and what happens when a search charges past it.
// Split out of searchMemo.test.js — see searchMemoShared.js.
import { describe, expect, it, beforeAll, beforeEach, afterEach } from 'vitest';
import { traceFloorplanBoundaryCore } from '../pipeline.js';
import { clearDetectionCache, setSearchBudgetBytes, searchCacheStats } from '../cache.js';
import { FIXTURES, geometryOf, loadFixtures } from './searchMemoShared.js';

let images;

beforeAll(() => {
  images = loadFixtures();
});

beforeEach(() => {
  clearDetectionCache();
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
