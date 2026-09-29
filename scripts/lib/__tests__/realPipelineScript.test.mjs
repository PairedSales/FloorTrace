// scripts/realPipeline.mjs as a person runs it: help, the exit statuses (0, 1 for
// a failure with one line on stderr, 2 for a command line that cannot be read),
// and a status, a sample and a backup of a scratch set. The commands themselves
// are tested in pipelineCommands.test.mjs and pipelineFreeze.test.mjs.
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { frozenPlan } from './manifestFixtures.mjs';
import { makeSet, newPlan } from './pipelineHarness.mjs';

let set;
beforeEach(() => {
  set = makeSet();
});
afterEach(() => set.cleanup());

const script = (name) => fileURLToPath(new URL(`../../${name}`, import.meta.url));
const exec = (name, ...argv) => spawnSync(process.execPath, [script(name), ...argv], {
  encoding: 'utf8', env: { ...process.env, FLOORTRACE_REAL_DIR: set.dir },
});

describe('realPipeline', () => {
  it('help, usage errors (2), failures (1), and a status of a set', () => {
    const help = exec('realPipeline.mjs', '--help');
    expect(help.status).toBe(0);
    expect(help.stdout).toMatch(/finalize-agreed \[selector\]/);
    expect(exec('realPipeline.mjs').status).toBe(2);
    expect(exec('realPipeline.mjs', 'nonsense').status).toBe(2);
    const bare = exec('realPipeline.mjs', 'status');
    expect([bare.status, bare.stderr.trim()]).toEqual([2, 'status: select plans with --names A,B (or plan names), --book X, --split dev|test, or --all']);
    set.addPlan('alpha60-n1', newPlan('alpha60-n1'));
    set.addPlan('alpha60-n2', frozenPlan('alpha60-n2'));
    const ok = exec('realPipeline.mjs', 'status', '--all');
    expect(ok.status).toBe(0);
    expect(ok.stdout).toMatch(/^alpha60-n1 +- +- +- +- +- +- +- +- +- +-$/m);
    expect(ok.stdout).toMatch(/^alpha60-n2 .* yes$/m);
    const missing = exec('realPipeline.mjs', 'status', '--names', 'nosuch1-n1');
    expect(missing.status).toBe(1);
    expect(missing.stderr).toMatch(/^status: no plan named nosuch1-n1/);
    const sampled = exec('realPipeline.mjs', 'sample', '--all', '--fraction', '0.5', '--seed', '1');
    expect(sampled.status).toBe(0);
    expect(sampled.stdout.split('\n')[0]).toBe('seed 1: 1 plan of 2 (50.0%, fraction 0.5)');
    // The freeze exports through the script `realKeys export`, and a backup lands beside the set folder.
    const backedUp = exec('realPipeline.mjs', 'backup', '--name', 'real-backup-cli');
    expect(backedUp.status).toBe(0);
    expect(fs.existsSync(path.join(set.root, 'real-backup-cli', 'alpha60-n1.floorplan'))).toBe(true);
    expect(exec('realPipeline.mjs', 'backup', '--name', '../x').status).toBe(1);
    // A finalize-single that cannot tell the sample from the rest is a usage error (2), one line on stderr.
    const single = exec('realPipeline.mjs', 'finalize-single', '--all');
    expect(single.status).toBe(2);
    expect(single.stderr.trim().split('\n')).toHaveLength(1);
    expect(single.stderr).toMatch(/^finalize-single: finalize-single finalizes every selected plan .*--no-sample/);
  }, 60000);
});
