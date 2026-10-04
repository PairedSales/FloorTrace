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

    getCachedAnalysis(KEY_A, DIM, compute);
    getCachedAnalysis(KEY_B, DIM, compute);
    expect(runs).toBe(2);

    getCachedAnalysis(KEY_A, DIM, compute);
    getCachedAnalysis(KEY_B, DIM, compute);
    expect(runs).toBe(2);
  });

  // Replaces the old behaviour, where any new image cleared the whole memo —
  // with two plans open that threw away the other plan's analysis every switch.
  it('drops one image without touching another', () => {
    let runs = 0;
    const compute = () => { runs += 1; return { ran: runs }; };

    getCachedAnalysis(KEY_A, DIM, compute);
    getCachedAnalysis(KEY_B, DIM, compute);

    dropCacheKey(KEY_A);

    getCachedAnalysis(KEY_B, DIM, compute);
    expect(runs).toBe(2); // B survived

    getCachedAnalysis(KEY_A, DIM, compute);
    expect(runs).toBe(3); // A had to be recomputed
  });
});

describe('search memo budget', () => {
  it('holds a ladder per image rather than one at a time', () => {
    const a = getSearchCache(KEY_A, DIM);
    const b = getSearchCache(KEY_B, DIM);
    expect(a).not.toBe(b);
    // Asking again returns the same instance, which is what makes a second
    // trace of a plan you returned to warm rather than cold.
    expect(getSearchCache(KEY_A, DIM)).toBe(a);
  });

  // The budget was declared once and charged against each instance's own
  // counter, while one instance was minted per key. Holding a ladder per plan
  // without fixing that would multiply the worker's ceiling by the plan count.
  it('charges every cache against one budget', () => {
    setSearchBudgetBytes(1000);

    const a = getSearchCache(KEY_A, DIM);
    a.retain(600);
    expect(a.overBudget).toBe(false);

    const b = getSearchCache(KEY_B, DIM);
    b.retain(600);

    // 1200 across two caches is over the shared budget even though neither
    // instance passed it alone. Under a per-instance budget both would still
    // consider themselves fine.
    expect(searchCacheStats().totalBytes).toBeLessThan(1200);
  });

  it('evicts another plan’s ladder before giving up on the one being built', () => {
    setSearchBudgetBytes(1000);

    const a = getSearchCache(KEY_A, DIM);
    a.retain(900);

    const b = getSearchCache(KEY_B, DIM);
    b.retain(600);

    // The ladder still being climbed survives; the idle one is what goes.
    expect(b.overBudget).toBe(false);
    expect(getSearchCache(KEY_B, DIM)).toBe(b);
    expect(getSearchCache(KEY_A, DIM)).not.toBe(a);
  });

  it('bounds how many ladders it holds at once', () => {
    getSearchCache(KEY_A, DIM);
    getSearchCache(KEY_B, DIM);
    getSearchCache(KEY_C, DIM);

    expect(searchCacheStats().caches).toBeLessThanOrEqual(2);
  });

  it('drops a ladder with its image', () => {
    const a = getSearchCache(KEY_A, DIM);
    a.retain(10);
    dropCacheKey(KEY_A);
    expect(getSearchCache(KEY_A, DIM)).not.toBe(a);
  });
});
