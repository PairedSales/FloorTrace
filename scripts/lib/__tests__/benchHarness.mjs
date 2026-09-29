// What the process-level `bench:real` suites (realBenchRun, realBenchRunEdges)
// share: the script run as a child against a temp folder standing in for the
// datasets (FLOORTRACE_DATASETS), so nothing here touches the real set. Not a
// test file: the suites import it.
import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { keySha256, manifestHash } from '../manifest.mjs';
import { TEST_SPLIT_ENV } from '../realBench.mjs';
import { writePlan } from './syntheticPlans.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SCRIPTS = path.join(HERE, '..', '..');
export const BENCH = path.join(SCRIPTS, 'realBenchmark.mjs');
export const T = { timeout: 90000 };
export const ORCHESTRATOR = { [TEST_SPLIT_ENV]: '1' };

// A stand-in for the datasets folder with a set in it: plans dev-one, dev-two,
// test-one and stray-one (in the folder, not in the manifest) under real/.
export const makeSet = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-run-'));
  const real = path.join(root, 'real');
  const manifestFile = path.join(real, 'orchestration', 'manifest.json');
  fs.mkdirSync(path.dirname(manifestFile), { recursive: true });
  const plans = {
    'dev-one': writePlan(real, 'dev-one'),
    'dev-two': writePlan(real, 'dev-two', { shift: 4 }),
    'test-one': writePlan(real, 'test-one', { shift: 8 }),
    'stray-one': writePlan(real, 'stray-one', { shift: 2 }),
  };
  // Writes the manifest of the set (its hash returned); `mutate` edits it first.
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
  const run = (script, argv, env = {}) => new Promise((resolve) => {
    execFile(process.execPath, [script, ...argv], {
      env: { ...process.env, FLOORTRACE_DATASETS: root, [TEST_SPLIT_ENV]: '', ...env },
      encoding: 'utf8',
      maxBuffer: 1 << 24,
    }, (error, stdout, stderr) => resolve({ code: error ? error.code : 0, stdout, stderr }));
  });
  const bench = (argv, env) => run(BENCH, argv, env);
  const runFile = (name, suffix = '') => path.join(root, 'real_runs', `${name}${suffix}.json`);
  const readRun = (name, suffix = '') => JSON.parse(fs.readFileSync(runFile(name, suffix), 'utf8'));
  return {
    root, real, manifestFile, plans, writeManifest, run, bench, runFile, readRun,
    remove: () => fs.rmSync(root, { recursive: true, force: true }),
  };
};

export const withoutMs = (value) => JSON.parse(JSON.stringify(value, (key, v) => (key === 'ms' ? undefined : v)));

// What a run says that does not depend on how it was run.
export const stable = (stdout) => stdout.split('\n')
  .filter((line) => !/^bench:real|trace time|timings taken|^results:/.test(line))
  .join('\n')
  .split('\n=== Against')[0];
