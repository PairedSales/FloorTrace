// The memo key has to cover everything the search's result depends on, or one
// image traced twice at different settings is answered with the first
// settings' geometry. Split out of searchMemo.test.js — see searchMemoShared.js.
import { describe, expect, it, beforeAll, beforeEach } from 'vitest';
import { traceFloorplanBoundaryCore } from '../pipeline.js';
import { clearDetectionCache } from '../cache.js';
import { FIXTURES, geometryOf, loadFixtures } from './searchMemoShared.js';

let images;

beforeAll(() => {
  images = loadFixtures();
});

beforeEach(() => {
  clearDetectionCache();
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

  // Without this the cases above would pass on a tracer that ignored the radius.
  // One plan that differs is the whole claim, so stop at the first.
  it('the two radii do change the answer somewhere in the fixture set', () => {
    const differs = FIXTURES.some((name) => {
      const image = images.get(name);
      clearDetectionCache();
      const wide = geometryOf(traceFloorplanBoundaryCore(image, { boundary: { maxCloseRadius: 48 } }));
      clearDetectionCache();
      const narrow = geometryOf(traceFloorplanBoundaryCore(image, { boundary: { maxCloseRadius: 8 } }));
      return JSON.stringify(wide) !== JSON.stringify(narrow);
    });
    expect(differs).toBe(true);
  });
});
