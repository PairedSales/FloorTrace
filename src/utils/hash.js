/**
 * Fast, non-cryptographic hash of a string (FNV-1a, 32-bit).
 * We sample the first 8 KB + the total length so very large images that
 * differ only in later bytes are still distinguishable in practice.
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
