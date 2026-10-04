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

// The two plans the first-network trip is tuned to. The starved and the
// first-network cases are properties of the cache rather than of any plan's
// geometry, and each costs two full boundary searches, so two plans is the
// useful coverage; where the mid-search trip lands does depend on the plan, so
// that one runs on all of them.
const TRIP_FIXTURES = ['ExampleFloorplan5.png', 'ExampleFloorplan7.png'];

describe('search memo: giving up on budget cannot change the answer', () => {
  afterEach(() => {
    setSearchBudgetBytes(null);
  });

  // Two traces on one over-budget key, both compared with the cold answer.
  const tracedTwiceUnder = (image, key, bytes) => {
    setSearchBudgetBytes(bytes);
    const first = geometryOf(traceFloorplanBoundaryCore(image, { cacheKey: key }));
    const stats = searchCacheStats();
    const second = geometryOf(traceFloorplanBoundaryCore(image, { cacheKey: key }));
    return { first, second, stats };
  };

  // One test per plan, sharing the cold trace every budget is compared with.
  it.each(FIXTURES)('%s traces identically however the budget trips', (name) => {
    const image = images.get(name);
    const cold = geometryOf(traceFloorplanBoundaryCore(image, { cacheKey: name }));
    clearDetectionCache();

    // Tripping the budget used to CLEAR the cache, and since the key never
    // changes for one image the memo then stayed empty for as long as that
    // image was open — turning the perimeter trace back into a full cold trace.
    // No fixture is large enough to reach the real 32 MB budget, which is
    // exactly why it was never seen; a mid-search budget reproduces it. Large
    // enough that the ladder stores real entries first, small enough that the
    // search charges past it before finishing.
    const tripped = tracedTwiceUnder(image, `${name}::tripped`, 2 * 1024 * 1024);
    expect(tripped.stats.overBudget).toBe(true);
    // The point of the fix: the memo degrades instead of dying.
    expect(tripped.stats.entries).toBeGreaterThan(0);
    expect(tripped.first, 'mid-search trip, first run').toEqual(cold);
    expect(tripped.second, 'mid-search trip, second run').toEqual(cold);

    if (!TRIP_FIXTURES.includes(name)) return;

    // The cache stops storing once the search charges past its byte budget,
    // and `getSearchCache` only builds a new one when the key changes — so a
    // starved memo stays starved for as long as that image is open. That path
    // is reached on real multi-plan sheets, so a memo that only agreed with a
    // cold trace while it was alive would be worse than no memo at all. The
    // second run meets the over-budget memo, which stored nothing at all.
    const starved = tracedTwiceUnder(image, `${name}::starved`, 1);
    expect(starved.first, 'one-byte budget, first run').toEqual(cold);
    expect(starved.second, 'one-byte budget, second run').toEqual(cold);

    // The budget is charged incrementally from inside the candidate search,
    // but a whole wall network's ladder is stored afterwards as ONE entry. A
    // network that crossed the line part-way therefore lost its entire ladder
    // — the expensive `gen|` entry — while the cheap `nets|` entry stored
    // before the charging survived. "Keep what is already stored" was true and
    // useless: the memo held one worthless entry and the second trace paid a
    // full cold search (measured 620-790 ms against 64-200 ms once the ladder
    // is kept).
    //
    // Asserted on entry count rather than time so it cannot go flaky: one
    // entry means the ladder was refused, two means it landed. Small enough
    // that the trip happens inside the first network's ladder, which is the
    // case a single-building page always hits.
    const firstNetwork = tracedTwiceUnder(image, `${name}::first-network-trip`, 512 * 1024);
    expect(firstNetwork.stats.overBudget).toBe(true);
    expect(firstNetwork.stats.entries).toBeGreaterThanOrEqual(2);
    expect(firstNetwork.first, 'first-network trip, first run').toEqual(cold);
    expect(firstNetwork.second, 'first-network trip, second run').toEqual(cold);
  });
});
