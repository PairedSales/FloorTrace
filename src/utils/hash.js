/**
 * Fast, non-cryptographic hash of a string (FNV-1a, 32-bit).
 * We sample the first 8 KB + the total length so very large images that
 * differ only in later bytes are still distinguishable in practice.
 *
 * This is a BUCKET KEY, not an identity. Two distinct images can share it:
 * 32 bits is small enough for birthday collisions, and the eraser and crop
 * tools emit data URLs from the same canvas at the same dimensions, so the
 * 8 KB prefix and the length both have a real chance of matching. Callers that
 * only group or name things by image can use it directly; callers that use the
 * key to *return* an image must use `internKey` below.
 *
 * @param {string|null} dataUrl
 * @returns {string|null}
 */
export function hashDataUrl(dataUrl) {
  if (!dataUrl) return null;
  const sample = dataUrl.slice(0, 8192) + '|' + dataUrl.length;
  let h = 0x811c9dc5;
  for (let i = 0; i < sample.length; i++) {
    h ^= sample.charCodeAt(i);
    h = (Math.imul(h, 0x01000193) >>> 0);
  }
  return h.toString(16);
}

/**
 * An identity key for `dataUrl` inside a pool: same image → same key, different
 * image → different key, always. The hash picks the bucket and an exact string
 * compare against the occupant picks the slot within it, so a collision costs a
 * suffixed key rather than one image resolving to another's pixels.
 *
 * Verifying beats re-hashing here. Full-string FNV over a 2 MB data URL is
 * ~4 ms and ~11 ms at 5 MB — paid on every undo save — while `===` is free when
 * the caller hands back the same string reference (which is the normal case)
 * and ~0.07 ms at 2 MB when it does not. And it is exact, which no hash is.
 *
 * @param {string|null} dataUrl
 * @param {(key: string) => string|null|undefined} lookup url currently at a key
 * @returns {string|null}
 */
export function internKey(dataUrl, lookup) {
  if (!dataUrl) return null;
  const base = hashDataUrl(dataUrl);
  for (let probe = 0; ; probe++) {
    const key = probe === 0 ? base : `${base}~${probe}`;
    const held = lookup(key);
    // Free slot, or the same image already interned here.
    if (held === undefined || held === null || held === dataUrl) return key;
  }
}
