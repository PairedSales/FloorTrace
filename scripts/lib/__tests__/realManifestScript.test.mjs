// scripts/realManifest.mjs as a person runs it: help, the exit statuses (0, 1 for
// a failure with one line on stderr, 2 for a command line that cannot be read).
// The commands themselves are tested in manifestCommands.test.mjs.
import { spawnSync } from 'child_process';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeSet } from './pipelineHarness.mjs';

let set;
beforeEach(() => {
  set = makeSet();
});
afterEach(() => set.cleanup());

const row = (book, era, decade, plans, publisher = null) => ({
  book, era, decade, plans, publisher,
});
const ROSTER = [
  row('alpha60', 'vintage', 1960, 8, 'Alpha'), row('beta60', 'vintage', 1960, 8, 'Beta'), row('gamma60', 'vintage', 1960, 6),
  row('delta50', 'vintage', 1950, 8), row('epsilon50', 'vintage', 1950, 4),
  row('zeta20a', '2020-2022', 2020, 10), row('zeta20b', '2020-2022', 2020, 10), row('zeta20c', '2020-2022', 2020, 10), row('zeta20d', '2020-2022', 2020, 10),
];

const script = (name) => fileURLToPath(new URL(`../../${name}`, import.meta.url));
const exec = (name, ...argv) => spawnSync(process.execPath, [script(name), ...argv], {
  encoding: 'utf8', env: { ...process.env, FLOORTRACE_REAL_DIR: set.dir },
});

describe('realManifest', () => {
  it('help, usage errors (2), failures (1) with one line on stderr, and success (0)', () => {
    const help = exec('realManifest.mjs', '--help');
    expect(help.status).toBe(0);
    expect(help.stdout).toMatch(/assign-splits --seed N/);
    expect(help.stdout).toMatch(/amend PLAN --reason TEXT/);
    expect(exec('realManifest.mjs').status).toBe(2);
    expect(exec('realManifest.mjs', 'nonsense').status).toBe(2);
    const noSeed = exec('realManifest.mjs', 'assign-splits');
    expect([noSeed.status, noSeed.stderr.trim()]).toEqual([2, 'assign-splits: assign-splits needs --seed N, a whole number: the split must be reproducible']);
    expect(exec('realManifest.mjs', 'assign-splits', '--seed', '1', '--nonsense').status).toBe(2);
    const noHash = exec('realManifest.mjs', 'hash');
    expect(noHash.status).toBe(1);
    expect(noHash.stderr.trim().split('\n')).toHaveLength(1);
    expect(noHash.stderr).toMatch(/^hash: there is no manifest .*manifest\.json$/m);
    const file = set.write('roster.json', JSON.stringify(ROSTER));
    const ok = exec('realManifest.mjs', 'assign-splits', '--roster', file, '--seed', '5', '--target-test', '30', '--total', '74');
    expect(ok.status).toBe(0);
    expect(ok.stdout).toMatch(/^assign-splits seed 5: 9 books, 74 plans/);
    const written = exec('realManifest.mjs', 'assign-splits', '--roster', file, '--seed', '5', '--write');
    expect(written.status).toBe(0);
    expect(fs.existsSync(set.orch('splits.json'))).toBe(true);
    const verified = exec('realManifest.mjs', 'verify');
    expect(verified.status).toBe(1);
    expect(verified.stdout).toMatch(/^FAIL +manifest /m);
  }, 60000);
});
