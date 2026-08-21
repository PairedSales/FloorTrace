import { beforeAll, describe, expect, it, vi } from 'vitest';
import { COLLIDE_A, COLLIDE_B } from '../../utils/__tests__/collidingDataUrls';
import { hashDataUrl } from '../../utils/hash';

const THIRD = 'data:image/png;base64,VEhJUkQ=';
const FOURTH = 'data:image/png;base64,Rk9VUlRI';
// Its own image, so measuring decodes elsewhere is not disturbed by this one.
const ACK_ONLY = 'data:image/png;base64,QUNL';

// The pipeline is stubbed to hand back the URL the decode actually read, so the
// assertions are about *which image's pixels* came out — not about detection.
const H = vi.hoisted(() => ({ decodes: 0, dropped: [] }));

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
  dropCacheKey: (key) => { H.dropped.push(key); },
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

// The worker acknowledges a request before doing any work, so the main thread
// can tell "queued behind something" from "running long". That ack shares the
// id, so a reply is the message carrying a verdict, not merely the first one.
const isReply = (m, id) => m.id === id && m.ok !== undefined;

let nextId = 1;
const trace = async (image) => {
  const id = String(nextId++);
  globalThis.self.onmessage({ data: { id, type: 'traceFloorplanBoundary', payload: { image } } });
  await vi.waitFor(() => expect(posted.some((m) => isReply(m, id))).toBe(true));
  const message = posted.find((m) => isReply(m, id));
  expect(message.ok).toBe(true);
  return message.data;
};

it('acknowledges a request before it starts work', async () => {
  const id = String(nextId++);
  globalThis.self.onmessage({ data: { id, type: 'traceFloorplanBoundary', payload: { image: ACK_ONLY } } });
  await vi.waitFor(() => expect(posted.some((m) => isReply(m, id))).toBe(true));

  const forThisId = posted.filter((m) => m.id === id);
  expect(forThisId[0].started).toBe(true);
  expect(forThisId[0].ok).toBeUndefined();
});

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

  // Replaces "flushes the detection memo when a colliding image replaces the
  // last one". A new image used to clear the WHOLE memo, which with two plans
  // open threw away the other plan's analysis every time the user switched.
  // The memo is now dropped per image, when that image is actually evicted.
  it('keeps both images memoised while alternating between them', async () => {
    const a1 = await trace(COLLIDE_A);
    const b1 = await trace(COLLIDE_B);
    const before = H.decodes;

    const a2 = await trace(COLLIDE_A);
    const b2 = await trace(COLLIDE_B);

    // Neither eviction nor re-decode: the whole point of holding two.
    expect(H.decodes).toBe(before);
    expect(a2.cacheKey).toBe(a1.cacheKey);
    expect(b2.cacheKey).toBe(b1.cacheKey);
  });

  it('drops a memo only for the image actually evicted', async () => {
    const a = await trace(COLLIDE_A);
    await trace(COLLIDE_B);
    H.dropped.length = 0;

    // A third image pushes the least recently used one out.
    await trace(THIRD);

    expect(H.dropped).toEqual([a.cacheKey]);
  });

  it('decodes one image once when two requests overlap', async () => {
    const before = H.decodes;
    const first = trace(FOURTH);
    const second = trace(FOURTH);
    const [a, b] = await Promise.all([first, second]);

    // `lastImageUrl` used to be assigned after the awaits, so two overlapping
    // requests each decoded and each minted a key.
    expect(H.decodes).toBe(before + 1);
    expect(a.cacheKey).toBe(b.cacheKey);
  });
});
