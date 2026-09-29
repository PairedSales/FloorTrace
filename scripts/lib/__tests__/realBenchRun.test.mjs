// `npm run bench:real` end to end, on a set built in code: the manifest and the
// splits, the test-split gate and its silence, the run files, the refusal to
// compare across manifests, a key that changed, and a run with no manifest. The
// script runs as a child process against a temp folder standing in for the
// datasets (FLOORTRACE_DATASETS), so nothing here touches the real set.
import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { keySha256, manifestHash } from '../manifest.mjs';
import { TEST_SPLIT_ENV } from '../realBench.mjs';
import { writePlan } from './syntheticPlans.mjs';

const BENCH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'realBenchmark.mjs');
const T = { timeout: 90000 };

let root;
let real;
let manifestFile;
let plans;

const writeManifest = (mutate = () => {}) => {
  const manifest = {
    version: 1,
    seed: 1,
    plans: {
      'dev-one': { book: 'b1', split: 'dev', era: 'vintage', keySha256: keySha256(plans['dev-one'].key) },
      'dev-two': { book: 'b2', split: 'dev', era: '2020-2022', keySha256: keySha256(plans['dev-two'].key) },
      'test-one': { book: 'b3', split: 'test', era: 'vintage', keySha256: keySha256(plans['test-one'].key) },
    },
  };
  mutate(manifest);
  fs.writeFileSync(manifestFile, JSON.stringify(manifest));
  return manifestHash(manifestFile);
};

const bench = (argv, env = {}) => new Promise((resolve) => {
  execFile(process.execPath, [BENCH, ...argv], {
    env: { ...process.env, FLOORTRACE_DATASETS: root, [TEST_SPLIT_ENV]: '', ...env },
    encoding: 'utf8',
    maxBuffer: 1 << 24,
  }, (error, stdout, stderr) => resolve({ code: error ? error.code : 0, stdout, stderr }));
});
const ORCHESTRATOR = { [TEST_SPLIT_ENV]: '1' };

const runFile = (name) => path.join(root, 'real_runs', `${name}.json`);
const readRun = (name) => JSON.parse(fs.readFileSync(runFile(name), 'utf8'));
const withoutMs = (value) => JSON.parse(JSON.stringify(value, (key, v) => (key === 'ms' ? undefined : v)));
// What a run says that does not depend on how it was run.
const stable = (stdout) => stdout.split('\n')
  .filter((line) => !/^bench:real|trace time|timings taken|^results:/.test(line))
  .join('\n')
  .split('\n=== Against')[0];

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-run-'));
  real = path.join(root, 'real');
  manifestFile = path.join(real, 'orchestration', 'manifest.json');
  fs.mkdirSync(path.dirname(manifestFile), { recursive: true });
  plans = {
    'dev-one': writePlan(real, 'dev-one'),
    'dev-two': writePlan(real, 'dev-two', { shift: 4 }),
    'test-one': writePlan(real, 'test-one', { shift: 8 }),
    'stray-one': writePlan(real, 'stray-one', { shift: 2 }),
  };
});
afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('bench:real with a manifest', () => {
  let hash;
  beforeAll(() => {
    hash = writeManifest();
  });

  it('runs the dev split by default, and names the run', T, async () => {
    const run = await bench(['--out', 'r1']);
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
    const file = readRun('r1');
    expect(file.meta).toMatchObject({
      dir: real, split: 'dev', only: null, watch: null, manifestHash: hash, jobs: 1,
    });
    expect(typeof file.meta.commit).toBe('string');
    expect(file.meta.timing).toMatchObject({ parallel: false, plans: 2 });
    expect(file.meta.timing.app.median).toBeGreaterThan(0);
    expect(file.results.map((r) => r.name)).toEqual(['dev-one', 'dev-two', 'stray-one']);
    expect(file.testAggregate).toBeUndefined();
    expect(fs.existsSync(path.join(root, 'real_runs', 'r1.test.json'))).toBe(false);
  });

  it('refuses the test split without the orchestrator\'s variable, and writes nothing', T, async () => {
    for (const argv of [['--split', 'test'], ['--split', 'all'], ['--only', 'test-one'], ['--watch', 'none', '--split', 'all']]) {
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
    const test = JSON.parse(fs.readFileSync(path.join(root, 'real_runs', 'r3.test.json'), 'utf8'));
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
    const serial = await bench(['--out', 'r1b']);
    expect(stable(run.stdout)).toBe(stable(serial.stdout));
  });

  it('will not compare across manifests, and says which two', T, async () => {
    const before = manifestHash(manifestFile);
    const after = writeManifest((m) => {
      m.plans['dev-one'].note = 'a field nothing reads still changes the file';
    });
    expect(after).not.toBe(before);
    const run = await bench(['--compare', 'r1', '--out', 'r5']);
    expect(run.code).toBe(2);
    expect(run.stderr).toContain(before);
    expect(run.stderr).toContain(after);
    expect(run.stdout).toBe('');
    expect(fs.existsSync(runFile('r5'))).toBe(false);
    writeManifest();
  });

  it('does not score a plan whose key changed, and does not name a test plan that did', T, async () => {
    fs.writeFileSync(plans['dev-one'].file, JSON.stringify(writePlan(path.join(root, 'moved'), 'x', { shift: 20 }).project));
    fs.writeFileSync(plans['test-one'].file, JSON.stringify(writePlan(path.join(root, 'moved'), 'y', { shift: 25 }).project));
    const run = await bench(['--split', 'all', '--out', 'r6'], ORCHESTRATOR);
    expect(run.code).toBe(1);
    expect(run.stdout).toMatch(/dev-one: ERROR key changed since the manifest \(was [0-9a-f]{8}, is [0-9a-f]{8}\)/);
    expect(run.stdout).not.toContain('test-one');
    expect(run.stdout).toMatch(/test split: 0 scored, 1 errors, 0 skipped/);
    const main = readRun('r6');
    expect(main.testAggregate).toMatchObject({ plans: 0, errors: 1 });
    expect(main.results.find((r) => r.name === 'dev-two').app.verdict).toBeTruthy();
    const test = JSON.parse(fs.readFileSync(path.join(root, 'real_runs', 'r6.test.json'), 'utf8'));
    expect(test.results[0].error).toMatch(/^key changed since the manifest/);
  });

  it('reports a plan the manifest lists and the folder lacks as an error', T, async () => {
    writeManifest((m) => {
      m.plans.ghost = { split: 'dev', era: 'vintage' };
    });
    const run = await bench(['--only', 'ghost', '--out', 'r8']);
    expect(run.code).toBe(1);
    expect(run.stdout).toMatch(/ghost: ERROR in the manifest, but ghost\.floorplan is not in/);
    writeManifest();
  });

  it('refuses a manifest it cannot read, before running anything', T, async () => {
    fs.writeFileSync(manifestFile, '{"version": 1,');
    const run = await bench(['--out', 'r9']);
    expect(run.code).toBe(2);
    expect(run.stderr).toMatch(/is not valid JSON/);
    expect(run.stdout).toBe('');
    writeManifest();
  });
});

describe('bench:real with no manifest', () => {
  const plain = () => path.join(root, 'plain');
  beforeAll(() => {
    writePlan(plain(), 'only-one');
  });

  it('is what it was: every plan, no split, and a run that says so', T, async () => {
    const run = await bench(['--dir', plain(), '--out', 'r10']);
    expect(run.code).toBe(0);
    expect(run.stdout).toMatch(/split all {2}manifest none {2}plans 1 {2}jobs 1/);
    expect(run.stdout).toMatch(/only-one +\w+ +IoU/);
    // Eras come from a manifest; without one the output is what it was.
    expect(run.stdout).not.toMatch(/vintage|2020-2022/);
    const file = readRun('r10');
    expect(file.meta).toMatchObject({ split: 'all', manifestHash: null });
    expect(file.results).toHaveLength(1);
  });

  it('cannot name a split, and compares only with a run that had no manifest either', T, async () => {
    const split = await bench(['--dir', plain(), '--split', 'dev', '--out', 'r11']);
    expect(split.code).toBe(2);
    expect(split.stderr).toMatch(/reads the manifest, and there is none/);
    const across = await bench(['--dir', plain(), '--compare', 'r1', '--out', 'r11']);
    expect(across.code).toBe(2);
    expect(across.stderr).toMatch(/manifest none/);
    const same = await bench(['--dir', plain(), '--compare', 'r10', '--out', 'r11']);
    expect(same.code).toBe(0);
    expect(same.stdout).toMatch(/=== Against r10 ===/);
  });

  it('refuses an option it does not know', T, async () => {
    const run = await bench(['--dir', plain(), '--splt', 'test']);
    expect(run.code).toBe(2);
    expect(run.stderr).toMatch(/unknown option --splt/);
  });
});
