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
