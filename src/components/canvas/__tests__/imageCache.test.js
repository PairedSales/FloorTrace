import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The decode goes to a worker and the page is the fallback. What is pinned here
// is the fallback: a plan's image must appear whatever the worker does, and a
// worker that has failed must not be asked again.

class FakeWorker {
  static instances = [];
  static refuse = false;

  constructor() {
    if (FakeWorker.refuse) throw new Error('refused');
    this.posted = [];
    this.terminated = false;
    FakeWorker.instances.push(this);
  }

  postMessage(message) { this.posted.push(message); }
  terminate() { this.terminated = true; }
  answer(data) { this.onmessage?.({ data }); }
  crash() { this.onerror?.({ preventDefault() {} }); }
}

// An <img> that loads as soon as it is given a source.
class FakeImage {
  static made = 0;

  constructor() { FakeImage.made += 1; }

  set src(value) {
    this.url = value;
    queueMicrotask(() => (value.includes('broken') ? this.onerror?.(new Error('bad')) : this.onload?.()));
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0));

let cache;

beforeEach(async () => {
  FakeWorker.instances = [];
  FakeWorker.refuse = false;
  FakeImage.made = 0;
  vi.stubGlobal('Worker', FakeWorker);
  vi.stubGlobal('createImageBitmap', () => {});
  vi.stubGlobal('window', { Image: FakeImage });
  vi.resetModules();
  cache = await import('../imageCache.js');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('imageCache', () => {
  it('decodes in the worker and keeps what comes back', async () => {
    const loading = cache.loadImage('data:a');
    const [worker] = FakeWorker.instances;
    const bitmap = { width: 10, height: 20 };
    worker.answer({ id: worker.posted[0].id, bitmap });

    expect(await loading).toBe(bitmap);
    expect(cache.decodedImage('data:a')).toBe(bitmap);
    expect(FakeImage.made).toBe(0);
  });

  it('gives two callers for one image the one decode', async () => {
    const first = cache.loadImage('data:a');
    const second = cache.loadImage('data:a');
    const [worker] = FakeWorker.instances;
    expect(worker.posted).toHaveLength(1);

    worker.answer({ id: worker.posted[0].id, bitmap: { width: 1, height: 1 } });
    expect(await first).toBe(await second);
  });

  // An SVG is the real case: a bitmap cannot be made of one, an <img> can.
  it('decodes on the page what the worker could not', async () => {
    const loading = cache.loadImage('data:svg');
    const [worker] = FakeWorker.instances;
    worker.answer({ id: worker.posted[0].id, error: 'could not be decoded' });

    expect(await loading).toBeInstanceOf(FakeImage);
    // That image, not the worker: the next one is still asked of it.
    cache.loadImage('data:b');
    expect(worker.posted).toHaveLength(2);
  });

  it('decodes on the page when the worker dies, and does not ask it again', async () => {
    const loading = cache.loadImage('data:a');
    const [worker] = FakeWorker.instances;
    worker.crash();

    expect(await loading).toBeInstanceOf(FakeImage);
    expect(worker.terminated).toBe(true);

    expect(await cache.loadImage('data:b')).toBeInstanceOf(FakeImage);
    expect(FakeWorker.instances).toHaveLength(1);
  });

  it('decodes on the page where a worker cannot be started', async () => {
    FakeWorker.refuse = true;
    expect(await cache.loadImage('data:a')).toBeInstanceOf(FakeImage);
  });

  it('rejects an image neither can read, and does not remember it', async () => {
    const loading = cache.loadImage('data:broken');
    const [worker] = FakeWorker.instances;
    worker.answer({ id: worker.posted[0].id, error: 'could not be decoded' });

    await expect(loading).rejects.toBeDefined();
    expect(cache.decodedImage('data:broken')).toBeNull();
    // A failure is not held as a decode in progress either.
    await tick();
    cache.loadImage('data:broken').catch(() => {});
    expect(worker.posted).toHaveLength(2);
  });

  describe('loadImageElement', () => {
    const made = [];
    const revoked = [];

    beforeEach(() => {
      made.length = 0;
      revoked.length = 0;
      // Still a constructor: the cache builds its worker's address with it.
      const RealURL = URL;
      vi.stubGlobal('URL', class extends RealURL {
        static createObjectURL(blob) { made.push(blob); return `blob:${made.length}`; }
        static revokeObjectURL(url) { revoked.push(url); }
      });
    });

    const decodeWithBytes = async (url, blob) => {
      const loading = cache.loadImage(url);
      const [worker] = FakeWorker.instances;
      worker.answer({ id: worker.posted.at(-1).id, bitmap: { url }, blob });
      await loading;
    };

    // The point of it: an <img> given the data URL parses the whole string on
    // the page, and the worker has already taken that string apart.
    it('loads the <img> from the bytes the decode left behind', async () => {
      await decodeWithBytes('data:a', { bytes: 1 });
      const img = await cache.loadImageElement('data:a');

      expect(img).toBeInstanceOf(FakeImage);
      expect(img.url).toBe('blob:1');
    });

    it('gives every <img> of one image the same source', async () => {
      await decodeWithBytes('data:a', { bytes: 1 });
      const first = await cache.loadImageElement('data:a');
      const second = await cache.loadImageElement('data:a');

      expect(second.url).toBe(first.url);
      expect(made).toHaveLength(1);
    });

    it('loads it from the data URL where the worker left no bytes', async () => {
      FakeWorker.refuse = true;
      const img = await cache.loadImageElement('data:a');
      expect(img.url).toBe('data:a');
    });

    it('lets the source go with the image', async () => {
      await decodeWithBytes('data:a', { bytes: 1 });
      cache.forgetImage('data:a');
      expect(revoked).toEqual(['blob:1']);

      // Evicted the same way as forgotten.
      for (const name of ['b', 'c', 'd', 'e']) await decodeWithBytes(`data:${name}`, { name });
      expect(revoked).toContain('blob:2');
    });

    it('rejects an image an <img> cannot read', async () => {
      const loading = cache.loadImageElement('data:broken');
      await tick();
      const [worker] = FakeWorker.instances;
      worker.answer({ id: worker.posted[0].id, error: 'could not be decoded' });
      await expect(loading).rejects.toBeDefined();
    });
  });

  it('keeps three images and lets the least recently used go', async () => {
    for (const name of ['a', 'b', 'c', 'd']) {
      const loading = cache.loadImage(`data:${name}`);
      const [worker] = FakeWorker.instances;
      worker.answer({ id: worker.posted.at(-1).id, bitmap: { name } });
      await loading;
    }
    expect(cache.decodedImage('data:a')).toBeNull();
    expect(cache.decodedImage('data:d')).toEqual({ name: 'd' });

    cache.forgetImage('data:d');
    expect(cache.decodedImage('data:d')).toBeNull();
  });
});
