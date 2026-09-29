// `npm run bench:real` end to end on a set built in code, with a manifest: the
// splits, the test-split gate and its silence, the run files, the refusal to
// compare across manifests, and a key that changed. The script runs as a child
// process against a temp folder (benchHarness.mjs), so nothing here touches the
// real set. The edges (a manifest named and missing, a copy of the set, no
// manifest at all) are in realBenchRunEdges.test.mjs; the two are apart so that
// each stays well inside the time a test file may take.
import fs from 'fs';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { manifestHash } from '../manifest.mjs';
import {
  ORCHESTRATOR, T, makeSet, stable, withoutMs,
} from './benchHarness.mjs';
import { writePlan } from './syntheticPlans.mjs';

const set = makeSet();
const {
  root, plans, bench, runFile, readRun,
} = set;

let hash;
let serialStdout;
beforeAll(() => {
  hash = set.writeManifest();
});
afterAll(() => set.remove());

describe('bench:real with a manifest', () => {
  it('runs the dev split by default, and names the run', T, async () => {
    const run = await bench(['--out', 'r1']);
    serialStdout = run.stdout;
    expect(run.code).toBe(0);
    expect(run.stdout).toMatch(new RegExp(`^bench:real {2}commit \\S+ {2}split dev {2}manifest ${hash.slice(0, 12)} {2}plans 2 {2}jobs 1$`, 'm'));
    expect(run.stdout).toMatch(/dev-one +\w+ +IoU/);
    expect(run.stdout).toMatch(/dev-two +\w+ +IoU/);
    expect(run.stdout).toMatch(/stray-one: not in the manifest/);
    expect(run.stdout).not.toContain('test-one');
    expect(run.stdout).toMatch(/Scoreboard: 1 vintage plans/);
    expect(run.stdout).toMatch(/Scoreboard: 1 2020-2022 plans/);
    expect(run.stdout).toMatch(/mean error by cause: non-GLA space kept/);
    expect(run.stdout).toMatch(/trace time \(ms\): app median \d+, p90 \d+; bare median \d+, p90 \d+/);
    expect(run.stdout).not.toMatch(/parallel load/);
    // Every plan carries its fingerprint, so there is nothing to say about unchecked keys.
    expect(run.stdout).not.toMatch(/key check/);
    const file = readRun('r1');
    expect(file.meta).toMatchObject({
      dir: set.real, split: 'dev', only: null, watch: null, manifestHash: hash, jobs: 1,
    });
    expect(typeof file.meta.commit).toBe('string');
    expect(file.meta.timing).toMatchObject({ parallel: false, plans: 2 });
    expect(file.meta.timing.app.median).toBeGreaterThan(0);
    expect(file.results.map((r) => r.name)).toEqual(['dev-one', 'dev-two', 'stray-one']);
    expect(file.testAggregate).toBeUndefined();
    expect(fs.existsSync(runFile('r1', '.test'))).toBe(false);
  });

  it('refuses the test split without the orchestrator\'s variable, and writes nothing', T, async () => {
    // Each way in is refused by the same call (realBench.test.mjs holds them all);
    // two here, for the wiring: by the split, and by naming a plan.
    for (const argv of [['--split', 'all'], ['--only', 'test-one']]) {
      const run = await bench([...argv, '--out', 'r2']);
      expect(run.code).toBe(2);
      expect(run.stderr).toMatch(/only by the orchestrator/);
      expect(run.stdout).toBe('');
    }
    expect(fs.existsSync(runFile('r2'))).toBe(false);
  });

  it('runs the test split as an aggregate, never per plan', T, async () => {
    const run = await bench(['--split', 'all', '--draw', '--jobs', '2', '--out', 'r3'], ORCHESTRATOR);
    expect(run.code).toBe(0);
    expect(run.stdout).not.toContain('test-one');
    expect(run.stdout).toMatch(/split all {2}manifest \w{12} {2}plans 3 {2}jobs 2/);
    expect(run.stdout).toMatch(/parallel load: 2 jobs/);
    expect(run.stdout).toMatch(/test split: 1 scored, 0 errors, 0 skipped; per plan only in r3\.test\.json/);
    expect(run.stdout).toMatch(/--draw: no overlay for the 1 test plans/);
    expect(run.stdout).toMatch(/Scoreboard: 1 test-split plans \(aggregate only\)/);
    expect(run.stdout).toMatch(/Scoreboard: 2 dev-split plans/);
    const main = readRun('r3');
    expect(fs.readFileSync(runFile('r3'), 'utf8')).not.toContain('test-one');
    expect(main.results.map((r) => r.name)).toEqual(['dev-one', 'dev-two', 'stray-one']);
    expect(main.testAggregate).toMatchObject({ plans: 1, errors: 0, jobs: 2 });
    expect(main.testAggregate.eras.vintage.plans).toBe(1);
    expect(main.testAggregate.eras['2020-2022'].plans).toBe(0);
    expect(main.meta).toMatchObject({ split: 'all', jobs: 2, manifestHash: hash });
    const test = readRun('r3', '.test');
    expect(test.results.map((r) => r.name)).toEqual(['test-one']);
    expect(test.results[0].app.verdict).toBeTruthy();
    expect(fs.existsSync(path.join(root, 'real_runs', 'r3', 'dev-one.png'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'real_runs', 'r3', 'test-one.png'))).toBe(false);
  });

  it('gives the same results on two workers as on one, and compares with the earlier run', T, async () => {
    const run = await bench(['--jobs', '2', '--compare', 'r1', '--out', 'r4']);
    expect(run.code).toBe(0);
    expect(run.stdout).toMatch(/parallel load: 2 jobs/);
    expect(run.stdout).toMatch(/=== Against r1 ===\n {3}baseline: commit \S+, split dev, manifest \w{12}/);
    expect(withoutMs(readRun('r4').results)).toEqual(withoutMs(readRun('r1').results));
    // r1 was the serial run: what the two print, apart from the timings and the comparison, is the same.
    expect(stable(run.stdout)).toBe(stable(serialStdout));
  });

  it('will not compare across manifests, and says which two', T, async () => {
    const before = manifestHash(set.manifestFile);
    const after = set.writeManifest((m) => {
      m.plans['dev-one'].note = 'a field nothing reads still changes the file';
    });
    expect(after).not.toBe(before);
    const run = await bench(['--compare', 'r1', '--out', 'r5']);
    expect(run.code).toBe(2);
    expect(run.stderr).toContain(before);
    expect(run.stderr).toContain(after);
    expect(run.stdout).toBe('');
    expect(fs.existsSync(runFile('r5'))).toBe(false);
    set.writeManifest();
  });

  it('does not score a plan whose key changed, and names no test plan in the main file', T, async () => {
    fs.writeFileSync(plans['dev-one'].file, JSON.stringify(writePlan(path.join(root, 'moved'), 'x', { shift: 20 }).project));
    fs.writeFileSync(plans['test-one'].file, JSON.stringify(writePlan(path.join(root, 'moved'), 'y', { shift: 25 }).project));
    const run = await bench(['--only', 'dev-one,dev-two,test-one', '--out', 'r6'], ORCHESTRATOR);
    expect(run.code).toBe(1);
    expect(run.stdout).toMatch(/dev-one: ERROR key changed since the manifest \(was [0-9a-f]{8}, is [0-9a-f]{8}\)/);
    expect(run.stdout).not.toContain('test-one');
    expect(run.stdout).toMatch(/test split: 0 scored, 1 errors, 0 skipped/);
    const main = readRun('r6');
    expect(main.testAggregate).toMatchObject({ plans: 0, errors: 1 });
    expect(main.results.map((r) => r.name)).toEqual(['dev-one', 'dev-two']);
    expect(main.results.find((r) => r.name === 'dev-two').app.verdict).toBeTruthy();
    // What was asked for names a test plan; the main file keeps the open ones and a count.
    expect(main.meta).toMatchObject({ only: ['dev-one', 'dev-two'], onlyTest: 1 });
    expect(fs.readFileSync(runFile('r6'), 'utf8')).not.toContain('test-one');
    const test = readRun('r6', '.test');
    expect(test.results[0].error).toMatch(/^key changed since the manifest/);
    expect(test.meta.only).toEqual(['dev-one', 'dev-two', 'test-one']);
  });
});
