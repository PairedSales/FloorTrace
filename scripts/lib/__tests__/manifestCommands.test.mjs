// The commands of scripts/realManifest.mjs (scripts/lib/manifestCommands.mjs) on
// scratch sets, and both scripts as a person runs them: the exit statuses, and
// one line saying why on stderr.
import { spawnSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { UsageError } from '../keyCommands.mjs';
import {
  amend, assignSplitsCommand, build, hash, verify,
} from '../manifestCommands.mjs';
import { loadManifest, manifestFileFor } from '../manifest.mjs';
import { frozenPlan } from './manifestFixtures.mjs';
import {
  makeSet, newPlan, planEvent, writeLog,
} from './pipelineHarness.mjs';

let set;
beforeEach(() => {
  set = makeSet();
});
afterEach(() => set.cleanup());

const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const roster = (rows) => set.write('roster.json', JSON.stringify(rows));
const row = (book, era, decade, plans, publisher = null) => ({
  book, era, decade, plans, publisher,
});
const ROSTER = [
  row('alpha60', 'vintage', 1960, 8, 'Alpha'), row('beta60', 'vintage', 1960, 8, 'Beta'), row('gamma60', 'vintage', 1960, 6),
  row('delta50', 'vintage', 1950, 8), row('epsilon50', 'vintage', 1950, 4),
  row('zeta20a', '2020-2022', 2020, 10), row('zeta20b', '2020-2022', 2020, 10), row('zeta20c', '2020-2022', 2020, 10), row('zeta20d', '2020-2022', 2020, 10),
];
const AT = '2026-09-29T00:00:00.000Z';
const splitsPath = () => set.orch('splits.json');
const splitsOf = () => set.readJson(splitsPath());
const assign = (...argv) => set.run(assignSplitsCommand, ...argv);

describe('assign-splits', () => {
  it('prints the table and writes nothing without --write', async () => {
    const file = roster(ROSTER);
    const r = await assign('--roster', file, '--seed', '5', '--target-test', '30', '--total', '74');
    expect(r.code).toBe(0);
    expect(r.lines[0]).toMatch(/^assign-splits seed 5: 9 books, 74 plans; test target 30 of 74 \(40\.5%\), pinned to dev: none$/);
    expect(r.out).toMatch(/^era +decade +books +plans +dev +test +test target +deviation$/m);
    expect(r.out).toMatch(/^book +split +era +decade +plans +publisher$/m);
    expect(r.lines.at(-1)).toBe('dry run: nothing written (add --write to write orchestration/splits.json)');
    expect(fs.existsSync(splitsPath())).toBe(false);
  });

  it('writes splits.json with --write, the same bytes for the same roster and seed, in any folder', async () => {
    const file = roster(ROSTER);
    await assign('--roster', file, '--seed', '5', '--pin-dev', 'alpha60,beta60', '--write', '--created-at', AT);
    const one = fs.readFileSync(splitsPath(), 'utf8');
    const parsed = JSON.parse(one);
    expect(parsed).toMatchObject({ seed: 5, createdAt: AT, params: { targetTest: 150, total: 400, pinDev: ['alpha60', 'beta60'] } });
    expect(parsed.books.alpha60).toMatchObject({ split: 'dev', pinned: true, era: 'vintage', decade: 1960, publisher: 'Alpha', plans: 8 });
    expect(Object.keys(parsed.books)).toHaveLength(9);
    const other = makeSet();
    try {
      const otherFile = other.write('roster.json', JSON.stringify([...ROSTER].reverse()));
      await other.run(assignSplitsCommand, '--roster', otherFile, '--seed', '5', '--pin-dev', 'beta60', '--pin-dev', 'alpha60', '--write', '--created-at', AT);
      expect(fs.readFileSync(other.orch('splits.json'), 'utf8')).toBe(one);
    } finally {
      other.cleanup();
    }
  });

  it('leaves the file alone, its time included, when running again would change nothing', async () => {
    const file = roster(ROSTER);
    await assign('--roster', file, '--seed', '5', '--write');
    const one = fs.readFileSync(splitsPath(), 'utf8');
    const stamp = fs.statSync(splitsPath()).mtimeMs;
    const again = await assign('--roster', file, '--seed', '5', '--write');
    expect(again.lines.at(-1)).toMatch(/^splits\.json is already this assignment: unchanged -> /);
    expect(fs.readFileSync(splitsPath(), 'utf8')).toBe(one);
    expect(fs.statSync(splitsPath()).mtimeMs).toBe(stamp);
  });

  it('will not move books after plans were drawn against the old assignment, unless --replace, which keeps the old file', async () => {
    const file = roster(ROSTER);
    await assign('--roster', file, '--seed', '5', '--write');
    const old = fs.readFileSync(splitsPath(), 'utf8');
    await expect(assign('--roster', file, '--seed', '6', '--write')).rejects.toThrow(/already holds another assignment \(seed 5\).*--replace writes this one and keeps the old as splits-superseded-<hash>\.json/s);
    expect(fs.readFileSync(splitsPath(), 'utf8')).toBe(old);
    const r = await assign('--roster', file, '--seed', '6', '--write', '--replace');
    expect(splitsOf().seed).toBe(6);
    const kept = path.join(set.dir, 'orchestration', `splits-superseded-${sha(Buffer.from(old)).slice(0, 8)}.json`);
    expect(r.out).toContain(`the previous splits.json is kept -> ${kept}`);
    expect(fs.readFileSync(kept, 'utf8')).toBe(old);
  });

  it('reads the roster from the set folder when none is given: the log, and the names of the plans that predate it', async () => {
    for (const n of ['old50-n1', 'old50-n2', 'old60-n1', 'pacific25-n41', 'pacific25-n42']) set.addPlan(n, newPlan(n));
    writeLog(set, [
      planEvent('pacific25-n41', { book: 'Pacific 1925', publisher: 'Pacific', year: 1925, decade: 1920 }),
      planEvent('pacific25-n42', { book: 'Pacific 1925', publisher: 'Pacific', year: 1925, decade: 1920 }),
    ]);
    const r = await assign('--seed', '3', '--target-test', '3', '--total', '5', '--pin-existing', '--write');
    expect(r.out).toContain('pinned to dev: old50, old60');
    expect(splitsOf().books).toMatchObject({
      old50: { split: 'dev', pinned: true, plans: 2, era: 'vintage', decade: 1950 },
      old60: { split: 'dev', pinned: true, plans: 1 },
      pacific25: { split: 'test', plans: 2, publisher: 'Pacific', decade: 1920 },
    });
  });

  it('refuses what it cannot use: no seed, a bad number, a pin nobody has, a roster of nonsense, --pin-existing with a roster', async () => {
    const file = roster(ROSTER);
    await expect(assign('--roster', file)).rejects.toThrow(UsageError);
    await expect(assign('--roster', file, '--seed', 'abc')).rejects.toThrow(/--seed must be a whole number/);
    await expect(assign('--roster', file, '--seed', '1', '--target-test', '-3')).rejects.toThrow(UsageError);
    await expect(assign('--roster', file, '--seed', '1', '--total', '0')).rejects.toThrow(/--total must be a whole number of at least 1/);
    await expect(assign('--roster', file, '--seed', '1', '--created-at', 'soon')).rejects.toThrow(/--created-at must be a date/);
    await expect(assign('--roster', file, '--seed', '1', '--pin-dev', 'nosuch')).rejects.toThrow(/--pin-dev names nosuch, which the roster does not hold/);
    await expect(assign('--roster', file, '--seed', '1', '--pin-existing')).rejects.toThrow(/--pin-existing reads the set folder's own plans/);
    await expect(assign('--roster', roster([{ book: 'a' }]), '--seed', '1')).rejects.toThrow(/the roster is not usable/);
    await expect(assign('--roster', path.join(set.dir, 'nothing.json'), '--seed', '1')).rejects.toThrow(/does not exist/);
    await expect(assign('--seed', '1')).rejects.toThrow(/non-empty array/);
    expect(fs.existsSync(splitsPath())).toBe(false);
  });

  it('takes the roster as {"books": [...]} too', async () => {
    const r = await assign('--roster', roster({ books: ROSTER }), '--seed', '5');
    expect(r.code).toBe(0);
  });
});

// A set with three frozen plans, and splits.json for them.
const frozenSet = () => {
  set.addPlan('alpha60-n1', frozenPlan('alpha60-n1'));
  set.addPlan('alpha60-n2', frozenPlan('alpha60-n2'));
  set.addPlan('beta61-n3', frozenPlan('beta61-n3'));
  set.addPlan('gamma62-n4', newPlan('gamma62-n4'));
  set.write('orchestration/splits.json', JSON.stringify({
    seed: 9,
    createdAt: AT,
    books: Object.fromEntries(['alpha60', 'beta61', 'gamma62'].map((b, i) => [b, { split: i === 1 ? 'test' : 'dev', era: 'vintage', decade: 1960, publisher: null, plans: 1 }])),
  }));
};

describe('build, hash, verify', () => {
  it('refuses a plan that is not checked, listing it, unless --allow-partial leaves it out', async () => {
    frozenSet();
    await expect(build([], set.ctx)).rejects.toThrow(/the manifest holds only checked keys, and some plans are not.*--allow-partial.*nothing was written/);
    expect(fs.existsSync(manifestFileFor(set.dir))).toBe(false);
    const r = await set.run(build, '--allow-partial', '--reason', 'first milestone');
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^1 plan not checked, left out: gamma62-n4$/m);
    expect(r.out).toMatch(/^manifest: 3 plans: dev 2 \/ test 1; vintage 3 \/ 2020-2022 0$/m);
    expect(r.out).toMatch(/^manifest version 1 written \(first milestone\) -> /m);
    const written = loadManifest(manifestFileFor(set.dir));
    expect(r.lines.at(-1)).toBe(`manifest hash ${written.hash}`);
    expect(Object.keys(written.manifest.plans)).toEqual(['alpha60-n1', 'alpha60-n2', 'beta61-n3']);
    expect(fs.readFileSync(set.orch('manifest-log.md'), 'utf8')).toContain('| first milestone |');
  });

  it('says the manifest is unchanged when it would be, and the hash is the same', async () => {
    frozenSet();
    const first = await set.run(build, '--allow-partial');
    const again = await set.run(build, '--allow-partial');
    expect(again.out).toMatch(/^manifest unchanged: the file already is this manifest \(version 1\)$/m);
    expect(again.lines.at(-1)).toBe(first.lines.at(-1));
    expect(fs.readFileSync(set.orch('manifest-log.md'), 'utf8').match(/^\| \d+ \|/gm)).toHaveLength(1);
  });

  it('builds the whole manifest when every plan is checked', async () => {
    frozenSet();
    set.addPlan('gamma62-n4', frozenPlan('gamma62-n4'));
    const r = await set.run(build);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/manifest: 4 plans/);
    expect(r.out).not.toMatch(/not checked/);
  });

  it('lists a checked plan that cannot have an entry and writes nothing; and needs at least one checked plan', async () => {
    frozenSet();
    set.addPlan('stray70-n9', frozenPlan('stray70-n9'));
    await expect(build(['--allow-partial'], { ...set.ctx, out: (l) => set.lines.push(l) })).rejects.toThrow(/1 checked plan cannot have a manifest entry; nothing was written/);
    expect(set.lines.join('\n')).toMatch(/ERROR stray70-n9: its book stray70 is not in splits.json/);
    expect(fs.existsSync(manifestFileFor(set.dir))).toBe(false);
    fs.rmSync(set.planFile('stray70-n9'));
    for (const n of ['alpha60-n1', 'alpha60-n2', 'beta61-n3']) set.addPlan(n, newPlan(n));
    await expect(set.run(build, '--allow-partial')).rejects.toThrow(/no plan is checked yet/);
  });

  it('prints each rule of verify and exits 1 on a failure', async () => {
    frozenSet();
    await set.run(build, '--allow-partial');
    const partial = await set.run(verify, '--allow-partial');
    expect(partial.code).toBe(0);
    expect(partial.out).toMatch(/^PASS +manifest +version 1, 3 plans, hash [0-9a-f]{12}$/m);
    expect(partial.out).toMatch(/^INFO +strays +1 plan files are not in the manifest: gamma62-n4$/m);
    expect(partial.lines.at(-1)).toBe('VERIFY PASS');
    const strict = await set.run(verify);
    expect(strict.code).toBe(1);
    expect(strict.out).toMatch(/^FAIL +strays /m);
    expect(strict.lines.at(-1)).toBe('VERIFY FAIL (1)');
    const final = await set.run(verify, '--allow-partial', '--final');
    expect(final.code).toBe(1);
    expect(final.out).toMatch(/^FAIL +count +3 plans \(the finished set has exactly 400\)$/m);
    expect(final.out).toMatch(/^FAIL +books +\d+ books or site units \(at least 34\)/m);
    expect(final.lines.at(-1)).toMatch(/^VERIFY FAIL \(\d+\)$/);
  });

  it('prints the hash of the file, and says when there is none', async () => {
    frozenSet();
    await expect(set.run(hash)).rejects.toThrow(/there is no manifest/);
    await set.run(build, '--allow-partial');
    const r = await set.run(hash);
    expect(r.out).toBe(sha(fs.readFileSync(manifestFileFor(set.dir))));
    expect(r.out).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('amend', () => {
  it('rebuilds one plan after a dispute, and says which dispute and how the key changed', async () => {
    frozenSet();
    await set.run(build, '--allow-partial');
    const project = set.readPlan('alpha60-n1');
    project.floors[0].state.perimeterTraces.find((t) => t.type === 'garage').type = 'porch';
    project.answerKey = { ...project.answerKey, disputeId: 'D-3' };
    set.writePlan('alpha60-n1', project);
    const r = await set.run(amend, 'alpha60-n1', '--reason', 'the garage is a porch');
    expect(r.code).toBe(0);
    expect(r.lines[0]).toMatch(/^amend alpha60-n1: dispute D-3; key [0-9a-f]{8} -> [0-9a-f]{8}$/);
    expect(r.lines[1]).toBe('manifest version 2 written');
    expect(r.lines[2]).toBe(`manifest hash ${sha(fs.readFileSync(manifestFileFor(set.dir)))}`);
    expect(fs.readFileSync(set.orch('manifest-log.md'), 'utf8')).toContain('| the garage is a porch (dispute D-3, alpha60-n1) |');
    const again = await set.run(amend, 'alpha60-n1', '--reason', 'again');
    expect(again.lines[1]).toMatch(/^manifest unchanged: it already holds alpha60-n1's current key and record \(version 2\)$/);
  });

  it('refuses a plan with no dispute mark, no reason, and no plan', async () => {
    frozenSet();
    await set.run(build, '--allow-partial');
    await expect(set.run(amend, 'alpha60-n1', '--reason', 'x')).rejects.toThrow(/has no disputeId/);
    await expect(set.run(amend, 'alpha60-n1')).rejects.toThrow(UsageError);
    await expect(set.run(amend, '--reason', 'x')).rejects.toThrow(UsageError);
  });
});

describe('the scripts as they are run', () => {
  const script = (name) => fileURLToPath(new URL(`../../${name}`, import.meta.url));
  const exec = (name, ...argv) => spawnSync(process.execPath, [script(name), ...argv], {
    encoding: 'utf8', env: { ...process.env, FLOORTRACE_REAL_DIR: set.dir },
  });

  it('realManifest: help, usage errors (2), failures (1) with one line on stderr, and success (0)', () => {
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
    const file = roster(ROSTER);
    const ok = exec('realManifest.mjs', 'assign-splits', '--roster', file, '--seed', '5', '--target-test', '30', '--total', '74');
    expect(ok.status).toBe(0);
    expect(ok.stdout).toMatch(/^assign-splits seed 5: 9 books, 74 plans/);
    const written = exec('realManifest.mjs', 'assign-splits', '--roster', file, '--seed', '5', '--write');
    expect(written.status).toBe(0);
    expect(fs.existsSync(splitsPath())).toBe(true);
    const verified = exec('realManifest.mjs', 'verify');
    expect(verified.status).toBe(1);
    expect(verified.stdout).toMatch(/^FAIL +manifest /m);
  }, 60000);

  it('realPipeline: help, usage errors (2), failures (1), and a status of a set', () => {
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
  }, 60000);
});
