// The commands of scripts/realManifest.mjs (scripts/lib/manifestCommands.mjs) on
// scratch sets.
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
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

  it('does not take a plan with a source of its own that the log has no line for as one of the original 75: it is left out with a warning, and --pin-existing does not pin it', async () => {
    const url = (n) => `https://web.archive.org/web/20210101000000id_/https://x.example/${n}.png`;
    const own = (n) => newPlan(n, { source: { url: url(n), crop: [0, 0, 460, 300], size: [460, 300] } });
    for (const n of ['old50-n1', 'old50-n2']) set.addPlan(n, newPlan(n));
    // hpn21-* are 2021 captures the log has no line for yet; hpn22-31000 is logged.
    for (const n of ['hpn21-24360', 'hpn21-24361', 'hpn22-31000']) set.addPlan(n, own(n));
    writeLog(set, [planEvent('hpn22-31000', {
      book: 'HPN 963', era: '2020-2022', year: 2022, decade: 2020, unit: '963', site: 'hpn.example', url: url('hpn22-31000'),
    })]);
    const r = await assign('--seed', '3', '--target-test', '1', '--total', '3', '--pin-existing', '--write');
    expect(r.out).toContain('pinned to dev: old50');
    expect(r.out).toContain('WARNING: hpn21-24360: no era or decade (it has a source of its own but no line in sources.jsonl: log it with realSource log plan): left out of the roster');
    expect(r.out).toContain('WARNING: hpn21-24361: no era or decade');
    expect(r.out).not.toMatch(/hpn21 /);
    expect(Object.keys(splitsOf().books)).toEqual(['963', 'old50']);
    expect(splitsOf().books.old50).toMatchObject({ split: 'dev', pinned: true, plans: 2, era: 'vintage', decade: 1950 });
    expect(splitsOf().books['963']).toMatchObject({ era: '2020-2022', decade: 2020, plans: 1 });
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

  it('logs the manifest when the log lost its row, and says so instead of calling it unchanged', async () => {
    frozenSet();
    const first = await set.run(build, '--allow-partial');
    fs.writeFileSync(set.orch('manifest-log.md'), fs.readFileSync(set.orch('manifest-log.md'), 'utf8').split('\n').filter((l) => !/^\| \d+ \|/.test(l)).join('\n'));
    expect((await set.run(verify, '--allow-partial')).out).toMatch(/^INFO +log +.*has no rows/m);
    const again = await set.run(build, '--allow-partial');
    expect(again.out).toMatch(/^manifest unchanged: the file already is this manifest, but the log did not name it: version 1 logged now -> /m);
    expect(again.lines.at(-1)).toBe(first.lines.at(-1));
    expect(fs.readFileSync(set.orch('manifest-log.md'), 'utf8').match(/^\| \d+ \|/gm)).toHaveLength(1);
    const third = await set.run(build, '--allow-partial');
    expect(third.out).toMatch(/^manifest unchanged: the file already is this manifest \(version 1\)$/m);
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
    expect(partial.out).toMatch(/^PASS +manifest +3 plans, hash [0-9a-f]{12}, schema 1, log version 1$/m);
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

// The scripts as a person runs them (exit statuses, one line on stderr) are in
// realManifestScript.test.mjs and realPipelineScript.test.mjs, a file each: every
// case starts node processes, and one file holding both took 43 s inside a full
// `npm test` (CLAUDE.md asks for each file to stay well under 60 s).
