import { describe, it, expect } from 'vitest';
import { hashDataUrl } from '../hash';

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
});
