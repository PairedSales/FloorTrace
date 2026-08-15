import { describe, it, expect } from 'vitest';
import { hashDataUrl, internKey } from '../hash';
import { COLLIDE_A, COLLIDE_B } from './collidingDataUrls';

describe('hashDataUrl', () => {
  it('returns null for empty, null, or undefined values', () => {
    expect(hashDataUrl(null)).toBeNull();
    expect(hashDataUrl(undefined)).toBeNull();
    expect(hashDataUrl('')).toBeNull();
  });

  it('produces identical hashes for identical inputs', () => {
    const data1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const data2 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    expect(hashDataUrl(data1)).toBe(hashDataUrl(data2));
  });

  it('produces different hashes for different inputs', () => {
    const data1 = 'data:image/png;base64,A';
    const data2 = 'data:image/png;base64,B';
    expect(hashDataUrl(data1)).not.toBe(hashDataUrl(data2));
  });

  it('samples first 8KB and length correctly', () => {
    const base = 'a'.repeat(9000);
    const modifiedInSample = 'b' + base.slice(1);
    const modifiedAfterSample = base.slice(0, 8500) + 'b' + base.slice(8501);

    // Difference in first 8KB should yield different hashes
    expect(hashDataUrl(base)).not.toBe(hashDataUrl(modifiedInSample));

    // Difference in length should yield different hashes
    expect(hashDataUrl(base)).not.toBe(hashDataUrl(base + 'a'));

    // Difference after 8KB (but keeping length same) will yield same hash under FNV-1a sample rules
    // (This is the expected behavior of our sampled-hashing design for performance)
    expect(hashDataUrl(base)).toBe(hashDataUrl(modifiedAfterSample));
  });

  it('is a bucket key, not an identity: two real images can share one', () => {
    expect(COLLIDE_A).not.toBe(COLLIDE_B);
    expect(hashDataUrl(COLLIDE_A)).toBe(hashDataUrl(COLLIDE_B));
  });
});

describe('internKey', () => {
  const poolOf = (...urls) => {
    const pool = new Map();
    const lookup = (k) => pool.get(k);
    const keys = urls.map((u) => {
      const key = internKey(u, lookup);
      if (!pool.has(key)) pool.set(key, u);
      return key;
    });
    return { pool, keys };
  };

  it('returns null for empty input', () => {
    expect(internKey(null, () => undefined)).toBeNull();
    expect(internKey('', () => undefined)).toBeNull();
  });

  it('gives one key to one image however many times it is interned', () => {
    const url = 'data:image/png;base64,AAAA';
    const { pool, keys } = poolOf(url, url, `${url}`.slice(0));
    expect(new Set(keys).size).toBe(1);
    expect(pool.size).toBe(1);
  });

  it('separates two images that collide under the hash', () => {
    const { pool, keys } = poolOf(COLLIDE_A, COLLIDE_B);
    expect(keys[0]).not.toBe(keys[1]);
    expect(pool.get(keys[0])).toBe(COLLIDE_A);
    expect(pool.get(keys[1])).toBe(COLLIDE_B);
  });

  it('still shares a slot when a collider is re-interned', () => {
    const { pool, keys } = poolOf(COLLIDE_A, COLLIDE_B, COLLIDE_B, COLLIDE_A);
    expect(pool.size).toBe(2);
    expect(keys[2]).toBe(keys[1]);
    expect(keys[3]).toBe(keys[0]);
  });
});
