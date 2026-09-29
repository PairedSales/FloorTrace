// `bench:real --jobs N`: plans shared over worker processes
// (lib/realBenchPool.mjs). The crash and start-up cases run against stub
// workers; one test runs the real `realBenchmark.mjs --worker` on synthetic
// plans and requires what a worker reports to be what the main process would.
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mergeInOrder } from '../realBench.mjs';
import { runPlan } from '../realBenchPlan.mjs';
import { runPool } from '../realBenchPool.mjs';
import { writePlan } from './syntheticPlans.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STUB = path.join(HERE, 'stubWorker.mjs');
const DEAD = path.join(HERE, 'deadWorker.mjs');
const BENCH = path.join(HERE, '..', '..', 'realBenchmark.mjs');
const jobs = (...names) => names.map((name) => ({ name }));

// A result without what differs between two runs of the same plan.
const withoutMs = (result) => JSON.parse(JSON.stringify(result, (key, value) => (key === 'ms' ? undefined : value)));

describe('the worker pool', () => {
  it('hands every plan to a worker, gets every result back, and reads as a serial run once merged', async () => {
    const order = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];
    const results = await runPool(STUB, jobs(...order), 3);
    expect(results.map((r) => r.name).sort()).toEqual(order);
    expect(results.every((r) => r.echoed)).toBe(true);
    expect(mergeInOrder(order, results).map((r) => r.name)).toEqual(order);
  });

  it('reports the plan a worker died on, and goes on with the rest', async () => {
    const order = ['p1', 'boom', 'p2', 'p3', 'p4'];
    const merged = mergeInOrder(order, await runPool(STUB, jobs(...order), 2));
    expect(merged[1]).toEqual({ name: 'boom', error: expect.stringMatching(/^worker crashed \(exit code 3\)/) });
    expect(merged.filter((r) => r.echoed).map((r) => r.name)).toEqual(['p1', 'p2', 'p3', 'p4']);
  });

  it('replaces a worker that died when it was the only one', async () => {
    const results = await runPool(STUB, jobs('boom', 'p1', 'p2'), 1);
    expect(results).toHaveLength(3);
    expect(results.find((r) => r.name === 'boom').error).toMatch(/worker crashed/);
    expect(results.filter((r) => r.echoed).map((r) => r.name).sort()).toEqual(['p1', 'p2']);
  });

  it('reports every plan as an error when its workers cannot start, instead of waiting', async () => {
    const results = await runPool(DEAD, jobs('p1', 'p2', 'p3'), 2);
    expect(results.map((r) => r.name).sort()).toEqual(['p1', 'p2', 'p3']);
    for (const r of results) expect(r.error).toMatch(/workers failed to start/);
  });

  it('has nothing to wait for with no plans', async () => {
    expect(await runPool(STUB, [], 4)).toEqual([]);
  });
});

describe('the real worker', () => {
  let dir;
  let plans;
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-worker-'));
    plans = ['w1', 'w2'].map((name, i) => ({ name, ...writePlan(dir, name, { shift: i * 6 }) }));
  });
  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // One pool for both cases (a worker is a process that loads the tracer, and
  // that is most of what a case costs): two plans it can score, and one it
  // cannot open, which is an error row and not a crash.
  it('scores a plan as the main process does, and reports one it cannot open as an error row', async () => {
    const items = [
      ...plans.map(({ name, file }) => ({ name, kind: 'project', file })),
      { name: 'absent', kind: 'project', file: path.join(dir, 'absent.floorplan') },
    ];
    const mine = [];
    for (const item of items) mine.push(await runPlan(item));
    const theirs = mergeInOrder(items.map((i) => i.name), await runPool(BENCH, items, 2));
    expect(mine.slice(0, 2).every((r) => r.app?.verdict)).toBe(true);
    expect(theirs.map(withoutMs)).toEqual(mine.map(withoutMs));
    expect(theirs[2]).toMatchObject({ name: 'absent', error: expect.stringMatching(/ENOENT/) });
  }, 60000);

  it('refuses to be started by hand', () => {
    const run = spawnSync(process.execPath, [BENCH, '--worker'], { encoding: 'utf8' });
    expect(run.status).toBe(2);
    expect(run.stderr).toMatch(/started by --jobs/);
  });
});
