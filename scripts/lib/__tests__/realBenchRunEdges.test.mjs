// `npm run bench:real` at its edges, on a set built in code (benchHarness.mjs):
// a manifest that was named and is not there, a copy of the set made without its
// manifest, a manifest that cannot be read, a run with no manifest at all, and
// the script that says whether two runs scored the same. Most are refusals, and
// a refusal is a cheap run: the tracer loads only when a plan is about to be
// scored. The gate, the run files and the comparisons are in realBenchRun.test.mjs.
import fs from 'fs';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { manifestHash } from '../manifest.mjs';
import {
  ORCHESTRATOR, SCRIPTS, T, makeSet,
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
  it('is refused when the file is not there, with or without the orchestrator\'s variable', T, async () => {
    const nowhere = path.join(root, 'nowhere.json');
    // Without an error this would be a run with no manifest: every plan, test
    // ones included, printed one by one, with no gate.
    for (const [env, extra] of [[{}, []], [ORCHESTRATOR, ['--only', 'dev-one,test-one', '--draw']]]) {
      const run = await bench(['--manifest', nowhere, ...extra, '--out', 'e1'], env);
      expect(run.code).toBe(2);
      expect(run.stderr).toMatch(/the manifest .*nowhere\.json does not exist/);
      expect(run.stdout).toBe('');
    }
    expect(fs.existsSync(runFile('e1'))).toBe(false);
  });

  it('is used as named, and says when plans in it carry no key fingerprint', T, async () => {
    const own = path.join(root, 'own.json');
    fs.writeFileSync(own, JSON.stringify({ version: 1, plans: { 'dev-two': { split: 'dev', era: '2020-2022' } } }));
    const run = await bench(['--manifest', own, '--only', 'dev-two', '--out', 'e2']);
    expect(run.code).toBe(0);
    expect(run.stdout).toContain(`manifest ${manifestHash(own).slice(0, 12)}`);
    expect(run.stdout).toMatch(/^ {3}key check: 1 of 1 manifest plans carry no keySha256, so their keys are not checked$/m);
    expect(run.stdout).toMatch(/dev-two +\w+ +IoU/);
    expect(readRun('e2').meta.manifestHash).toBe(manifestHash(own));
  });

  it('is refused when it cannot be read, before running anything', T, async () => {
    const good = fs.readFileSync(set.manifestFile);
    fs.writeFileSync(set.manifestFile, '{"version": 1,');
    const run = await bench(['--out', 'e3']);
    expect(run.code).toBe(2);
    expect(run.stderr).toMatch(/is not valid JSON/);
    expect(run.stdout).toBe('');
    fs.writeFileSync(set.manifestFile, good);
  });

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

describe('bench:real on a copy of the set with no manifest beside it', () => {
  const copy = path.join(root, 'copy');
  beforeAll(() => {
    writePlan(copy, 'dev-one');
    writePlan(copy, 'test-one', { shift: 8 });
  });

  it('is refused when the set\'s manifest calls a plan in it test, and names none', T, async () => {
    const run = await bench(['--dir', copy, '--out', 'e5']);
    expect(run.code).toBe(2);
    expect(run.stderr).toMatch(/1 of the plans in .*copy are in the test split of .*manifest\.json, but no manifest sits beside them/);
    expect(run.stderr).toMatch(/--manifest/);
    expect(run.stderr).not.toContain('test-one');
    expect(run.stdout).toBe('');
    expect(fs.existsSync(runFile('e5'))).toBe(false);
  });

  it('is gated once the set\'s manifest is named', T, async () => {
    const run = await bench(['--dir', copy, '--manifest', set.manifestFile, '--split', 'test', '--out', 'e6']);
    expect(run.code).toBe(2);
    expect(run.stderr).toMatch(/only by the orchestrator/);
    expect(run.stdout).toBe('');
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

  it('cannot name a split, and will not compare with a run made under a manifest', T, async () => {
    const split = await bench(['--dir', plain, '--split', 'dev', '--out', 'e8']);
    expect(split.code).toBe(2);
    expect(split.stderr).toMatch(/reads the manifest, and there is none/);
    const across = await bench(['--dir', plain, '--compare', 'base-hash', '--out', 'e8']);
    expect(across.code).toBe(2);
    expect(across.stderr).toMatch(/manifest none/);
    expect(across.stdout).toBe('');
  });

  it('refuses an option it does not know', T, async () => {
    const run = await bench(['--dir', plain, '--splt', 'test']);
    expect(run.code).toBe(2);
    expect(run.stderr).toMatch(/unknown option --splt/);
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

  it('refuses a run with no results rather than call two empty runs identical', async () => {
    for (const [a, b, which] of [['d-empty', 'd-empty', 'first'], ['d-a', 'd-empty', 'second'], ['d-test-only', 'd-a', 'first']]) {
      const run = await diff(a, b);
      expect(run.code, `${a} ${b}`).toBe(2);
      expect(run.stderr).toContain(`the ${which} run has no results`);
      expect(run.stdout).not.toMatch(/identical/);
    }
  });

  it('refuses a file that is not there', async () => {
    const run = await diff('d-a', 'd-nowhere');
    expect(run.code).toBe(2);
    expect(run.stderr).toMatch(/d-nowhere\.json cannot be read/);
  });
});
