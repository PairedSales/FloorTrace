import { beforeAll, describe, expect, it, vi } from 'vitest';
import { COLLIDE_A, COLLIDE_B } from '../../utils/__tests__/collidingDataUrls';
import { hashDataUrl } from '../../utils/hash';

// The pipeline is stubbed to hand back the URL the decode actually read, so the
// assertions are about *which image's pixels* came out — not about detection.
const H = vi.hoisted(() => ({ decodes: 0, clears: 0 }));

vi.mock('../../utils/detection/pipeline', () => ({
  detectRoomFromClickCore: (imageData, point, options) => ({
    pixels: imageData.pixels,
    cacheKey: options.cacheKey,
  }),
  traceFloorplanBoundaryCore: (imageData, options) => ({
    pixels: imageData.pixels,
    cacheKey: options.cacheKey,
  }),
}));

vi.mock('../../utils/detection/cache', () => ({
  clearDetectionCache: () => { H.clears += 1; },
}));

const posted = [];

beforeAll(async () => {
  globalThis.self = { postMessage: (message) => posted.push(message) };
  globalThis.fetch = async (url) => ({ blob: async () => ({ url }) });
  globalThis.createImageBitmap = async (blob) => {
    H.decodes += 1;
    return { width: 4, height: 4, url: blob.url, close() {} };
  };
  globalThis.OffscreenCanvas = class {
    constructor(width, height) { this.width = width; this.height = height; this.url = null; }
    getContext() {
      return {
        drawImage: (bitmap) => { this.url = bitmap.url; },
        getImageData: () => ({
          pixels: this.url,
          width: this.width,
          height: this.height,
          data: new Uint8ClampedArray(this.width * this.height * 4),
        }),
      };
    }
  };
  await import('../detectionWorker');
});

let nextId = 1;
const trace = async (image) => {
  const id = String(nextId++);
  globalThis.self.onmessage({ data: { id, type: 'traceFloorplanBoundary', payload: { image } } });
  await vi.waitFor(() => expect(posted.some((m) => m.id === id)).toBe(true));
  const message = posted.find((m) => m.id === id);
  expect(message.ok).toBe(true);
  return message.data;
};

describe('detectionWorker image cache identity', () => {
  it('reuses the decoded pixels and memo key for a repeat of one image', async () => {
    const before = H.decodes;
    const first = await trace(COLLIDE_A);
    const second = await trace(COLLIDE_A);
    expect(H.decodes).toBe(before + 1);
    expect(second.cacheKey).toBe(first.cacheKey);
    expect(second.pixels).toBe(COLLIDE_A);
  });

  it('never serves one image the pixels of another that shares its hash', async () => {
    expect(hashDataUrl(COLLIDE_A)).toBe(hashDataUrl(COLLIDE_B));
    const a = await trace(COLLIDE_A);
    const b = await trace(COLLIDE_B);
    expect(a.pixels).toBe(COLLIDE_A);
    expect(b.pixels).toBe(COLLIDE_B);
    // A shared memo key would hand B the geometry computed for A.
    expect(a.cacheKey).not.toBe(b.cacheKey);
  });

  it('flushes the detection memo when a colliding image replaces the last one', async () => {
    await trace(COLLIDE_A);
    const before = H.clears;
    await trace(COLLIDE_B);
    expect(H.clears).toBe(before + 1);
  });
});
