import { describe, expect, it } from 'vitest';
import { createScanQueue } from '../scanQueue';

const defer = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('scanQueue', () => {
  describe('memoising', () => {
    it('runs a scan once and serves the rest from memory', async () => {
      const queue = createScanQueue();
      let runs = 0;
      const task = async () => { runs += 1; return 'result'; };

      expect(await queue.run('a', task)).toBe('result');
      expect(await queue.run('a', task)).toBe('result');
      expect(runs).toBe(1);
    });

    it('evicts the least recently used beyond its bound', async () => {
      const queue = createScanQueue({ maxEntries: 2 });
      await queue.run('a', async () => 1);
      await queue.run('b', async () => 2);
      await queue.run('c', async () => 3);

      expect(queue.size).toBe(2);
      expect(queue.has('a')).toBe(false);
      expect(queue.has('b')).toBe(true);
      expect(queue.has('c')).toBe(true);
    });

    it('counts a read as use, so alternating never goes cold', async () => {
      const queue = createScanQueue({ maxEntries: 2 });
      await queue.run('a', async () => 1);
      await queue.run('b', async () => 2);
      await queue.run('a', async () => 99); // refreshes 'a'
      await queue.run('c', async () => 3);  // evicts 'b', not 'a'

      expect(queue.has('a')).toBe(true);
      expect(queue.has('b')).toBe(false);
    });

    // A failed scan cached as an empty result would be served forever as
    // "this plan has no labels" — the one direction this must never fail in.
    it('never memoises a failure', async () => {
      const queue = createScanQueue();
      await expect(queue.run('a', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
      expect(queue.has('a')).toBe(false);

      expect(await queue.run('a', async () => 'recovered')).toBe('recovered');
    });

    it('forgets everything on clear', async () => {
      const queue = createScanQueue();
      await queue.run('a', async () => 1);
      queue.clear();
      expect(queue.size).toBe(0);
    });
  });

  describe('de-duplicating', () => {
    it('lets two callers share one scan of the same image', async () => {
      const queue = createScanQueue();
      const gate = defer();
      let runs = 0;
      const task = async () => { runs += 1; return gate.promise; };

      const first = queue.run('a', task);
      const second = queue.run('a', task);
      gate.resolve('shared');

      expect(await first).toBe('shared');
      expect(await second).toBe('shared');
      expect(runs).toBe(1);
    });
  });

  describe('serialising', () => {
    // The load-bearing property. The pipeline spends a wall-clock budget, so
    // overlap costs detections rather than time.
    it('never runs two scans at once', async () => {
      const queue = createScanQueue();
      let active = 0;
      let maxActive = 0;
      const gates = [defer(), defer(), defer()];

      const task = (i) => async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await gates[i].promise;
        active -= 1;
        return i;
      };

      const all = Promise.all([
        queue.run('a', task(0)),
        queue.run('b', task(1)),
        queue.run('c', task(2)),
      ]);

      // Release them out of order; the queue must still admit one at a time.
      for (const gate of gates) {
        await tick();
        gate.resolve();
      }

      expect(await all).toEqual([0, 1, 2]);
      expect(maxActive).toBe(1);
    });

    it('starts each scan only after the previous finishes', async () => {
      const queue = createScanQueue();
      const order = [];
      const gate = defer();

      const first = queue.run('a', async () => { order.push('a:start'); await gate.promise; order.push('a:end'); });
      const second = queue.run('b', async () => { order.push('b:start'); });

      await tick();
      expect(order).toEqual(['a:start']); // b has not begun

      gate.resolve();
      await Promise.all([first, second]);
      expect(order).toEqual(['a:start', 'a:end', 'b:start']);
    });

    // One rejection must not wedge every later scan for the life of the page.
    it('keeps running after a scan fails', async () => {
      const queue = createScanQueue();
      await expect(queue.run('a', async () => { throw new Error('boom'); })).rejects.toThrow();
      expect(await queue.run('b', async () => 'still working')).toBe('still working');
    });
  });
});
