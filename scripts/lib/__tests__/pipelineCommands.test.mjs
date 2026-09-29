// The pipeline commands (scripts/lib/pipelineCommands.mjs) end to end on a
// scratch set folder of synthetic plans: the selectors, the packets, the import
// of the existing drafts as annotation A, what `status` says at each stage, the
// comparison tally, finalizing what agrees, the single-annotation group, the
// adjudicator's record, and the deterministic sample.
import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  UsageError, check, compare, review, snap,
} from '../keyCommands.mjs';
import {
  adjudicated, compareAll, finalizeAgreed, finalizeSingle, importExisting, packets, sample, status,
} from '../pipelineCommands.mjs';
import {
  GARAGE, HOUSE, draftPlan, makeSet, newPlan, planEvent, specOf, writeLog,
} from './pipelineHarness.mjs';

let set;
beforeEach(() => {
  set = makeSet();
});
afterEach(() => set.cleanup());

const NAMES = ['alpha60-n1', 'alpha60-n2', 'beta61-n3'];
const addNew = (...names) => names.forEach((n) => set.addPlan(n, newPlan(n)));
const splits = (books) => set.write('orchestration/splits.json', JSON.stringify({
  seed: 1,
  createdAt: 'then',
  books: Object.fromEntries(Object.entries(books).map(([book, split]) => [book, {
    split, era: 'vintage', decade: 1960, publisher: null, plans: 1,
  }])),
}));
// One annotator's round, as the key tool runs it.
const annotate = (name, role, author, shift = 0, extra = {}) => set.run(snap, name, '--role', role, '--spec', set.writeSpec(`${name}.${role}.json`, specOf(author, shift, extra)));
const json = async (...argv) => JSON.parse((await set.run(status, ...argv, '--json')).out);
const rowOf = (out, name) => out.split('\n').find((l) => l.startsWith(name));

describe('selectors', () => {
  it('refuses to guess: no selector is a usage error that lists the options', async () => {
    addNew(...NAMES);
    await expect(set.run(status)).rejects.toThrow(UsageError);
    await expect(set.run(status)).rejects.toThrow(/--names A,B .*--book X, --split dev\|test, or --all/);
  });

  it('takes names (repeated, comma separated or bare), a book, a split, and --all, as filters', async () => {
    addNew(...NAMES);
    splits({ alpha60: 'dev', beta61: 'test' });
    const names = async (...argv) => (await json(...argv)).plans.map((p) => p.name);
    expect(await names('--all')).toEqual(NAMES);
    expect(await names('--names', 'alpha60-n1,beta61-n3')).toEqual(['alpha60-n1', 'beta61-n3']);
    expect(await names('--names', 'alpha60-n2', '--names', 'beta61-n3')).toEqual(['alpha60-n2', 'beta61-n3']);
    expect(await names('beta61-n3')).toEqual(['beta61-n3']);
    expect(await names('--book', 'alpha60')).toEqual(['alpha60-n1', 'alpha60-n2']);
    expect(await names('--split', 'test')).toEqual(['beta61-n3']);
    expect(await names('--split', 'dev', '--names', 'alpha60-n1,beta61-n3')).toEqual(['alpha60-n1']);
    expect(await names('--split', 'dev', '--book', 'alpha60')).toEqual(['alpha60-n1', 'alpha60-n2']);
  });

  it('says which name, book or split is wrong', async () => {
    addNew(...NAMES);
    await expect(set.run(status, '--names', 'nosuch1-n1')).rejects.toThrow(/no plan named nosuch1-n1/);
    await expect(set.run(status, '--book', 'gamma')).rejects.toThrow(/no plan in book gamma \(books here: alpha60, beta61\)/);
    await expect(set.run(status, '--split', 'dev')).rejects.toThrow(/--split needs orchestration\/manifest\.json or splits\.json/);
    splits({ alpha60: 'dev', beta61: 'test' });
    await expect(set.run(status, '--split', 'prod')).rejects.toThrow(UsageError);
    await expect(set.run(status, '--split', 'dev', '--book', 'beta61')).rejects.toThrow(/no plan in book beta61/);
    await expect(set.run(status, '--names', '../x')).rejects.toThrow(/not a plan name/);
  });

  it('finds a book by the name it was logged under, and a plan\'s split from the manifest before splits.json', async () => {
    addNew('pacific25-n41', 'pacific25-n42');
    writeLog(set, [planEvent('pacific25-n41', { book: 'Pacific 1925', year: 1925, decade: 1920 }), planEvent('pacific25-n42', { book: 'Pacific 1925', year: 1925, decade: 1920 })]);
    expect((await json('--book', 'Pacific 1925')).plans.map((p) => p.name)).toEqual(['pacific25-n41', 'pacific25-n42']);
    splits({ pacific25: 'dev' });
    set.write('orchestration/manifest.json', JSON.stringify({
      version: 1, plans: { 'pacific25-n41': { book: 'pacific25', split: 'test', era: 'vintage' } },
    }));
    const rows = (await json('--all')).plans;
    expect(rows.map((r) => [r.name, r.split])).toEqual([['pacific25-n41', 'test'], ['pacific25-n42', 'dev']]);
  });
});

describe('packets', () => {
  it('writes the blind packet of each plan, says so in one line, and can run again', async () => {
    addNew(...NAMES);
    const first = await set.run(packets, '--all');
    expect(first.code).toBe(0);
    expect(rowOf(first.out, 'alpha60-n1')).toMatch(/image 460x300, 2 labels \(1 room, 1 nonGla, 0 level\)/);
    expect(first.out).toMatch(/3 packets written/);
    for (const n of NAMES) expect(fs.readdirSync(path.join(set.dir, 'keys-wip', 'packets', n)).sort()).toEqual(['image.png', 'labels.json', 'meta.json']);
    const before = fs.readFileSync(path.join(set.dir, 'keys-wip', 'packets', 'alpha60-n1', 'labels.json'), 'utf8');
    await set.run(packets, '--names', 'alpha60-n1');
    expect(fs.readFileSync(path.join(set.dir, 'keys-wip', 'packets', 'alpha60-n1', 'labels.json'), 'utf8')).toBe(before);
    // The plan is not touched, and the packet says nothing of the trace.
    expect(before).not.toMatch(/perimeterTraces|confidence|feetPerPixel/);
  });

  it('reports a plan it could not read, and carries on', async () => {
    addNew('alpha60-n1');
    fs.writeFileSync(set.planFile('alpha60-n2'), '{ not json');
    const r = await set.run(packets, '--all');
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/alpha60-n2 +ERROR .*not valid JSON/);
    expect(r.out).toMatch(/1 packet written, 1 failed/);
    expect(fs.existsSync(path.join(set.dir, 'keys-wip', 'packets', 'alpha60-n1', 'meta.json'))).toBe(true);
  });
});

describe('import-existing', () => {
  const planBytes = (n) => fs.readFileSync(set.planFile(n), 'utf8');

  it('makes annotation A of a plan\'s stored draft key, and leaves the plan alone', async () => {
    set.addPlan('alpha60-n1', draftPlan('alpha60-n1'));
    const before = planBytes('alpha60-n1');
    const r = await set.run(importExisting, '--names', 'alpha60-n1');
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/alpha60-n1 +written +2 outline\(s\), 460x300/);
    expect(planBytes('alpha60-n1')).toBe(before);
    const spec = set.readJson(set.wip('alpha60-n1', '.a.json'));
    expect(spec).toMatchObject({ author: 'existing-draft', existingDraft: true });
    expect(spec.notes).toMatch(/attached garage/);
    expect(spec.outlines.map((o) => [o.type, o.v, o.fix])).toEqual([
      ['gla', HOUSE, [0, 1, 2, 3]],
      ['garage', GARAGE, [0, 1, 2, 3]],
    ]);
    expect(spec.outlines[0].name).toBe('first floor');
    const snapped = set.readJson(set.wip('alpha60-n1', '.a.snapped.json'));
    expect(snapped).toMatchObject({
      name: 'alpha60-n1', role: 'a', author: 'existing-draft', image: { width: 460, height: 300 }, flagged: [],
    });
    expect(snapped.outlines).toEqual([{ type: 'gla', v: HOUSE }, { type: 'garage', v: GARAGE }]);
  });

  it('writes a spec the key tool itself accepts: check --role a runs on it', async () => {
    set.addPlan('alpha60-n1', draftPlan('alpha60-n1'));
    await set.run(importExisting, '--names', 'alpha60-n1');
    const { out } = await set.run(check, 'alpha60-n1', '--role', 'a');
    expect(out).toMatch(/CHECK PASS$/);
    // And snap takes the same spec back (it names no unknown key).
    const again = await set.run(snap, 'alpha60-n1', '--role', 'b', '--spec', set.wip('alpha60-n1', '.a.json'));
    expect(again.code).toBe(0);
  });

  it('can be run again: unchanged, and a plan with no draft key is skipped when reached in bulk', async () => {
    set.addPlan('alpha60-n1', draftPlan('alpha60-n1'));
    addNew('beta61-n3');
    const first = await set.run(importExisting, '--all-existing');
    expect(rowOf(first.out, 'alpha60-n1')).toMatch(/written/);
    expect(rowOf(first.out, 'beta61-n3')).toMatch(/skip +no key yet/);
    expect(first.code).toBe(0);
    expect(first.out).toMatch(/1 written, 0 updated, 0 unchanged, 1 skipped, 0 refused, 0 errors/);
    const mtime = fs.statSync(set.wip('alpha60-n1', '.a.snapped.json')).mtimeMs;
    const second = await set.run(importExisting, '--all-existing');
    expect(rowOf(second.out, 'alpha60-n1')).toMatch(/unchanged/);
    expect(fs.statSync(set.wip('alpha60-n1', '.a.snapped.json')).mtimeMs).toBe(mtime);
  });

  it('refuses a plan named that is not a draft, and a key that is already checked', async () => {
    addNew('beta61-n3');
    const checked = draftPlan('alpha60-n1');
    checked.answerKey = { ...checked.answerKey, by: 'annotators: a, b; adjudicator: none', checked: { by: 'AI review', at: 'then', via: 'final review' } };
    set.addPlan('alpha60-n1', checked);
    const named = await set.run(importExisting, '--names', 'beta61-n3');
    expect(named.code).toBe(1);
    expect(named.out).toMatch(/beta61-n3 +REFUSED +no key yet/);
    // Checked is refused however the plan was reached.
    for (const argv of [['--names', 'alpha60-n1'], ['--all']]) {
      const r = await set.run(importExisting, ...argv);
      expect(r.code).toBe(1);
      expect(rowOf(r.out, 'alpha60-n1')).toMatch(/REFUSED +the key is already checked \(AI review, then\)/);
    }
    expect(fs.existsSync(set.wip('alpha60-n1', '.a.json'))).toBe(false);
  });

  it('will not replace an annotator\'s own A, and refreshes its own', async () => {
    set.addPlan('alpha60-n1', draftPlan('alpha60-n1'));
    await annotate('alpha60-n1', 'a', 'a-someone');
    const r = await set.run(importExisting, '--names', 'alpha60-n1');
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/REFUSED +annotation A was already written by "a-someone"/);
    expect(set.readJson(set.wip('alpha60-n1', '.a.json')).author).toBe('a-someone');
  });

  it('refuses a key with holes, which a spec cannot hold', async () => {
    const project = newPlan('alpha60-n1');
    const { applyPlan } = await import('../realKeys.mjs');
    applyPlan(project, [{ type: 'gla', points: HOUSE, holes: [[[150, 120], [200, 120], [200, 160]]] }], { by: 'Claude (draft for review)', at: 'x', notes: 'n' }, { force: true });
    set.addPlan('alpha60-n1', project);
    const r = await set.run(importExisting, '--names', 'alpha60-n1');
    expect(r.out).toMatch(/ERROR .*has holes/);
    expect(r.code).toBe(1);
  });

  it('needs a selector', async () => {
    await expect(set.run(importExisting)).rejects.toThrow(UsageError);
  });
});

describe('compare-all', () => {
  it('compares every plan with both keys, prints one line each and the tally, and keeps fresh comparisons', async () => {
    addNew('alpha60-n1', 'alpha60-n2', 'beta61-n3');
    await annotate('alpha60-n1', 'a', 'a-1');
    await annotate('alpha60-n1', 'b', 'b-1', 2);
    // n2 disagrees: B fixed its left edge 10 px outside the wall.
    await annotate('alpha60-n2', 'a', 'a-2');
    const off = specOf('b-2');
    off.outlines[0].v = [[90, 77], [303, 77], [303, 223], [90, 223]];
    off.outlines[0].fix = [3];
    await set.run(snap, 'alpha60-n2', '--role', 'b', '--spec', set.writeSpec('n2.b.json', off));
    // beta61-n3 has only an A.
    await annotate('beta61-n3', 'a', 'a-3');
    const r = await set.run(compareAll, '--all');
    expect(r.code).toBe(0);
    // The smallest per-type IoU (the garage's, which shares the house's wall) and the worst boundary distance.
    expect(rowOf(r.out, 'alpha60-n1')).toMatch(/alpha60-n1 +agree +(99\.\d\d|100\.00)% +[0-3]\.\d\d/);
    expect(rowOf(r.out, 'alpha60-n2')).toMatch(/alpha60-n2 +DISAGREE .*(building|distance)/);
    expect(rowOf(r.out, 'beta61-n3')).toBeUndefined();
    expect(r.out).toMatch(/2 compared, 1 agree \(50\.0%\), 1 DISAGREE/);
    expect(r.out).toMatch(/failed: types 0, building IoU \d, non-GLA IoU \d, distance 1/);
    expect(r.out).toMatch(/1 plan without both A and B snapped, not compared/);
    const record = set.readJson(set.wip('alpha60-n1', '.compare.json'));
    expect(record.agree).toBe(true);
    // A second run keeps what is fresh.
    const again = await set.run(compareAll, '--all');
    expect(again.out.split('\n').filter((l) => l.includes('(kept)'))).toHaveLength(2);
  });

  it('recomputes a comparison older than a key it compared, and on --redo', async () => {
    addNew('alpha60-n1');
    await annotate('alpha60-n1', 'a', 'a-1');
    await annotate('alpha60-n1', 'b', 'b-1');
    await set.run(compareAll, '--all');
    const file = set.wip('alpha60-n1', '.compare.json');
    const stamp = new Date(Date.now() - 60000);
    fs.utimesSync(file, stamp, stamp);
    const stale = await set.run(compareAll, '--all');
    expect(stale.out).not.toMatch(/\(kept\)/);
    expect(fs.statSync(file).mtimeMs).toBeGreaterThan(stamp.getTime() + 1000);
    expect((await set.run(compareAll, '--all')).out).toMatch(/\(kept\)/);
    expect((await set.run(compareAll, '--all', '--redo')).out).not.toMatch(/\(kept\)/);
  });

  it('says so when nothing has both keys', async () => {
    addNew('alpha60-n1');
    const r = await set.run(compareAll, '--all');
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/0 compared, 0 agree \(n\/a\), 0 DISAGREE/);
  });

  it('counts each criterion a plan fails, and names the failed ones per plan', async () => {
    addNew('alpha60-n1');
    await annotate('alpha60-n1', 'a', 'a-1');
    // B calls the garage a porch: the types differ, and so does the porch/garage IoU.
    const b = specOf('b-1');
    b.outlines[1].type = 'porch';
    await set.run(snap, 'alpha60-n1', '--role', 'b', '--spec', set.writeSpec('b.json', b));
    const r = await set.run(compareAll, '--all');
    expect(rowOf(r.out, 'alpha60-n1')).toMatch(/DISAGREE .*types/);
    expect(r.out).toMatch(/failed: types 1,/);
  });
});

describe('status, stage by stage', () => {
  it('follows a plan from no work to a frozen key', async () => {
    addNew('alpha60-n1', 'alpha60-n2');
    splits({ alpha60: 'dev' });
    const st = async () => (await json('--names', 'alpha60-n1')).plans[0];
    expect(await st()).toMatchObject({
      packet: 'none', a: { state: 'none' }, b: { state: 'none' }, compare: { state: 'none' }, final: false, check: { state: 'none' }, review: { state: 'none', rounds: 0 }, frozen: 'no', split: 'dev', book: 'alpha60',
    });
    await set.run(packets, '--names', 'alpha60-n1');
    await annotate('alpha60-n1', 'a', 'a-1');
    expect(await st()).toMatchObject({ packet: 'ok', a: { state: 'ok', author: 'a-1' }, b: { state: 'none' } });
    await annotate('alpha60-n1', 'b', 'b-1', 1);
    await set.run(compareAll, '--names', 'alpha60-n1');
    expect(await st()).toMatchObject({ b: { state: 'ok' }, compare: { state: 'agree', failed: [] } });
    await set.run(finalizeAgreed, '--names', 'alpha60-n1');
    expect(await st()).toMatchObject({ final: true, check: { state: 'PASS' }, review: { state: 'none' } });
    await set.run(review, 'alpha60-n1', '--reject', '--agent', 'rev-1', '--reason', 'the porch is missing');
    expect(await st()).toMatchObject({ review: { state: 'rejected', rounds: 1, rejections: 1 } });
    // The adjudicator changes the key after the rejection: it needs a fresh review.
    await set.run(snap, 'alpha60-n1', '--role', 'final', '--spec', set.writeSpec('f.json', specOf('adj-1', 0, { notes: 'Revised.' })));
    expect(await st()).toMatchObject({ review: { state: 'revised', rounds: 1 } });
    await set.run(review, 'alpha60-n1', '--approve', '--agent', 'rev-2');
    expect(await st()).toMatchObject({ review: { state: 'approved', rounds: 2, rejections: 1 }, frozen: 'no' });
    // A later change to the key or its notes makes the approval stale.
    await set.run(snap, 'alpha60-n1', '--role', 'final', '--spec', set.writeSpec('f2.json', specOf('adj-1', 0, { notes: 'Changed after approval.' })));
    expect(await st()).toMatchObject({ review: { state: 'approved-STALE', rounds: 2 } });
  });

  it('prints the table and one line per stage, and counts', async () => {
    set.addPlan('alpha60-n1', draftPlan('alpha60-n1'));
    addNew('alpha60-n2');
    await set.run(importExisting, '--all-existing');
    await set.run(packets, '--all');
    await annotate('alpha60-n2', 'a', 'a-2');
    const { out, code } = await set.run(status, '--all');
    expect(code).toBe(0);
    expect(out).toMatch(/^plan +split +packet +A +B +compare +final +check +review +rnd +frozen$/m);
    expect(rowOf(out, 'alpha60-n1')).toMatch(/alpha60-n1 +- +ok +existing +- +- +- +- +- +- +draft$/);
    expect(rowOf(out, 'alpha60-n2')).toMatch(/alpha60-n2 +- +ok +ok +- +- +- +- +- +- +-$/);
    expect(out).toMatch(/^packet +2 +2 +0 stale$/m);
    expect(out).toMatch(/^A +2 +2 +1 existing draft, 0 not snapped$/m);
    expect(out).toMatch(/^frozen +0 +2 +1 hold an unchecked draft key$/m);
  });

  it('says a packet is STALE when the plan\'s image is not the one it holds', async () => {
    addNew('alpha60-n1');
    await set.run(packets, '--all');
    const project = set.readPlan('alpha60-n1');
    project.images['img-1'] = project.images['img-1'].replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'));
    set.writePlan('alpha60-n1', project);
    expect((await json('--all')).plans[0].packet).toBe('STALE');
  });

  it('marks a comparison stale once a key it compared is drawn again', async () => {
    addNew('alpha60-n1');
    await annotate('alpha60-n1', 'a', 'a-1');
    await annotate('alpha60-n1', 'b', 'b-1');
    await set.run(compareAll, '--all');
    const file = set.wip('alpha60-n1', '.compare.json');
    const old = new Date(Date.now() - 60000);
    fs.utimesSync(file, old, old);
    expect((await json('--all')).plans[0].compare.state).toBe('stale');
  });

  it('caches the check under a fingerprint of what it reads, and --no-check runs none', async () => {
    addNew('alpha60-n1');
    splits({ alpha60: 'dev' });
    await annotate('alpha60-n1', 'a', 'a-1');
    await set.run(snap, 'alpha60-n1', '--role', 'final', '--spec', set.writeSpec('f.json', specOf('a-1')));
    expect((await json('--all', '--no-check')).plans[0].check).toEqual({ state: 'unknown' });
    expect(fs.existsSync(set.wip('alpha60-n1', '.check.json'))).toBe(false);
    expect((await json('--all')).plans[0].check).toMatchObject({ state: 'PASS' });
    const cache = set.readJson(set.wip('alpha60-n1', '.check.json'));
    expect(cache).toMatchObject({ pass: true, failures: 0 });
    const stamp = fs.statSync(set.wip('alpha60-n1', '.check.json')).mtimeMs;
    expect((await json('--all')).plans[0].check).toMatchObject({ state: 'PASS' });
    expect(fs.statSync(set.wip('alpha60-n1', '.check.json')).mtimeMs).toBe(stamp);
    // The key changes (its garage becomes a second house): the old answer is not reused.
    const broken = specOf('a-1');
    broken.outlines[1].type = 'gla';
    await set.run(snap, 'alpha60-n1', '--role', 'final', '--spec', set.writeSpec('f3.json', broken));
    const old = (await json('--all', '--no-check')).plans[0].check;
    expect(old).toMatchObject({ state: 'PASS', stale: true });
    expect((await json('--all')).plans[0].check).toMatchObject({ state: 'FAIL', failures: 1 });
    expect((await json('--all', '--recheck')).plans[0].check).toMatchObject({ state: 'FAIL' });
  });

  it('reports a plan it cannot read as an error row, and exits 1', async () => {
    addNew('alpha60-n1');
    fs.writeFileSync(set.planFile('alpha60-n2'), '{ nope');
    const r = await set.run(status, '--all');
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/ERROR alpha60-n2: .*not valid JSON/);
    expect(rowOf(r.out, 'alpha60-n1')).toBeDefined();
    await expect(set.run(status, '--all', '--no-check', '--recheck')).rejects.toThrow(UsageError);
  });

  it('reads 400 plans without a check per plan', async () => {
    const project = JSON.stringify(newPlan('x'));
    for (let i = 0; i < 400; i += 1) fs.writeFileSync(set.planFile(`bulk60-n${i}`), project);
    const t0 = Date.now();
    const { out } = await set.run(status, '--all');
    expect(out).toMatch(/^packet +0 +400/m);
    expect(Date.now() - t0).toBeLessThan(15000);
  });
});

describe('finalize-agreed', () => {
  const bothAgree = async (name = 'alpha60-n1', a = 'a-1', b = 'b-1') => {
    await annotate(name, 'a', a);
    await annotate(name, 'b', b, 2);
    await set.run(compareAll, '--names', name);
  };

  it('writes the final key as a copy of A, the record with the agreement figures, and checks it', async () => {
    addNew('alpha60-n1');
    await bothAgree();
    const r = await set.run(finalizeAgreed, '--all');
    expect(r.code).toBe(0);
    expect(rowOf(r.out, 'alpha60-n1')).toMatch(/alpha60-n1 +written +PASS/);
    expect(r.out).toMatch(/1 finalized from A \(1 PASS\), 0 need the adjudicator, 0 refused or failed/);
    expect(fs.readFileSync(set.wip('alpha60-n1', '.final.json'), 'utf8')).toBe(fs.readFileSync(set.wip('alpha60-n1', '.a.json'), 'utf8'));
    const a = set.readJson(set.wip('alpha60-n1', '.a.snapped.json'));
    const final = set.readJson(set.wip('alpha60-n1', '.final.snapped.json'));
    expect(final).toMatchObject({ role: 'final', copiedFrom: 'a', outlines: a.outlines, image: a.image });
    const record = set.readJson(set.wip('alpha60-n1', '.record.json'));
    expect(record).toMatchObject({ annotators: ['a-1', 'b-1'], adjudicator: null, verifiedBy: 'blind double annotation' });
    expect(record.agreement).toMatchObject({ agree: true });
    expect(record.agreement.iou.building).toBeGreaterThan(0.99);
    expect(record.agreement.boundary.max).toBeLessThanOrEqual(3);
    expect(record.agreement.iou.byType).toHaveProperty('garage');
  });

  it('does nothing twice: a plan that has a final is skipped', async () => {
    addNew('alpha60-n1');
    await bothAgree();
    await set.run(finalizeAgreed, '--all');
    const stamp = fs.statSync(set.wip('alpha60-n1', '.final.snapped.json')).mtimeMs;
    const again = await set.run(finalizeAgreed, '--all');
    expect(again.out).toMatch(/0 finalized from A/);
    expect(again.out).toMatch(/skipped: 1 already have a final/);
    expect(fs.statSync(set.wip('alpha60-n1', '.final.snapped.json')).mtimeMs).toBe(stamp);
    expect(again.code).toBe(0);
  });

  it('writes the record first and the snapped final last: a run that died half way is done again, never a final with no record', async () => {
    addNew('alpha60-n1');
    await bothAgree();
    await set.run(finalizeAgreed, '--all');
    // As if the run had died after the record and the spec, before the snapped file.
    fs.rmSync(set.wip('alpha60-n1', '.final.snapped.json'));
    expect(fs.existsSync(set.wip('alpha60-n1', '.record.json'))).toBe(true);
    const again = await set.run(finalizeAgreed, '--all');
    expect(rowOf(again.out, 'alpha60-n1')).toMatch(/written +PASS/);
    expect(fs.existsSync(set.wip('alpha60-n1', '.final.snapped.json'))).toBe(true);
  });

  it('leaves a disagreement to the adjudicator, and skips what is not ready, saying why', async () => {
    addNew('alpha60-n1', 'alpha60-n2', 'beta61-n3', 'beta61-n4');
    await annotate('alpha60-n1', 'a', 'a-1');
    const b = specOf('b-1');
    b.outlines[1].type = 'porch';
    await set.run(snap, 'alpha60-n1', '--role', 'b', '--spec', set.writeSpec('b.json', b));
    await set.run(compareAll, '--all');
    await annotate('alpha60-n2', 'a', 'a-2');
    await annotate('beta61-n3', 'a', 'a-3');
    await annotate('beta61-n3', 'b', 'b-3');
    const r = await set.run(finalizeAgreed, '--all');
    expect(rowOf(r.out, 'alpha60-n1')).toMatch(/DISAGREE +needs the adjudicator +needs adjudication/);
    expect(r.out).toMatch(/0 finalized from A .*, 1 need the adjudicator/);
    expect(r.out).toMatch(/skipped: 1 not compared yet \(run compare-all\); 2 without both A and B/);
    expect(r.code).toBe(1);
    expect(fs.existsSync(set.wip('alpha60-n1', '.final.snapped.json'))).toBe(false);
  });

  it('refuses one annotator posing as two, and a spec that names no author', async () => {
    addNew('alpha60-n1', 'alpha60-n2');
    await bothAgree('alpha60-n1', 'same-agent', 'same-agent');
    const anon = specOf('x');
    delete anon.author;
    await annotate('alpha60-n2', 'a', 'a-2');
    await set.run(snap, 'alpha60-n2', '--role', 'b', '--spec', set.writeSpec('anon.json', anon));
    await set.run(compareAll, '--names', 'alpha60-n2');
    const r = await set.run(finalizeAgreed, '--all');
    expect(rowOf(r.out, 'alpha60-n1')).toMatch(/REFUSED +A and B are both by "same-agent"/);
    expect(rowOf(r.out, 'alpha60-n2')).toMatch(/REFUSED +B's spec names no author/);
    expect(r.code).toBe(1);
    expect(fs.existsSync(set.wip('alpha60-n1', '.final.snapped.json'))).toBe(false);
    expect(fs.existsSync(set.wip('alpha60-n1', '.record.json'))).toBe(false);
  });

  it('refuses a stale comparison, and marks a final that fails its check as needing the adjudicator (keeping the final)', async () => {
    addNew('alpha60-n1', 'alpha60-n2');
    await bothAgree('alpha60-n1');
    const old = new Date(Date.now() - 60000);
    fs.utimesSync(set.wip('alpha60-n1', '.compare.json'), old, old);
    // Both annotators called the garage a second house: they agree, and the garage label is in the wrong outline.
    for (const [role, author] of [['a', 'a-2'], ['b', 'b-2']]) {
      const spec = specOf(author, role === 'b' ? 1 : 0);
      spec.outlines[1].type = 'gla';
      await set.run(snap, 'alpha60-n2', '--role', role, '--spec', set.writeSpec(`${role}.json`, spec));
    }
    await set.run(compareAll, '--names', 'alpha60-n2');
    const r = await set.run(finalizeAgreed, '--all');
    expect(r.out).toMatch(/skipped: 1 with a stale comparison/);
    expect(rowOf(r.out, 'alpha60-n2')).toMatch(/alpha60-n2 +written +FAIL labels e0.* +needs adjudication/);
    expect(r.out).toMatch(/1 finalized from A \(0 PASS\), 1 need the adjudicator/);
    expect(r.code).toBe(1);
    expect(fs.existsSync(set.wip('alpha60-n2', '.final.snapped.json'))).toBe(true);
    expect(fs.existsSync(set.wip('alpha60-n2', '.record.json'))).toBe(true);
  });

  it('finalizes the imported existing draft against an independent B', async () => {
    set.addPlan('alpha60-n1', draftPlan('alpha60-n1'));
    await set.run(importExisting, '--names', 'alpha60-n1');
    await annotate('alpha60-n1', 'b', 'b-1', 2);
    await set.run(compareAll, '--all');
    const r = await set.run(finalizeAgreed, '--all');
    expect(rowOf(r.out, 'alpha60-n1')).toMatch(/written +PASS/);
    expect(set.readJson(set.wip('alpha60-n1', '.record.json')).annotators).toEqual(['existing-draft', 'b-1']);
    expect(set.readJson(set.wip('alpha60-n1', '.final.json')).notes).toMatch(/attached garage/);
    // The plan is untouched until the freeze.
    expect(set.readPlan('alpha60-n1').answerKey.by).toBe('Claude (draft for review)');
  });
});

describe('finalize-single', () => {
  it('finalizes a dev plan that has only an A, as a single annotation', async () => {
    addNew('alpha60-n1');
    splits({ alpha60: 'dev' });
    await annotate('alpha60-n1', 'a', 'a-1');
    const r = await set.run(finalizeSingle, '--all');
    expect(r.code).toBe(0);
    expect(rowOf(r.out, 'alpha60-n1')).toMatch(/written +PASS/);
    expect(set.readJson(set.wip('alpha60-n1', '.record.json'))).toEqual({ annotators: ['a-1'], adjudicator: null, verifiedBy: 'single annotation' });
    expect(set.readJson(set.wip('alpha60-n1', '.final.snapped.json')).role).toBe('final');
    const again = await set.run(finalizeSingle, '--all');
    expect(again.out).toMatch(/skipped: 1 already have a final/);
  });

  it('refuses a test plan, a plan with no split, and the existing draft as A', async () => {
    addNew('alpha60-n1', 'beta61-n3', 'gamma62-n5');
    set.addPlan('delta63-n7', draftPlan('delta63-n7'));
    splits({ alpha60: 'test', delta63: 'dev' });
    for (const n of ['alpha60-n1', 'beta61-n3', 'gamma62-n5']) await annotate(n, 'a', 'a-1');
    await set.run(importExisting, '--names', 'delta63-n7');
    const r = await set.run(finalizeSingle, '--all');
    expect(rowOf(r.out, 'alpha60-n1')).toMatch(/REFUSED +single annotation is for the dev split; this plan's split is test \(every test plan gets a B\)/);
    expect(rowOf(r.out, 'beta61-n3')).toMatch(/REFUSED .*split is not assigned/);
    expect(rowOf(r.out, 'delta63-n7')).toMatch(/REFUSED +annotation A is the existing draft/);
    expect(r.code).toBe(1);
    for (const n of ['alpha60-n1', 'beta61-n3', 'gamma62-n5', 'delta63-n7']) expect(fs.existsSync(set.wip(n, '.final.snapped.json'))).toBe(false);
  });

  it('leaves a plan that has a B to compare-all', async () => {
    addNew('alpha60-n1');
    splits({ alpha60: 'dev' });
    await annotate('alpha60-n1', 'a', 'a-1');
    await annotate('alpha60-n1', 'b', 'b-1');
    const r = await set.run(finalizeSingle, '--all');
    expect(r.out).toMatch(/skipped: 1 with a B/);
    expect(fs.existsSync(set.wip('alpha60-n1', '.final.snapped.json'))).toBe(false);
  });
});

describe('adjudicated', () => {
  const disagree = async () => {
    addNew('alpha60-n1');
    await annotate('alpha60-n1', 'a', 'a-1');
    const b = specOf('b-1');
    b.outlines[1].type = 'porch';
    await set.run(snap, 'alpha60-n1', '--role', 'b', '--spec', set.writeSpec('b.json', b));
    await set.run(compareAll, '--all');
    await set.run(snap, 'alpha60-n1', '--role', 'final', '--spec', set.writeSpec('final.json', specOf('adj-1', 0, { notes: 'The right part is a garage: a door in its bottom wall.' })));
  };

  it('writes the record from the specs\' authors, the adjudicator and the comparison, and checks the final key', async () => {
    await disagree();
    const r = await set.run(adjudicated, 'alpha60-n1', '--adjudicator', 'adj-1');
    expect(r.code).toBe(0);
    expect(rowOf(r.out, 'alpha60-n1')).toMatch(/alpha60-n1 +written +PASS/);
    const record = set.readJson(set.wip('alpha60-n1', '.record.json'));
    expect(record).toMatchObject({
      annotators: ['a-1', 'b-1'], adjudicator: 'adj-1', verifiedBy: 'blind double annotation', adjudicated: true,
    });
    expect(record.agreement).toMatchObject({ agree: false });
  });

  it('refuses an adjudicator who drew A or B, a missing final key, and a missing tag', async () => {
    await disagree();
    await expect(set.run(adjudicated, 'alpha60-n1', '--adjudicator', 'b-1')).rejects.toThrow(/drew alpha60-n1's annotation B: an adjudicator is a fresh agent/);
    await expect(set.run(adjudicated, 'alpha60-n1')).rejects.toThrow(UsageError);
    await expect(set.run(adjudicated, '--adjudicator', 'x')).rejects.toThrow(UsageError);
    await expect(set.run(adjudicated, '../alpha60-n1', '--adjudicator', 'x')).rejects.toThrow(/not a plan name/);
    addNew('beta61-n3');
    await expect(set.run(adjudicated, 'beta61-n3', '--adjudicator', 'adj-1')).rejects.toThrow(/beta61-n3\.final\.snapped\.json does not exist/);
    expect(fs.existsSync(set.wip('alpha60-n1', '.record.json'))).toBe(false);
  });

  it('needs both annotators\' authors, and says when the final spec is by someone else', async () => {
    await disagree();
    const spec = set.readJson(set.wip('alpha60-n1', '.b.json'));
    delete spec.author;
    fs.writeFileSync(set.wip('alpha60-n1', '.b.json'), JSON.stringify(spec));
    await expect(set.run(adjudicated, 'alpha60-n1', '--adjudicator', 'adj-1')).rejects.toThrow(/B's spec is missing or names no author/);
    spec.author = 'b-1';
    fs.writeFileSync(set.wip('alpha60-n1', '.b.json'), JSON.stringify(spec));
    const r = await set.run(adjudicated, 'alpha60-n1', '--adjudicator', 'adj-2');
    expect(r.out).toMatch(/note: the final spec's author is "adj-1", not "adj-2"/);
  });

  it('reports a final key that fails its check, and exits 1', async () => {
    addNew('alpha60-n1');
    await annotate('alpha60-n1', 'a', 'a-1');
    await annotate('alpha60-n1', 'b', 'b-1');
    const bad = specOf('adj-1');
    bad.outlines[1].type = 'gla';
    await set.run(snap, 'alpha60-n1', '--role', 'final', '--spec', set.writeSpec('bad.json', bad));
    const r = await set.run(adjudicated, 'alpha60-n1', '--adjudicator', 'adj-1');
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/FAIL labels e0.* +needs adjudication/);
  });
});

describe('sample', () => {
  beforeEach(() => {
    for (let i = 1; i <= 20; i += 1) set.addPlan(`alpha60-n${i}`, newPlan(`alpha60-n${i}`, { source: { url: 'https://archive.org/x', crop: [0, 0, 460, 300], size: [460, 300] } }));
    splits({ alpha60: 'dev' });
  });

  it('draws the same plans for the same seed, whatever order the folder lists them in, and other plans for another', async () => {
    const one = await set.run(sample, '--split', 'dev', '--fraction', '0.3', '--seed', '7');
    expect(one.lines[0]).toBe('seed 7: 6 plans of 20 (30.0%, fraction 0.3)');
    const names = one.lines[1].split(',');
    expect(names).toHaveLength(6);
    expect([...names].sort()).toEqual(names);
    expect((await set.run(sample, '--split', 'dev', '--fraction', '0.3', '--seed', '7')).lines[1]).toBe(one.lines[1]);
    expect((await set.run(sample, '--split', 'dev', '--fraction', '0.3', '--seed', '8')).lines[1]).not.toBe(one.lines[1]);
    // Renaming the folder's entries (a different listing order) changes nothing: the pool is sorted first.
    fs.renameSync(set.planFile('alpha60-n1'), set.planFile('alpha60-n01'));
    fs.renameSync(set.planFile('alpha60-n01'), set.planFile('alpha60-n1'));
    expect((await set.run(sample, '--split', 'dev', '--fraction', '0.3', '--seed', '7')).lines[1]).toBe(one.lines[1]);
    // It wrote nothing.
    expect(fs.existsSync(path.join(set.dir, 'keys-wip'))).toBe(false);
  });

  it('is a fixed sample: the draw for a given seed does not drift (it is what an auditor re-draws)', async () => {
    const r = await set.run(sample, '--all', '--fraction', '0.25', '--seed', '20260929');
    expect(r.lines[1]).toBe('alpha60-n1,alpha60-n19,alpha60-n2,alpha60-n5,alpha60-n8');
  });

  it('leaves out the plans of the set that predate the sourcing log with --exclude-existing', async () => {
    for (let i = 1; i <= 10; i += 1) set.addPlan(`old60-n${i}`, newPlan(`old60-n${i}`));
    splits({ alpha60: 'dev', old60: 'dev' });
    const r = await set.run(sample, '--split', 'dev', '--fraction', '0.5', '--seed', '3', '--exclude-existing');
    expect(r.lines[0]).toMatch(/^seed 3: 10 plans of 20 .*; 10 existing plans left out$/);
    expect(r.lines[1]).not.toMatch(/old60/);
    // A plan whose A is the existing draft counts as existing, sourced or not.
    set.addPlan('alpha60-n1', draftPlan('alpha60-n1'));
    await set.run(importExisting, '--names', 'alpha60-n1');
    const again = await set.run(sample, '--split', 'dev', '--fraction', '1', '--seed', '3', '--exclude-existing');
    expect(again.lines[1].split(',')).toHaveLength(19);
    expect(again.lines[1]).not.toMatch(/alpha60-n1(,|$)/);
  });

  it('needs a seed, a fraction, and a selector, and takes at least one plan', async () => {
    await expect(set.run(sample, '--split', 'dev', '--fraction', '0.3')).rejects.toThrow(/needs --seed N/);
    await expect(set.run(sample, '--split', 'dev', '--seed', '1')).rejects.toThrow(/needs --fraction F/);
    await expect(set.run(sample, '--split', 'dev', '--fraction', '1.5', '--seed', '1')).rejects.toThrow(UsageError);
    await expect(set.run(sample, '--split', 'dev', '--fraction', '0.3', '--seed', '-1')).rejects.toThrow(UsageError);
    await expect(set.run(sample, '--fraction', '0.3', '--seed', '1')).rejects.toThrow(UsageError);
    expect((await set.run(sample, '--split', 'dev', '--fraction', '0.001', '--seed', '1')).lines[0]).toMatch(/^seed 1: 1 plan of 20/);
  });
});

describe('the key tool\'s own commands stay usable beside these', () => {
  it('compare on a plan the pipeline compared writes the same record', async () => {
    addNew('alpha60-n1');
    await annotate('alpha60-n1', 'a', 'a-1');
    await annotate('alpha60-n1', 'b', 'b-1');
    await set.run(compareAll, '--all');
    const viaPipeline = set.readJson(set.wip('alpha60-n1', '.compare.json'));
    await set.run(compare, 'alpha60-n1');
    const direct = set.readJson(set.wip('alpha60-n1', '.compare.json'));
    expect({ ...direct, at: 0 }).toEqual({ ...viaPipeline, at: 0 });
  });
});
