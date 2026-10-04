import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The page's half of the scan worker. What is worth pinning is what happens
// when the worker is not there to answer: a scan must never be left waiting on
// one, and a worker that failed must hand the scan back to be run on the page
// rather than fail it.

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
  say(data) { this.onmessage?.({ data }); }
  crash(message = 'boom') { this.onerror?.({ message, preventDefault() {} }); }
}

const tick = () => new Promise((r) => setTimeout(r, 0));

let host;

beforeEach(async () => {
  FakeWorker.instances = [];
  FakeWorker.refuse = false;
  vi.stubGlobal('Worker', FakeWorker);
  vi.resetModules();
  host = await import('../ocrHost.js');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const startReady = async () => {
  const starting = host.startOcrHost();
  const [worker] = FakeWorker.instances;
  worker.say({ type: 'ready', capable: true });
  expect(await starting).toBe(true);
  return worker;
};

describe('ocrHost', () => {
  it('is usable once the worker says it can do the job, and configures it first', async () => {
    host.configureOcrHost({ tesseract: { langPath: '/lang' } });
    const worker = await startReady();

    expect(worker.posted[0]).toEqual({ type: 'configure', options: { langPath: '/lang' } });
    // One worker however many callers ask.
    expect(await host.startOcrHost()).toBe(true);
    expect(FakeWorker.instances).toHaveLength(1);
  });

  it('resolves a scan with what the worker read', async () => {
    const worker = await startReady();
    const scan = host.scanInOcrHost('data:image/png;base64,AAAA');
    const request = worker.posted.find((m) => m.type === 'scan');
    expect(request.image).toBe('data:image/png;base64,AAAA');

    worker.say({ type: 'scanned', id: request.id, ok: true, data: { dimensions: [1] } });
    expect(await scan).toEqual({ dimensions: [1] });
  });

  // A scan that fails on its own merits would fail on the page too. Flagged as
  // the worker's fault it would be run a second time there, for the same answer
  // and twice the wait.
  it('reports a failed scan as the scan’s failure, not the worker’s', async () => {
    const worker = await startReady();
    const scan = host.scanInOcrHost('data:x');
    const request = worker.posted.find((m) => m.type === 'scan');

    worker.say({ type: 'scanned', id: request.id, ok: false, error: 'engine failed' });
    const error = await scan.catch((e) => e);
    expect(error.message).toBe('engine failed');
    expect(error.hostUnavailable).toBeUndefined();
  });

  it('hands a scan back when the worker dies under it, and is not tried again', async () => {
    const worker = await startReady();
    const scan = host.scanInOcrHost('data:x');

    worker.crash('out of memory');
    const error = await scan.catch((e) => e);
    expect(error.hostUnavailable).toBe(true);
    expect(worker.terminated).toBe(true);

    expect(await host.startOcrHost()).toBe(false);
    expect(FakeWorker.instances).toHaveLength(1);
  });

  it('is not usable when the worker says this browser cannot read from one', async () => {
    const starting = host.startOcrHost();
    const [worker] = FakeWorker.instances;
    worker.say({ type: 'ready', capable: false });

    expect(await starting).toBe(false);
    expect(worker.terminated).toBe(true);
    expect((await host.scanInOcrHost('data:x').catch((e) => e)).hostUnavailable).toBe(true);
  });

  it('is not usable when the worker cannot be started at all', async () => {
    FakeWorker.refuse = true;
    expect(await host.startOcrHost()).toBe(false);
  });

  // Nothing arrives on the message channel when a script 404s after a deploy.
  it('settles a start whose worker never loads', async () => {
    const starting = host.startOcrHost();
    FakeWorker.instances[0].crash('');
    expect(await starting).toBe(false);
  });

  it('runs the second reader on the page and sends the answer back', async () => {
    const refine = vi.fn(async (tiles) => tiles.map((_, tileIndex) => ({ tileIndex, text: '12 x 10' })));
    host.configureOcrHost({ refine });
    const worker = await startReady();

    worker.say({ type: 'refine', id: 7, tiles: [{ gray: {} }] });
    await tick();

    expect(refine).toHaveBeenCalledWith([{ gray: {} }]);
    expect(worker.posted.at(-1)).toEqual({
      type: 'refined', id: 7, results: [{ tileIndex: 0, text: '12 x 10' }],
    });
  });

  // The pipeline is waiting on this answer with a deadline of its own; an
  // unanswered request would run it out for nothing.
  it('answers the worker even when the second reader throws', async () => {
    host.configureOcrHost({ refine: async () => { throw new Error('webgl lost'); } });
    const worker = await startReady();

    worker.say({ type: 'refine', id: 3, tiles: [] });
    await tick();
    expect(worker.posted.at(-1)).toEqual({ type: 'refined', id: 3, results: [] });
  });

  it('tells a worker started later that the second reader is already warm', async () => {
    host.setOcrHostPaddleReady(true);
    const worker = await startReady();
    expect(worker.posted).toContainEqual({ type: 'paddle', ready: true });
  });

  describe('terminate', () => {
    it('stops the worker and fails what was waiting on it, as a teardown', async () => {
      const worker = await startReady();
      const scan = host.scanInOcrHost('data:x');

      host.terminateOcrHost();
      const error = await scan.catch((e) => e);
      expect(worker.terminated).toBe(true);
      // Not `hostUnavailable`: the app is going away, and re-running the scan
      // on the page is the last thing that should follow.
      expect(error.hostUnavailable).toBeUndefined();
    });

    it('starts a fresh worker for the next scan', async () => {
      await startReady();
      host.terminateOcrHost();

      const starting = host.startOcrHost();
      expect(FakeWorker.instances).toHaveLength(2);
      FakeWorker.instances[1].say({ type: 'ready', capable: true });
      expect(await starting).toBe(true);
    });

    it('stops a worker caught half-way through starting', async () => {
      const starting = host.startOcrHost();
      host.terminateOcrHost();

      expect(await starting).toBe(false);
      expect(FakeWorker.instances[0].terminated).toBe(true);
    });
  });
});
