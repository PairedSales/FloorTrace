import { afterEach, describe, expect, it } from 'vitest';
import {
  getCachedAnalysis, getSearchCache, dropCacheKey, clearDetectionCache,
  setSearchBudgetBytes, searchCacheStats,
} from '../cache';

const KEY_A = 'hash-a#1';
const KEY_B = 'hash-b#2';
const KEY_C = 'hash-c#3';
const DIM = 1400;

afterEach(() => {
  clearDetectionCache();
  setSearchBudgetBytes(null);
});

describe('analysis memo scoping', () => {
  it('keeps two images memoised while alternating between them', () => {
    let runs = 0;
    const compute = () => { runs += 1; return { ran: runs }; };

    getCachedAnalysis(KEY_A, DIM, null, compute);
    getCachedAnalysis(KEY_B, DIM, null, compute);
    expect(runs).toBe(2);

    getCachedAnalysis(KEY_A, DIM, null, compute);
    getCachedAnalysis(KEY_B, DIM, null, compute);
    expect(runs).toBe(2);
  });

  // Replaces the old behaviour, where any new image cleared the whole memo —
  // with two plans open that threw away the other plan's analysis every switch.
  it('drops one image without touching another', () => {
    let runs = 0;
    const compute = () => { runs += 1; return { ran: runs }; };

    getCachedAnalysis(KEY_A, DIM, null, compute);
    getCachedAnalysis(KEY_B, DIM, null, compute);

    dropCacheKey(KEY_A);

    getCachedAnalysis(KEY_B, DIM, null, compute);
    expect(runs).toBe(2); // B survived

    getCachedAnalysis(KEY_A, DIM, null, compute);
    expect(runs).toBe(3); // A had to be recomputed
  });

  it('ignores a drop for a key it never held', () => {
    getCachedAnalysis(KEY_A, DIM, null, () => ({}));
    expect(() => dropCacheKey('never-seen')).not.toThrow();
    let runs = 0;
    getCachedAnalysis(KEY_A, DIM, null, () => { runs += 1; return {}; });
    expect(runs).toBe(0);
  });
});

describe('search memo budget', () => {
  it('holds a ladder per image rather than one at a time', () => {
    const a = getSearchCache(KEY_A, DIM, null);
    const b = getSearchCache(KEY_B, DIM, null);
    expect(a).not.toBe(b);
    // Asking again returns the same instance, which is what makes a second
    // trace of a plan you returned to warm rather than cold.
    expect(getSearchCache(KEY_A, DIM, null)).toBe(a);
  });

  // The budget was declared once and charged against each instance's own
  // counter, while one instance was minted per key. Holding a ladder per plan
  // without fixing that would multiply the worker's ceiling by the plan count.
  it('charges every cache against one budget', () => {
    setSearchBudgetBytes(1000);

    const a = getSearchCache(KEY_A, DIM, null);
    a.retain(600);
    expect(a.overBudget).toBe(false);

    const b = getSearchCache(KEY_B, DIM, null);
    b.retain(600);

    // 1200 across two caches is over the shared budget even though neither
    // instance passed it alone. Under a per-instance budget both would still
    // consider themselves fine.
    expect(searchCacheStats().totalBytes).toBeLessThan(1200);
  });

  it('evicts another plan’s ladder before giving up on the one being built', () => {
    setSearchBudgetBytes(1000);

    const a = getSearchCache(KEY_A, DIM, null);
    a.retain(900);

    const b = getSearchCache(KEY_B, DIM, null);
    b.retain(600);

    // The ladder still being climbed survives; the idle one is what goes.
    expect(b.overBudget).toBe(false);
    expect(getSearchCache(KEY_B, DIM, null)).toBe(b);
    expect(getSearchCache(KEY_A, DIM, null)).not.toBe(a);
  });

  it('bounds how many ladders it holds at once', () => {
    getSearchCache(KEY_A, DIM, null);
    getSearchCache(KEY_B, DIM, null);
    getSearchCache(KEY_C, DIM, null);

    expect(searchCacheStats().caches).toBeLessThanOrEqual(2);
  });

  it('drops a ladder with its image', () => {
    const a = getSearchCache(KEY_A, DIM, null);
    a.retain(10);
    dropCacheKey(KEY_A);
    expect(getSearchCache(KEY_A, DIM, null)).not.toBe(a);
  });
});
