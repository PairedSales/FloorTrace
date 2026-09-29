// What the pipeline knows of each plan besides its keys (scripts/lib/pipelineCatalog.mjs),
// and the small helpers under the commands: the fixed JSON layout and the tables.
import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listPlans, loadCatalog, readSplits } from '../pipelineCatalog.mjs';
import { pct, plural, table } from '../pipelineTable.mjs';
import { stableStringify } from '../stableJson.mjs';
import { makeSet, newPlan, planEvent, writeLog } from './pipelineHarness.mjs';

let set;
beforeEach(() => {
  set = makeSet();
});
afterEach(() => set.cleanup());

const wb = (n) => `https://web.archive.org/web/20210101000000id_/https://x.example/${n}.png`;

describe('the plans of a set folder', () => {
  it('are the .floorplan files at its top level, sorted, and nothing else', () => {
    for (const n of ['b60-n2', 'a60-n1', 'c.d-1']) set.addPlan(n, newPlan(n));
    set.write('answer-keys.json', '{}');
    set.write('a60-n1.floorplan.tmp-1-abc', 'half written');
    set.write('excluded/gone60-n1.floorplan', '{}');
    set.write('.hidden.floorplan', '{}');
    set.write('has space.floorplan', '{}');
    expect(listPlans(set.dir)).toEqual(['a60-n1', 'b60-n2', 'c.d-1']);
    expect(listPlans(path.join(set.dir, 'nothing'))).toEqual([]);
  });
});

describe('the catalog', () => {
  it('names the plans that predate the sourcing log by their stems and the year in them, -n or -p', () => {
    for (const n of ['aladdin62-n15', 'dwellings14-p101', 'listing-004']) set.addPlan(n, newPlan(n));
    const catalog = loadCatalog(set.dir);
    expect(catalog.infoOf('aladdin62-n15')).toMatchObject({
      book: 'aladdin62', era: 'vintage', decade: 1960, year: 1962, split: null, logged: false, site: null, publisher: null,
    });
    expect(catalog.infoOf('dwellings14-p101')).toMatchObject({ book: 'dwellings14', era: 'vintage', decade: 1910, year: 1914 });
    // No digits in the name, no log line: nothing says what it is.
    expect(catalog.infoOf('listing-004')).toMatchObject({ book: 'listing-004', era: null, decade: null, year: null });
  });

  it('does not take a plan with a source of its own for one of the original 75 because its name ends in two digits', () => {
    // hpn21-24360 is a 2021 web capture the sourcing log has no line for yet; the
    // name looks like `aladdin62-n15`, and read that way it would be a vintage plan
    // of 1921 in a book of its own.
    const source = { url: 'https://web.archive.org/web/20210101000000id_/https://x.example/24360.png', crop: [0, 0, 460, 300], size: [460, 300] };
    set.addPlan('hpn21-24360', newPlan('hpn21-24360', { source }));
    set.addPlan('aladdin62-n15', newPlan('aladdin62-n15'));
    set.addPlan('hpn22-31000', newPlan('hpn22-31000', { source }));
    writeLog(set, [planEvent('hpn22-31000', { book: 'HPN 963', era: '2020-2022', year: 2022, decade: 2020, unit: '963', site: 'hpn.example', url: source.url })]);
    const c = loadCatalog(set.dir);
    expect(c.infoOf('hpn21-24360')).toMatchObject({ era: null, decade: null, year: null, logged: false });
    expect(c.isLegacy('hpn21-24360')).toBe(false);
    expect(c.hasOwnSource('hpn21-24360')).toBe(true);
    // The original 75 are still found by name, and a logged plan by its line.
    expect(c.isLegacy('aladdin62-n15')).toBe(true);
    expect(c.infoOf('aladdin62-n15')).toMatchObject({ era: 'vintage', decade: 1960, year: 1962 });
    expect(c.isLegacy('hpn22-31000')).toBe(false);
    expect(c.infoOf('hpn22-31000')).toMatchObject({ book: '963', era: '2020-2022', decade: 2020 });
    // A plan file that cannot be read is not vouched for as one of the 75.
    fs.writeFileSync(set.planFile('torn60-n1'), '{ not json');
    expect(loadCatalog(set.dir).isLegacy('torn60-n1')).toBe(false);
    expect(loadCatalog(set.dir).infoOf('torn60-n1').era).toBeNull();
  });

  it('takes a logged plan\'s facts from the log: the designer code is its book, the site and publisher come along', () => {
    writeLog(set, [
      planEvent('pacific25-n41', { book: 'Pacific 1925', publisher: 'Pacific Ready-Cut', year: 1925, decade: 1920 }),
      planEvent('dg21-1', { book: 'Design Group', era: '2020-2022', year: 2021, decade: 2020, unit: '940', site: 'dg.example', url: wb('a') }),
      planEvent('bare60-n1', { book: 'Bare 1960', year: 1960, decade: 1960 }),
    ]);
    set.write('orchestration/sources.jsonl', `${fs.readFileSync(set.orch('sources.jsonl'), 'utf8')}${JSON.stringify({ event: 'book', book: 'bare60', publisher: 'Bare Press', year: 1960 })}\n`);
    const c = loadCatalog(set.dir);
    expect(c.infoOf('pacific25-n41')).toMatchObject({ book: 'pacific25', publisher: 'Pacific Ready-Cut', era: 'vintage', decade: 1920, logged: true });
    expect(c.infoOf('dg21-1')).toMatchObject({ book: '940', site: 'dg.example', era: '2020-2022', decade: 2020 });
    // A `log book` entry under the unit's name gives a publisher the plan's own line lacks.
    expect(c.infoOf('bare60-n1').publisher).toBe('Bare Press');
    expect(c.unitOf('dg21-1')).toBe('940');
  });

  it('matches --book by the unit, the book as logged, or the site, without regard to case', () => {
    for (const n of ['pacific25-n41', 'dg21-1']) set.addPlan(n, newPlan(n));
    writeLog(set, [
      planEvent('pacific25-n41', { book: 'Pacific 1925', year: 1925, decade: 1920 }),
      planEvent('dg21-1', { book: 'Design Group', era: '2020-2022', year: 2021, decade: 2020, unit: '940', site: 'DG.example', url: wb('a') }),
    ]);
    const c = loadCatalog(set.dir);
    for (const word of ['pacific25', 'PACIFIC 1925', 'pacific  1925']) expect(c.matchesBook('pacific25-n41', word), word).toBe(true);
    for (const word of ['940', 'design group', 'dg.example']) expect(c.matchesBook('dg21-1', word), word).toBe(true);
    expect(c.matchesBook('dg21-1', 'pacific25')).toBe(false);
    expect(c.books(['dg21-1', 'pacific25-n41'])).toEqual(['940', 'pacific25']);
  });

  it('finds the split of a plan in the manifest first (the frozen assignment), then in splits.json', () => {
    set.write('orchestration/splits.json', JSON.stringify({ seed: 1, books: { a60: { split: 'dev' }, b60: { split: 'test' } } }));
    let c = loadCatalog(set.dir);
    expect(c.hasSplitSource()).toBe(true);
    expect(c.infoOf('a60-n1').split).toBe('dev');
    expect(c.infoOf('b60-n1').split).toBe('test');
    expect(c.infoOf('c60-n1').split).toBeNull();
    set.write('orchestration/manifest.json', JSON.stringify({ version: 1, plans: { 'a60-n1': { book: 'a60', split: 'test', era: 'vintage', decade: 1960, publisher: 'P', site: 'S' } } }));
    c = loadCatalog(set.dir);
    expect(c.infoOf('a60-n1')).toMatchObject({ split: 'test', publisher: 'P', site: 'S' });
    expect(c.infoOf('a60-n2').split).toBe('dev');
    // `manifest: false` reads no manifest: build derives it and must not derive it from itself.
    expect(loadCatalog(set.dir, { manifest: false }).infoOf('a60-n1').split).toBe('dev');
    // A plan named `constructor` is not in a manifest that has no such plan.
    expect(c.infoOf('constructor').split).toBeNull();
  });

  it('keeps a manifest or splits file it cannot read as an error for whatever needs it, and does not fail to load', () => {
    set.write('orchestration/manifest.json', '{ nope');
    set.write('orchestration/splits.json', JSON.stringify({ books: { a60: { split: 'sideways' } } }));
    const c = loadCatalog(set.dir);
    expect(c.hasSplitSource()).toBe(false);
    expect(c.errors.manifest.message).toMatch(/not valid JSON/);
    expect(c.errors.splits.message).toMatch(/book "a60" has split "sideways", not dev or test/);
    expect(c.infoOf('a60-n1').split).toBeNull();
  });

  it('finds a designer code two sites share', () => {
    writeLog(set, [
      planEvent('a21-1', { book: 'A', era: '2020-2022', year: 2021, decade: 2020, unit: '940', site: 'a.example', url: wb('a') }),
      planEvent('b21-1', { book: 'B', era: '2020-2022', year: 2021, decade: 2020, unit: '940', site: 'b.example', url: wb('b') }),
      planEvent('a21-2', { book: 'A', era: '2020-2022', year: 2021, decade: 2020, unit: '77', site: 'a.example', url: wb('c') }),
    ]);
    expect(loadCatalog(set.dir).unitClashes()).toEqual([{ unit: '940', sites: ['a.example', 'b.example'] }]);
  });

  it('reads the splits file strictly', () => {
    expect(readSplits(set.dir)).toBeNull();
    set.write('orchestration/splits.json', JSON.stringify({ books: [] }));
    expect(() => readSplits(set.dir)).toThrow(/"books" is not an object/);
    set.write('orchestration/splits.json', JSON.stringify({ books: { a: 'dev' } }));
    expect(() => readSplits(set.dir)).toThrow(/book "a" has split undefined/);
  });

  it('ignores a superseded plan line and a torn last line of the log', () => {
    writeLog(set, [planEvent('pacific25-n41', { book: 'Pacific 1925', year: 1925, decade: 1920, superseded: '2026-09-29T00:00:00Z' })]);
    set.write('orchestration/sources.jsonl', `${fs.readFileSync(set.orch('sources.jsonl'), 'utf8')}{"event":"plan","na`);
    const c = loadCatalog(set.dir);
    expect(c.logged.size).toBe(0);
    expect(c.infoOf('pacific25-n41').logged).toBe(false);
  });
});

describe('the fixed JSON layout', () => {
  it('sorts keys at every depth, keeps arrays in order, and ends with one newline', () => {
    const text = stableStringify({ b: 1, a: { d: [3, { z: 1, y: 2 }, 1], c: null }, c: 'x' });
    expect(text).toBe('{\n  "a": {\n    "c": null,\n    "d": [\n      3,\n      {\n        "y": 2,\n        "z": 1\n      },\n      1\n    ]\n  },\n  "b": 1,\n  "c": "x"\n}\n');
    expect(stableStringify({ c: 1, a: 2 })).toBe(stableStringify({ a: 2, c: 1 }));
  });
});

describe('tables', () => {
  it('aligns columns, right-aligns numbers, and trims trailing space', () => {
    const lines = table([{ n: 'a', v: 5 }, { n: 'bbb', v: 120 }], [{ title: 'name', get: (r) => r.n }, { title: 'value', get: (r) => r.v, right: true }, { title: '', get: () => '' }]);
    expect(lines).toEqual(['name  value', 'a         5', 'bbb     120']);
    expect(pct(1, 3)).toBe('33.3%');
    expect(pct(0, 0)).toBe('n/a');
    expect(plural(1, 'plan')).toBe('1 plan');
    expect(plural(2, 'plan')).toBe('2 plans');
  });
});
