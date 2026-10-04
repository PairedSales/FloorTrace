// `npm run bench:real` run as a child, on a set built in code (benchHarness.mjs):
// a run with no manifest at all, which is how the real set is run; a plan the
// manifest lists and the folder lacks; and the script that says whether two
// runs scored the same. The split gate and the comparisons are unit-tested in
// realBench.test.mjs and manifest.test.mjs.
import fs from 'fs';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  SCRIPTS, T, makeSet,
} from './benchHarness.mjs';
import { writePlan } from './syntheticPlans.mjs';

const set = makeSet();
const {
  root, run: runNode, bench, runFile, readRun,
} = set;

beforeAll(() => {
  set.writeManifest();
});
afterAll(() => set.remove());

const writeRun = (name, run) => {
  fs.mkdirSync(path.join(root, 'real_runs'), { recursive: true });
  fs.writeFileSync(runFile(name), JSON.stringify(run));
};

describe('bench:real with a manifest that was named', () => {
  it('reports a plan it lists and the folder lacks as an error', T, async () => {
    set.writeManifest((m) => {
      m.plans.ghost = { split: 'dev', era: 'vintage' };
    });
    const run = await bench(['--only', 'ghost', '--out', 'e4']);
    expect(run.code).toBe(1);
    expect(run.stdout).toMatch(/ghost: ERROR in the manifest, but ghost\.floorplan is not in/);
    set.writeManifest();
  });
});

describe('bench:real with no manifest', () => {
  const plain = path.join(root, 'plain');
  beforeAll(() => {
    writePlan(plain, 'only-one');
    // Runs as an earlier `bench:real` left them: one without a manifest, one under another.
    writeRun('base-none', { meta: { manifestHash: null }, results: [] });
    writeRun('base-hash', { meta: { manifestHash: 'a'.repeat(64) }, results: [] });
  });

  it('is what it was: every plan, no split, and a comparison with a run that had none either', T, async () => {
    const run = await bench(['--dir', plain, '--compare', 'base-none', '--out', 'e7']);
    expect(run.code).toBe(0);
    expect(run.stdout).toMatch(/split all {2}manifest none {2}plans 1 {2}jobs 1/);
    expect(run.stdout).toMatch(/only-one +\w+ +IoU/);
    expect(run.stdout).toMatch(/=== Against base-none ===/);
    // Eras come from a manifest, and so does the key check; without one the output is what it was.
    expect(run.stdout).not.toMatch(/vintage|2020-2022|key check/);
    const file = readRun('e7');
    expect(file.meta).toMatchObject({ split: 'all', manifestHash: null });
    expect(file.results).toHaveLength(1);
  });
});

describe('the script that says whether two runs scored the same', () => {
  const diff = (a, b) => runNode(path.join(SCRIPTS, 'realRunDiff.mjs'), [a, b]);
  const p1 = (ms, iou = 0.99) => ({ name: 'p1', app: { verdict: 'perfect', iou, ms }, bare: { verdict: 'near', ms } });
  beforeAll(() => {
    writeRun('d-a', { meta: {}, results: [p1(100)] });
    writeRun('d-b', { meta: { jobs: 8 }, results: [p1(7)] });
    writeRun('d-moved', { meta: {}, results: [p1(100, 0.9)] });
    writeRun('d-empty', { meta: {}, results: [] });
    writeRun('d-test-only', { meta: {}, results: [], testAggregate: { plans: 3 } });
  });

  it('says identical for the same scores at other times, and different for one that moved', async () => {
    const same = await diff('d-a', 'd-b');
    expect(same.code).toBe(0);
    expect(same.stdout).toMatch(/identical: 1 results/);
    const moved = await diff('d-a', 'd-moved');
    expect(moved.code).toBe(1);
    expect(moved.stdout).toMatch(/differing: p1/);
  });
});
