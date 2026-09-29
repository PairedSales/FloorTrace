// Building, versioning and verifying the manifest (scripts/lib/manifestBuild.mjs)
// on scratch sets of synthetic frozen plans: the file is a pure function of its
// inputs (same inputs, same bytes, same hash), only checked keys enter, every
// rule of `verify` can fail on its own, and the finished set's dataset rules
// hold on a set that meets them.
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildManifest, commitManifest, countsText, countsOf, entryFor, amendedManifest, logVersions, looksLikeAddress, verifyManifest,
} from '../manifestBuild.mjs';
import { keySha256, loadManifest, manifestFileFor, parseManifest, planSplit } from '../manifest.mjs';
import { keyOf } from '../realKeys.mjs';
import { assignSplitsCommand } from '../manifestCommands.mjs';
import {
  makeSet, newPlan, planEvent, writeLog,
} from './pipelineHarness.mjs';
import { CHECKED, finishedSet, frozenPlan } from './manifestFixtures.mjs';

const sets = [];
const track = (set) => {
  sets.push(set);
  return set;
};
afterEach(() => {
  while (sets.length) sets.pop().cleanup();
});

const splitsFile = (set, books, extra = {}) => set.write('orchestration/splits.json', JSON.stringify({
  seed: 42,
  createdAt: '2026-09-28T00:00:00.000Z',
  books: Object.fromEntries(Object.entries(books).map(([book, split]) => [book, {
    split, era: 'vintage', decade: 1960, publisher: null, plans: 1,
  }])),
  ...extra,
}));
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const status = (rules, id) => rules.find((r) => r.id === id);
const say = (rules) => rules.map((r) => `${r.status} ${r.id}: ${r.text}`).join('\n');

// A small set: two frozen plans of one book, one of another, and a plan nobody has checked.
const smallSet = () => {
  const set = track(makeSet());
  set.addPlan('alpha60-n1', frozenPlan('alpha60-n1'));
  set.addPlan('alpha60-n2', frozenPlan('alpha60-n2', { by: 'annotators: a-2, b-2; adjudicator: adj-2' }));
  set.addPlan('beta61-n3', frozenPlan('beta61-n3', { verifiedBy: 'single annotation', by: 'annotators: a-3; adjudicator: none' }));
  set.addPlan('gamma62-n4', newPlan('gamma62-n4'));
  splitsFile(set, { alpha60: 'dev', beta61: 'test', gamma62: 'dev' });
  return set;
};

describe('the manifest of a set', () => {
  it('holds every checked plan, with the fields bench:real reads and the ones the orchestrator asked for', () => {
    const set = smallSet();
    const built = buildManifest(set.dir);
    expect(built.unchecked).toEqual(['gamma62-n4']);
    expect(built.problems).toEqual([]);
    expect(Object.keys(built.manifest.plans)).toEqual(['alpha60-n1', 'alpha60-n2', 'beta61-n3']);
    const key = keyOf(set.readPlan('alpha60-n1').floors[0].state);
    expect(built.manifest).toMatchObject({ version: 1, seed: 42, createdAt: '2026-09-28T00:00:00.000Z' });
    expect(built.manifest.plans['alpha60-n1']).toEqual({
      book: 'alpha60',
      publisher: null,
      era: 'vintage',
      decade: 1960,
      year: 1960,
      split: 'dev',
      source: { embedded: true },
      keySha256: keySha256(key),
      annotation: {
        annotators: ['a-1', 'b-1'],
        adjudicator: null,
        adjudicated: false,
        agreement: null,
        verifiedBy: 'blind double annotation',
        checked: CHECKED,
      },
    });
    expect(built.manifest.plans['alpha60-n2'].annotation).toMatchObject({ annotators: ['a-2', 'b-2'], adjudicator: 'adj-2', adjudicated: true });
    expect(built.manifest.plans['beta61-n3']).toMatchObject({ split: 'test', annotation: { annotators: ['a-3'], verifiedBy: 'single annotation', adjudicated: false } });
    // The reader the benchmark uses takes it as it is.
    const parsed = parseManifest(built.text);
    expect(planSplit(parsed, 'beta61-n3')).toBe('test');
    expect(countsText(countsOf(built.manifest))).toBe('3 plans: dev 2 / test 1; vintage 3 / 2020-2022 0');
  });

  it('is a pure function of its inputs: the same plans, splits and log are the same bytes and the same hash, whenever built', async () => {
    const set = smallSet();
    const one = buildManifest(set.dir);
    await new Promise((resolve) => { setTimeout(resolve, 30); });
    const two = buildManifest(set.dir);
    expect(two.text).toBe(one.text);
    expect(two.hash).toBe(one.hash);
    expect(one.hash).toBe(sha(Buffer.from(one.text)));
    // Sorted keys at every depth, two-space indent, one trailing newline, nothing about when it was built.
    const keys = (o) => (o && typeof o === 'object' ? [Object.keys(o), ...Object.values(o).flatMap(keys)] : []);
    for (const list of keys(JSON.parse(one.text))) expect(list).toEqual([...list].sort());
    expect(one.text).toMatch(/^{\n {2}"createdAt"/);
    expect(one.text.endsWith('}\n')).toBe(true);
    expect(one.text).not.toMatch(new RegExp(String(new Date().getFullYear() + 1)));
    // Another split is another manifest.
    splitsFile(set, { alpha60: 'test', beta61: 'test', gamma62: 'dev' });
    expect(buildManifest(set.dir).hash).not.toBe(one.hash);
  });

  it('takes the source from the plan, else from the sourcing log, else says the image is embedded', () => {
    const set = track(makeSet());
    set.addPlan('own60-n1', frozenPlan('own60-n1', { source: { url: 'https://archive.org/download/x/page/n1', crop: [1, 2, 300, 200], size: [300, 200] } }));
    set.addPlan('logged60-n2', frozenPlan('logged60-n2'));
    set.addPlan('embedded60-n3', frozenPlan('embedded60-n3'));
    set.addPlan('file60-n4', frozenPlan('file60-n4', { source: { file: 'inbox/listing.png', crop: [0, 0, 10, 10], size: [10, 10] } }));
    writeLog(set, [planEvent('logged60-n2', { url: 'https://archive.org/download/y/page/n2', crop: [5, 6, 700, 500], size: [700, 500] })]);
    splitsFile(set, {
      own60: 'dev', logged60: 'dev', embedded60: 'dev', file60: 'dev',
    });
    const { manifest, warnings } = buildManifest(set.dir);
    expect(manifest.plans['own60-n1'].source).toEqual({ url: 'https://archive.org/download/x/page/n1', crop: [1, 2, 300, 200], size: [300, 200] });
    expect(manifest.plans['logged60-n2'].source).toEqual({ url: 'https://archive.org/download/y/page/n2', crop: [5, 6, 700, 500], size: [700, 500] });
    expect(manifest.plans['embedded60-n3'].source).toEqual({ embedded: true });
    expect(manifest.plans['file60-n4'].source).toEqual({ file: 'inbox/listing.png', crop: [0, 0, 10, 10], size: [10, 10] });
    expect(warnings).toEqual([]);
    // A plan that names another URL than the log has is recorded as the plan says, with a warning.
    set.addPlan('logged60-n2', frozenPlan('logged60-n2', { source: { url: 'https://archive.org/download/z/page/n2', crop: [5, 6, 700, 500], size: [700, 500] } }));
    const again = buildManifest(set.dir);
    expect(again.manifest.plans['logged60-n2'].source.url).toBe('https://archive.org/download/z/page/n2');
    expect(again.warnings.join('\n')).toMatch(/logged60-n2: the plan's own source .* is not the URL the log has/);
  });

  it('reads era, decade, publisher, site and book from the log: a designer code is the book, its site is kept', () => {
    const set = track(makeSet());
    set.addPlan('dg21-1', frozenPlan('dg21-1'));
    set.addPlan('dg21-2', frozenPlan('dg21-2'));
    set.addPlan('pacific25-n41', frozenPlan('pacific25-n41'));
    writeLog(set, [
      planEvent('dg21-1', { book: 'Design Group', era: '2020-2022', year: 2021, decade: 2020, unit: '940', site: 'design-group.example', publisher: 'Design Group', url: 'https://web.archive.org/web/20210101000000id_/https://x/a.png' }),
      planEvent('dg21-2', { book: 'Design Group', era: '2020-2022', year: 2022, decade: 2020, unit: '77', site: 'design-group.example', url: 'https://web.archive.org/web/20220101000000id_/https://x/b.png' }),
      planEvent('pacific25-n41', { book: 'Pacific 1925', publisher: 'Pacific Ready-Cut', year: 1925, decade: 1920 }),
    ]);
    splitsFile(set, { 940: 'dev', 77: 'test', pacific25: 'dev' });
    const { manifest } = buildManifest(set.dir);
    expect(manifest.plans['dg21-1']).toMatchObject({
      book: '940', site: 'design-group.example', publisher: 'Design Group', era: '2020-2022', decade: 2020, year: 2021, split: 'dev',
    });
    expect(manifest.plans['dg21-2']).toMatchObject({ book: '77', split: 'test', year: 2022 });
    expect(manifest.plans['pacific25-n41']).toMatchObject({ book: 'pacific25', publisher: 'Pacific Ready-Cut', era: 'vintage', decade: 1920 });
    expect(manifest.plans['pacific25-n41']).not.toHaveProperty('site');
  });

  it('warns when two sites use one designer code: one book in one split and under one cap', () => {
    const set = track(makeSet());
    set.addPlan('a21-1', frozenPlan('a21-1'));
    set.addPlan('b21-1', frozenPlan('b21-1'));
    const wb = 'https://web.archive.org/web/20210101000000id_/https://x/';
    writeLog(set, ['a', 'b'].map((k) => planEvent(`${k}21-1`, {
      book: `Site ${k}`, era: '2020-2022', year: 2021, decade: 2020, unit: '940', site: `${k}.example`, url: `${wb}${k}.png`,
    })));
    splitsFile(set, { 940: 'dev' });
    const { warnings } = buildManifest(set.dir);
    expect(warnings).toEqual([expect.stringMatching(/the designer code 940 is used by a\.example and b\.example: one book here/)]);
  });

  it('takes the agreement figures from the work files\' record, and the annotators from the plan\'s own record when they differ', () => {
    const set = smallSet();
    set.write('keys-wip/alpha60-n1.record.json', JSON.stringify({
      annotators: ['a-1', 'b-1'], adjudicator: null, verifiedBy: 'blind double annotation', agreement: { agree: true, iou: { building: 0.998 } },
    }));
    set.write('keys-wip/alpha60-n2.record.json', JSON.stringify({ annotators: ['someone', 'else'], adjudicator: null, verifiedBy: 'blind double annotation' }));
    const { manifest, warnings } = buildManifest(set.dir);
    expect(manifest.plans['alpha60-n1'].annotation.agreement).toEqual({ agree: true, iou: { building: 0.998 } });
    expect(manifest.plans['alpha60-n2'].annotation).toMatchObject({ annotators: ['a-2', 'b-2'], adjudicator: 'adj-2', agreement: null });
    expect(warnings).toEqual([expect.stringMatching(/^alpha60-n2: keys-wip record names \["someone","else"\]/)]);
  });

  it('records a dispute id, and falls back to the record file when the plan\'s own record is not in the form apply writes', () => {
    const set = track(makeSet());
    set.addPlan('alpha60-n1', frozenPlan('alpha60-n1', { by: 'annotators: a-1, b-1; adjudicator: adj-1', extra: { disputeId: 'D-7' } }));
    set.addPlan('alpha60-n2', frozenPlan('alpha60-n2', { by: 'the orchestrator, by hand', verifiedBy: null }));
    set.write('keys-wip/alpha60-n2.record.json', JSON.stringify({ annotators: ['x'], adjudicator: null, verifiedBy: 'single annotation' }));
    splitsFile(set, { alpha60: 'dev' });
    const { manifest, problems } = buildManifest(set.dir);
    expect(problems).toEqual([]);
    expect(manifest.plans['alpha60-n1'].annotation.disputeId).toBe('D-7');
    expect(manifest.plans['alpha60-n2'].annotation).toMatchObject({ annotators: ['x'], verifiedBy: 'single annotation' });
  });

  it('lists a checked plan that cannot have an entry, saying why, and writes none of them', () => {
    const set = track(makeSet());
    set.addPlan('alpha60-n1', frozenPlan('alpha60-n1'));
    set.addPlan('nobook60-n2', frozenPlan('nobook60-n2'));
    set.addPlan('listing-004', frozenPlan('listing-004', { by: 'annotators: a; adjudicator: none' }));
    set.addPlan('alpha60-n5', frozenPlan('alpha60-n5', { by: 'odd', verifiedBy: null }));
    splitsFile(set, { alpha60: 'dev' });
    const { problems, manifest } = buildManifest(set.dir);
    expect(problems.map((p) => `${p.name}: ${p.text}`)).toEqual([
      'alpha60-n5: its record names no annotators (by "odd", and no usable record file)',
      'alpha60-n5: its record does not say how it was verified (verifiedBy)',
      'listing-004: its book listing-004 is not in splits.json',
      'listing-004: its era is unknown (it is not in sources.jsonl and not named like a plan-book page)',
      'listing-004: its decade is unknown',
      'nobook60-n2: its book nobook60 is not in splits.json',
    ]);
    expect(Object.keys(manifest.plans)).toEqual(['alpha60-n1']);
  });

  it('needs splits.json, and says so', () => {
    const set = track(makeSet());
    set.addPlan('alpha60-n1', frozenPlan('alpha60-n1'));
    expect(() => buildManifest(set.dir)).toThrow(/there is no orchestration.splits\.json: run realManifest assign-splits --write first/);
    set.write('orchestration/splits.json', '{ nope');
    expect(() => buildManifest(set.dir)).toThrow(/not valid JSON/);
    set.write('orchestration/splits.json', JSON.stringify({ books: { alpha60: { split: 'prod' } } }));
    expect(() => buildManifest(set.dir)).toThrow(/book "alpha60" has split "prod", not dev or test/);
  });

  it('does not derive the manifest from itself: a changed split in splits.json is a changed manifest', async () => {
    const set = smallSet();
    const first = buildManifest(set.dir);
    await commitManifest(set.dir, first, { reason: 'first' });
    splitsFile(set, { alpha60: 'test', beta61: 'test', gamma62: 'dev' });
    expect(buildManifest(set.dir).manifest.plans['alpha60-n1'].split).toBe('test');
  });
});

describe('the file, its archive and its log', () => {
  it('writes the manifest, keeps a copy by the first 12 digits of its hash, and logs the version', async () => {
    const set = smallSet();
    const built = buildManifest(set.dir);
    const result = await commitManifest(set.dir, built, { reason: 'first build', now: new Date('2026-09-29T12:00:00Z') });
    expect(result).toEqual({ changed: true, hash: built.hash, version: 1 });
    expect(fs.readFileSync(manifestFileFor(set.dir), 'utf8')).toBe(built.text);
    expect(loadManifest(manifestFileFor(set.dir)).hash).toBe(built.hash);
    expect(fs.readFileSync(path.join(set.dir, 'orchestration', 'manifest-versions', `manifest-${built.hash.slice(0, 12)}.json`), 'utf8')).toBe(built.text);
    const log = fs.readFileSync(set.orch('manifest-log.md'), 'utf8');
    expect(log).toMatch(/^# Manifest log\n/);
    expect(log).toContain('| version | hash | date | reason | counts |');
    expect(log).toContain(`| 1 | ${built.hash} | 2026-09-29T12:00:00.000Z | first build | 3 plans: dev 2 / test 1; vintage 3 / 2020-2022 0 |`);
    expect(logVersions(set.dir)).toEqual([1]);
  });

  it('logs nothing when the manifest would not change, and a new version when it does', async () => {
    const set = smallSet();
    await commitManifest(set.dir, buildManifest(set.dir), { reason: 'first' });
    const stamp = fs.statSync(manifestFileFor(set.dir)).mtimeMs;
    const same = await commitManifest(set.dir, buildManifest(set.dir), { reason: 'again' });
    expect(same).toMatchObject({ changed: false, version: 1 });
    expect(fs.statSync(manifestFileFor(set.dir)).mtimeMs).toBe(stamp);
    expect(logVersions(set.dir)).toEqual([1]);
    // An archive that went missing is put back.
    const archive = path.join(set.dir, 'orchestration', 'manifest-versions', fs.readdirSync(path.join(set.dir, 'orchestration', 'manifest-versions'))[0]);
    fs.rmSync(archive);
    await commitManifest(set.dir, buildManifest(set.dir), { reason: 'again' });
    expect(fs.existsSync(archive)).toBe(true);
    splitsFile(set, { alpha60: 'test', beta61: 'test', gamma62: 'dev' });
    const changed = await commitManifest(set.dir, buildManifest(set.dir), { reason: 'resplit | with a pipe\nand a line' });
    expect(changed).toMatchObject({ changed: true, version: 2 });
    expect(fs.readdirSync(path.join(set.dir, 'orchestration', 'manifest-versions'))).toHaveLength(2);
    const rows = fs.readFileSync(set.orch('manifest-log.md'), 'utf8').trim().split('\n').filter((l) => /^\| \d+ \|/.test(l));
    expect(rows).toHaveLength(2);
    expect(rows[1]).toContain('resplit \\| with a pipe and a line');
  });
});

describe('amend', () => {
  const frozenWithManifest = async () => {
    const set = smallSet();
    await commitManifest(set.dir, buildManifest(set.dir), { reason: 'first' });
    return set;
  };
  // What `realKeyTool apply --dispute D-7` does to a plan: another key (the garage is a porch), the record marked.
  const disputed = (set, name, id = 'D-7') => {
    const project = set.readPlan(name);
    project.floors[0].state.perimeterTraces.find((t) => t.type === 'garage').type = 'porch';
    project.answerKey = { ...project.answerKey, disputeId: id };
    set.writePlan(name, project);
  };

  it('rebuilds one plan\'s entry and nothing else: a new hash, an archive, a log row that names the dispute', async () => {
    const set = await frozenWithManifest();
    const before = loadManifest(manifestFileFor(set.dir));
    disputed(set, 'alpha60-n1');
    const built = amendedManifest(set.dir, 'alpha60-n1');
    expect(built.disputeId).toBe('D-7');
    expect(built.before).toBe(before.manifest.plans['alpha60-n1'].keySha256);
    expect(built.after).not.toBe(built.before);
    expect(built.manifest.plans['alpha60-n1'].annotation.disputeId).toBe('D-7');
    for (const other of ['alpha60-n2', 'beta61-n3']) expect(built.manifest.plans[other]).toEqual(before.manifest.plans[other]);
    const result = await commitManifest(set.dir, built, { reason: 'the garage is a porch (D-7, alpha60-n1)' });
    expect(result).toMatchObject({ changed: true, version: 2 });
    expect(result.hash).not.toBe(before.hash);
    expect(fs.existsSync(path.join(set.dir, 'orchestration', 'manifest-versions', `manifest-${before.hash.slice(0, 12)}.json`))).toBe(true);
    expect(fs.readFileSync(set.orch('manifest-log.md'), 'utf8')).toMatch(/D-7, alpha60-n1/);
  });

  it('keeps the plan\'s book, era and split as the manifest has them, even when splits.json moved on', async () => {
    const set = await frozenWithManifest();
    disputed(set, 'beta61-n3');
    splitsFile(set, { alpha60: 'dev', beta61: 'dev', gamma62: 'dev' });
    expect(amendedManifest(set.dir, 'beta61-n3').manifest.plans['beta61-n3'].split).toBe('test');
  });

  it('refuses a plan whose record has no dispute id, a plan the manifest does not hold, and a missing manifest', async () => {
    const set = await frozenWithManifest();
    expect(() => amendedManifest(set.dir, 'alpha60-n1')).toThrow(/record has no disputeId: a key is amended only by a dispute/);
    expect(() => amendedManifest(set.dir, 'gamma62-n4')).toThrow(/gamma62-n4 is not in the manifest/);
    expect(() => amendedManifest(set.dir, 'constructor')).toThrow(/is not in the manifest/);
    expect(() => amendedManifest(set.dir, '../alpha60-n1')).toThrow(/not a plan name/);
    fs.rmSync(manifestFileFor(set.dir));
    expect(() => amendedManifest(set.dir, 'alpha60-n1')).toThrow(/manifest .* does not exist/);
  });

  it('is no change when the manifest already holds the plan\'s current key and record', async () => {
    const set = await frozenWithManifest();
    disputed(set, 'alpha60-n1');
    await commitManifest(set.dir, amendedManifest(set.dir, 'alpha60-n1'), { reason: 'first amend' });
    const again = await commitManifest(set.dir, amendedManifest(set.dir, 'alpha60-n1'), { reason: 'second amend' });
    expect(again).toMatchObject({ changed: false, version: 2 });
  });
});

describe('verify', () => {
  const built = async (set) => {
    await commitManifest(set.dir, buildManifest(set.dir), { reason: 'test' });
    return set;
  };
  const fullyFrozen = async () => {
    const set = smallSet();
    set.addPlan('gamma62-n4', frozenPlan('gamma62-n4'));
    return built(set);
  };
  const verify = (set, options) => verifyManifest(set.dir, options);

  it('passes on a manifest that matches the folder, saying what it checked', async () => {
    const set = await fullyFrozen();
    const { rules, pass } = verify(set);
    expect(pass).toBe(true);
    expect(rules.map((r) => `${r.status} ${r.id}`)).toEqual([
      'PASS manifest', 'PASS plans', 'PASS keys', 'PASS checked', 'PASS strays', 'PASS splits', 'PASS no book spans splits',
    ]);
    expect(status(rules, 'manifest').text).toMatch(/^version 1, 4 plans, hash [0-9a-f]{12}$/);
  });

  it('fails without a manifest, or with one that is not one', async () => {
    const set = await fullyFrozen();
    fs.writeFileSync(manifestFileFor(set.dir), '{ nope');
    expect(verify(set)).toMatchObject({ pass: false, rules: [{ status: 'FAIL', id: 'manifest' }] });
    fs.rmSync(manifestFileFor(set.dir));
    expect(verify(set).rules[0].text).toMatch(/does not exist/);
  });

  it('fails a plan the manifest lists and the folder lacks', async () => {
    const set = await fullyFrozen();
    fs.rmSync(set.planFile('beta61-n3'));
    const { rules, pass } = verify(set);
    expect(pass).toBe(false);
    expect(status(rules, 'plans')).toMatchObject({ status: 'FAIL', text: '1 manifest plans have no plan file: beta61-n3' });
  });

  it('fails a key that no longer hashes to its fingerprint, and a plan back to the app\'s own trace', async () => {
    const set = await fullyFrozen();
    const project = set.readPlan('alpha60-n1');
    project.floors[0].state.perimeterTraces[0].vertices[0].x += 5;
    set.writePlan('alpha60-n1', project);
    set.writePlan('alpha60-n2', newPlan('alpha60-n2'));
    const { rules } = verify(set);
    expect(status(rules, 'keys').status).toBe('FAIL');
    expect(status(rules, 'keys').text).toMatch(/^2 keys differ from the manifest's fingerprint: alpha60-n1 \(key changed since the manifest \(was [0-9a-f]{8}, is [0-9a-f]{8}\)\), alpha60-n2 \(key changed since the manifest \(was [0-9a-f]{8}, is none\)\)/);
  });

  it('fails a record that is not checked, in the plan or in the manifest', async () => {
    const set = await fullyFrozen();
    const project = set.readPlan('alpha60-n2');
    delete project.answerKey.checked;
    set.writePlan('alpha60-n2', project);
    expect(status(verify(set).rules, 'checked')).toMatchObject({ status: 'FAIL', text: '1 records are not checked (plan or manifest): alpha60-n2' });
    set.writePlan('alpha60-n2', frozenPlan('alpha60-n2', { by: 'annotators: a-2, b-2; adjudicator: adj-2' }));
    const file = manifestFileFor(set.dir);
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    delete json.plans['alpha60-n1'].annotation.checked;
    fs.writeFileSync(file, JSON.stringify(json));
    expect(status(verify(set).rules, 'checked').text).toMatch(/: alpha60-n1$/);
  });

  it('lists the plan files the manifest lacks, a failure unless the manifest is partial on purpose', async () => {
    const set = await fullyFrozen();
    set.addPlan('delta63-n9', newPlan('delta63-n9'));
    expect(status(verify(set).rules, 'strays')).toMatchObject({ status: 'FAIL', text: '1 plan files are not in the manifest: delta63-n9' });
    expect(verify(set).pass).toBe(false);
    const partial = verify(set, { allowPartial: true });
    expect(status(partial.rules, 'strays').status).toBe('INFO');
    expect(partial.pass).toBe(true);
  });

  it('fails a plan whose split differs from what splits.json gives its book, and a book in both splits', async () => {
    const set = await fullyFrozen();
    splitsFile(set, { alpha60: 'test', beta61: 'test', gamma62: 'dev' });
    expect(status(verify(set).rules, 'splits')).toMatchObject({ status: 'FAIL', text: '2 plans sit in another split than splits.json gives their book: alpha60-n1, alpha60-n2' });
    const file = manifestFileFor(set.dir);
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    json.plans['alpha60-n2'].split = 'test';
    fs.writeFileSync(file, JSON.stringify(json));
    expect(status(verify(set).rules, 'no book spans splits')).toMatchObject({ status: 'FAIL', text: 'books in both splits: alpha60' });
    fs.rmSync(path.join(set.dir, 'orchestration', 'splits.json'));
    expect(status(verify(set).rules, 'splits')).toMatchObject({ status: 'INFO' });
  });

  it('knows an address in a plan\'s name: three digits or more, then a street word', () => {
    for (const bad of ['dg21-1234-oak-street', 'x21-12345-main-st', 'x21-123-elm-avenue', 'x21-1234oakst', 'x21-4500-dr', 'x21-777-way', 'x21-100-old-mill-lane', 'x21-2020-the-court']) {
      expect(looksLikeAddress(bad), bad).toBe(true);
    }
    for (const fine of ['dg21-1234', 'popular63-n44a', 'x21-12-st', 'x21-1234-modern-farmhouse', 'x21-craftsman-2', 'x21-plan-101', 'x21-3000sqft', 'houseplans20-2400-a']) {
      expect(looksLikeAddress(fine), fine).toBe(false);
    }
  });
});

describe('verify --final: the finished set\'s rules', () => {
  // Each rule is tried on a set of its own: building 400 plans is a second or two.
  const finished = async () => {
    const { set } = finishedSet();
    track(set);
    await assignSplitsCommand(['--seed', '20260929', '--pin-existing', '--write'], { ...set.ctx, out: () => {} });
    await commitManifest(set.dir, buildManifest(set.dir), { reason: 'final' });
    return set;
  };
  const final = (set) => verifyManifest(set.dir, { final: true });
  const rewriteManifest = (set, edit) => {
    const file = manifestFileFor(set.dir);
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    edit(json);
    fs.writeFileSync(file, JSON.stringify(json));
  };

  it('passes on a set that meets every rule, and reports what it counted', async () => {
    const { rules, pass } = final(await finished());
    expect(pass, say(rules)).toBe(true);
    expect(status(rules, 'count').text).toBe('400 plans (the finished set has exactly 400)');
    expect(status(rules, 'cap per book').text).toBe('no book or site unit has more than 12 plans (the most: 10)');
    expect(status(rules, 'books').text).toMatch(/^54 books or site units \(at least 34\); 54 distinct sites or books, \d+ named publishers$/);
    expect(status(rules, 'split sizes').text).toMatch(/^test 1[3-6]\d \/ dev 2[3-7]\d \(aimed at about 150 \/ 250\)$/);
    expect(status(rules, 'eras in both splits').status).toBe('PASS');
    expect(status(rules, 'room-size labels').text).toBe('400 of 400 plans (100.0%) have at least one detected room size (at least 90%)');
    expect(status(rules, 'no addresses in names').status).toBe('PASS');
    expect(status(rules, 'sources').text).toBe('every new plan has a source (75 embedded from the original set)');
    expect(status(rules, '2020-2022')).toMatchObject({ status: 'INFO', text: '160 plans of the 325 new ones (the aim is about 160 of 325)' });
    expect(status(rules, 'cap per site')).toMatchObject({ status: 'PASS' });
  });

  it('fails a count other than 400', async () => {
    const set = await finished();
    rewriteManifest(set, (json) => { delete json.plans[Object.keys(json.plans)[0]]; });
    const { rules } = final(set);
    expect(status(rules, 'count')).toMatchObject({ status: 'FAIL', text: '399 plans (the finished set has exactly 400)' });
    expect(status(rules, 'strays').status).toBe('FAIL');
    rewriteManifest(set, (json) => { json.plans.extra = { ...json.plans[Object.keys(json.plans)[1]] }; });
    expect(status(final(set).rules, 'count').text).toMatch(/^400 plans/);
  });

  it('fails a book over 12 plans, a site over 60, and fewer than 34 books', async () => {
    const set = await finished();
    rewriteManifest(set, (json) => {
      const names = Object.keys(json.plans).filter((n) => json.plans[n].book !== 'modaa21');
      for (const n of names.slice(0, 5)) json.plans[n].book = 'modaa21';
    });
    expect(status(final(set).rules, 'cap per book')).toMatchObject({ status: 'FAIL', text: expect.stringMatching(/^over 12 plans: modaa21 \(15\)/) });
    rewriteManifest(set, (json) => {
      for (const p of Object.values(json.plans)) if (p.era === '2020-2022') p.site = 'one-big-site.example';
    });
    expect(status(final(set).rules, 'cap per site')).toMatchObject({ status: 'FAIL', text: 'over 60 plans: one-big-site.example (160)' });
    rewriteManifest(set, (json) => {
      for (const p of Object.values(json.plans)) p.book = `merged${p.era === 'vintage' ? p.decade : 'm'}`;
    });
    expect(status(final(set).rules, 'books')).toMatchObject({ status: 'FAIL', text: expect.stringMatching(/^\d+ books or site units \(at least 34\)/) });
  });

  it('fails a split with no plan of an era', async () => {
    const set = await finished();
    rewriteManifest(set, (json) => {
      for (const p of Object.values(json.plans)) if (p.era === '2020-2022') p.split = 'dev';
    });
    const { rules } = final(set);
    expect(status(rules, 'eras in both splits')).toMatchObject({ status: 'FAIL', text: 'test has no 2020-2022 plan' });
  });

  it('fails when fewer than 90% of the plans have a detected room size', async () => {
    const set = await finished();
    const names = fs.readdirSync(set.dir).filter((f) => f.endsWith('.floorplan')).map((f) => f.replace('.floorplan', '')).sort();
    for (const name of names.slice(0, 41)) {
      const project = set.readPlan(name);
      project.floors[0].state.detectedDimensions = [];
      set.writePlan(name, project);
    }
    expect(status(final(set).rules, 'room-size labels')).toMatchObject({ status: 'FAIL', text: '359 of 400 plans (89.8%) have at least one detected room size (at least 90%)' });
    // 40 of 400 without is exactly 90%: allowed.
    const project = set.readPlan(names[40]);
    project.floors[0].state.detectedDimensions = [{ width: 10, height: 10, text: "10' x 10'", bbox: { x: 1, y: 1, width: 5, height: 5 } }];
    set.writePlan(names[40], project);
    expect(status(final(set).rules, 'room-size labels').status).toBe('PASS');
  });

  it('fails a plan named for an address, a plan with no source, and more embedded images than the original set had', async () => {
    const set = await finished();
    rewriteManifest(set, (json) => {
      json.plans['modaa21-1004-oak-street'] = { ...json.plans['modaa21-1001'] };
      delete json.plans['modaa21-1001'];
    });
    expect(status(final(set).rules, 'no addresses in names')).toMatchObject({ status: 'FAIL', text: 'names that look like an address: modaa21-1004-oak-street' });
    rewriteManifest(set, (json) => { delete json.plans['modaa21-1002'].source; });
    expect(status(final(set).rules, 'sources')).toMatchObject({ status: 'FAIL', text: '1 plans have no source: modaa21-1002' });
    rewriteManifest(set, (json) => {
      for (const n of Object.keys(json.plans).filter((x) => x.startsWith('modaa21')).slice(0, 3)) json.plans[n].source = { embedded: true };
    });
    expect(status(final(set).rules, 'sources').text).toMatch(/78 plans have an embedded image and no source, but only the original 75 may/);
  });

  it('reports the modern count, and the base rules still run without --final', async () => {
    const set = await finished();
    expect(verifyManifest(set.dir).rules.map((r) => r.id)).not.toContain('count');
    expect(verifyManifest(set.dir).pass).toBe(true);
  });
});

describe('entryFor', () => {
  it('needs a key, and leaves the plan\'s own dispute mark out of nothing else', () => {
    const facts = { key: null, answerKey: { checked: CHECKED, by: 'annotators: a; adjudicator: none', verifiedBy: 'single annotation' }, source: null, keySha: null };
    const info = { book: 'a', era: 'vintage', decade: 1960, split: 'dev' };
    expect(entryFor({ facts, info, logged: undefined, record: null }).problems).toEqual(['the plan holds no key (only the app\'s own trace)']);
  });
});
