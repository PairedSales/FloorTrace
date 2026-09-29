// The split of books between dev and test (scripts/lib/splitAssign.mjs, and the
// seeded random source under it): deterministic, whole books, pinned books
// first, stratified by era and decade, and close to the share asked for.
import crypto from 'crypto';
import { describe, expect, it } from 'vitest';
import {
  assignSplits, assignmentLines, rosterFromSet, rosterSha256, splitsText, validateRoster,
} from '../splitAssign.mjs';
import { mulberry32, seedOf, shuffled } from '../prng.mjs';
import { loadCatalog } from '../pipelineCatalog.mjs';
import { stableStringify } from '../stableJson.mjs';
import { makeSet, newPlan, planEvent, writeLog } from './pipelineHarness.mjs';

const row = (book, era, decade, plans, publisher = null) => ({
  book, era, decade, plans, publisher,
});

// A roster of the shape the finished set will have: 17 books of the first 75
// plans (one 1910s, eight 1950s, eight 1960s), 21 more plan books of 165 plans
// over seven decades, and 16 sites of 160 modern plans. 54 books, 400 plans.
const realisticRoster = () => {
  const rows = [];
  const legacyPlans = [5, 5, 5, 5, 5, 5, 5, 5, 4, 4, 4, 4, 4, 4, 4, 4, 3];
  const legacyDecades = [1910, ...Array(8).fill(1950), ...Array(8).fill(1960)];
  legacyPlans.forEach((n, i) => rows.push(row(`legacy${i}`, 'vintage', legacyDecades[i], n, 'Old Press')));
  const newPlans = [...Array(12).fill(8), ...Array(6).fill(9), ...Array(3).fill(5)];
  const decades = [1900, 1910, 1920, 1930, 1940, 1950, 1960];
  newPlans.forEach((n, i) => rows.push(row(`vintage${String(i).padStart(2, '0')}`, 'vintage', decades[i % decades.length], n, `Press ${i % 5}`)));
  for (let i = 0; i < 16; i += 1) rows.push(row(`site${String(i).padStart(2, '0')}`, '2020-2022', 2020, 10, `Builder ${i}`));
  return rows;
};
const PINNED = Array.from({ length: 17 }, (_, i) => `legacy${i}`);
const assign = (roster = realisticRoster(), options = {}) => assignSplits(roster, {
  seed: 20260929, targetTest: 150, total: 400, pinDev: PINNED, ...options,
});
const plansIn = (result, split) => Object.values(result.books).filter((b) => b.split === split).reduce((n, b) => n + b.plans, 0);

describe('the seeded random source', () => {
  it('is mulberry32: the sequence for a seed is the reference one', () => {
    const rng = mulberry32(1);
    // The published reference values of mulberry32 for seed 1.
    expect(rng()).toBeCloseTo(0.6270739405881613, 15);
    expect(rng()).toBeCloseTo(0.002735721180215478, 15);
    expect(rng()).toBeCloseTo(0.5274470399599522, 15);
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it('shuffles a copy, all of it, the same way for the same seed', () => {
    const list = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const one = shuffled(list, mulberry32(5));
    expect(list).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
    expect([...one].sort()).toEqual(list);
    expect(shuffled(list, mulberry32(5))).toEqual(one);
    expect(shuffled(list, mulberry32(6))).not.toEqual(one);
  });

  it('seeds a stratum from its own name', () => {
    expect(seedOf('1|vintage|1960')).toBe(seedOf('1|vintage|1960'));
    expect(seedOf('1|vintage|1960')).not.toBe(seedOf('1|vintage|1950'));
    expect(seedOf('x')).toBe(crypto.createHash('sha256').update('x').digest().readUInt32BE(0));
  });
});

describe('the roster', () => {
  it('refuses what it cannot use, all at once', () => {
    expect(() => validateRoster([])).toThrow(/non-empty array/);
    expect(() => validateRoster('x')).toThrow(/non-empty array/);
    const bad = [
      row('a', 'vintage', 1960, 5),
      row('a', 'vintage', 1960, 5),
      row('', 'vintage', 1960, 5),
      row('b', 'modern', 1960, 5),
      row('c', 'vintage', 1965, 5),
      row('d', 'vintage', 1960, 0),
      row('e', 'vintage', 1960, 2.5),
      { ...row('f', 'vintage', 1960, 5), publisher: 4 },
    ];
    try {
      validateRoster(bad);
      expect.unreachable();
    } catch (error) {
      expect(error.message).toMatch(/book a appears twice/);
      expect(error.message).toMatch(/book must be a non-empty string/);
      expect(error.message).toMatch(/era must be vintage or 2020-2022/);
      expect(error.message).toMatch(/and \d more/);
    }
    expect(() => validateRoster([row('c', 'vintage', 1965, 5)])).toThrow(/decade must be a whole decade such as 1960/);
    expect(() => validateRoster([row('d', 'vintage', 1960, 0)])).toThrow(/plans must be a whole number of at least 1/);
  });

  it('is sorted by book, and keeps the site when it has one', () => {
    const rows = validateRoster([{ ...row('b', 'vintage', 1960, 5), site: 'houseplans' }, row('a', 'vintage', 1950, 3)]);
    expect(rows.map((r) => r.book)).toEqual(['a', 'b']);
    expect(rows[1].site).toBe('houseplans');
    expect(rows[0]).not.toHaveProperty('site');
  });
});

describe('assign-splits', () => {
  it('is deterministic: the same roster and seed give the same assignment, in any order of the roster', () => {
    const one = assign();
    expect(assign()).toEqual(one);
    expect(assign([...realisticRoster()].reverse())).toEqual(one);
    expect(assign(realisticRoster(), { seed: 7 }).books).not.toEqual(one.books);
  });

  it('gives the same file byte for byte, and names what it was made from', () => {
    const roster = realisticRoster();
    const at = '2026-09-29T00:00:00.000Z';
    const a = splitsText(assign(roster), { createdAt: at, roster });
    const b = splitsText(assign([...roster].reverse()), { createdAt: at, roster: [...roster].reverse() });
    expect(a).toBe(b);
    const parsed = JSON.parse(a);
    expect(Object.keys(parsed)).toEqual(['books', 'createdAt', 'params', 'seed']);
    expect(Object.keys(parsed.books)).toEqual(Object.keys(parsed.books).sort());
    expect(parsed.params).toMatchObject({ targetTest: 150, total: 400, rosterSha256: rosterSha256(roster) });
    expect(parsed.books.legacy0).toEqual({
      era: 'vintage', decade: 1910, pinned: true, plans: 5, publisher: 'Old Press', split: 'dev',
    });
    expect(a.endsWith('}\n')).toBe(true);
    expect(a).toBe(stableStringify(parsed));
  });

  it('assigns whole books: every book has one split, and the plans add up', () => {
    const roster = realisticRoster();
    const r = assign(roster);
    expect(Object.keys(r.books).sort()).toEqual(roster.map((b) => b.book).sort());
    for (const b of Object.values(r.books)) expect(['dev', 'test']).toContain(b.split);
    expect(r.totals).toMatchObject({ books: 54, plans: 400 });
    expect(plansIn(r, 'dev') + plansIn(r, 'test')).toBe(400);
    expect(plansIn(r, 'test')).toBe(r.totals.test);
  });

  it('puts the pinned books in dev whatever the seed, and counts their plans toward dev', () => {
    for (const seed of [1, 2, 3, 20260929]) {
      const r = assign(realisticRoster(), { seed });
      for (const book of PINNED) expect(r.books[book]).toMatchObject({ split: 'dev', pinned: true });
      expect(plansIn(r, 'dev')).toBeGreaterThanOrEqual(75);
    }
    // Nothing pinned: the same books are free to go to test.
    const free = assign(realisticRoster(), { pinDev: [] });
    expect(PINNED.some((b) => free.books[b].split === 'test')).toBe(true);
    expect(free.params.pinDev).toEqual([]);
  });

  it('lands close to the share asked for: within about half a book of 150 of 400, and each stratum within one book', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 20260929]) {
      const r = assign(realisticRoster(), { seed });
      expect(Math.abs(r.totals.deviation), `seed ${seed}`).toBeLessThanOrEqual(6);
      expect(Math.abs(r.totals.test - 150), `seed ${seed}`).toBeLessThanOrEqual(6);
      for (const s of r.strata) expect(Math.abs(s.deviation), `seed ${seed} ${s.era} ${s.decade}`).toBeLessThanOrEqual(9 + 6);
    }
  });

  it('keeps both eras in both splits (the modern sites are one stratum, split by its books)', () => {
    for (const seed of [1, 2, 3, 20260929]) {
      const r = assign(realisticRoster(), { seed });
      for (const era of ['vintage', '2020-2022']) {
        for (const split of ['dev', 'test']) {
          expect(Object.values(r.books).some((b) => b.era === era && b.split === split), `seed ${seed} ${era} ${split}`).toBe(true);
        }
      }
      // Test holds a share of the modern plans close to its share overall.
      const modernTest = Object.values(r.books).filter((b) => b.era === '2020-2022' && b.split === 'test').reduce((n, b) => n + b.plans, 0);
      expect(modernTest).toBeGreaterThan(30);
      expect(modernTest).toBeLessThan(90);
    }
  });

  it('stratifies: books of a decade go to both splits where that decade has books enough', () => {
    const r = assign();
    const decade = (d, split) => Object.values(r.books).filter((b) => b.era === 'vintage' && b.decade === d && b.split === split).length;
    // Seven new-book decades with three books each, plus the 1950s and 1960s of the pinned ones.
    const mixed = [1900, 1910, 1920, 1930, 1940, 1950, 1960].filter((d) => decade(d, 'test') > 0 && decade(d, 'dev') > 0);
    expect(mixed.length).toBeGreaterThanOrEqual(4);
  });

  it('does not let the roster\'s own size change the target: the share is --target-test of --total', () => {
    const small = [row('a', 'vintage', 1960, 10), row('b', 'vintage', 1960, 10), row('c', 'vintage', 1960, 10), row('d', 'vintage', 1960, 10)];
    const r = assignSplits(small, { seed: 3, targetTest: 20, total: 40 });
    expect(r.params.share).toBe(0.5);
    expect(r.totals.test).toBe(20);
    expect(assignSplits(small, { seed: 3, targetTest: 10, total: 40 }).totals.test).toBe(10);
    expect(assignSplits(small, { seed: 3, targetTest: 0, total: 40 }).totals.test).toBe(0);
    // A share above the whole is the whole.
    expect(assignSplits(small, { seed: 3, targetTest: 400, total: 40 }).totals.test).toBe(40);
  });

  it('a stratum\'s order depends on its own books and the seed: a book added to a later stratum leaves earlier ones as they were', () => {
    const base = realisticRoster();
    const one = assign(base);
    const extended = assign([...base, row('late', '2020-2022', 2020, 9)]);
    for (const [book, b] of Object.entries(one.books)) {
      if (b.era === 'vintage') expect(extended.books[book].split, book).toBe(b.split);
    }
  });

  it('refuses a pin the roster does not hold, a missing or bad seed, and a bad target', () => {
    const roster = realisticRoster();
    expect(() => assign(roster, { pinDev: ['nosuch'] })).toThrow(/--pin-dev names nosuch, which the roster does not hold/);
    expect(() => assign(roster, { seed: undefined })).toThrow(/needs a seed/);
    expect(() => assign(roster, { seed: -1 })).toThrow(/needs a seed/);
    expect(() => assign(roster, { seed: 1.5 })).toThrow(/needs a seed/);
    expect(() => assign(roster, { total: 0 })).toThrow(/--target-test and --total must be numbers/);
  });

  it('is a fixed answer for a fixed roster and seed (what an auditor re-runs)', () => {
    const small = [
      row('alpha60', 'vintage', 1960, 8), row('beta60', 'vintage', 1960, 8), row('gamma60', 'vintage', 1960, 6),
      row('delta50', 'vintage', 1950, 8), row('epsilon50', 'vintage', 1950, 4),
      row('zeta20a', '2020-2022', 2020, 10), row('zeta20b', '2020-2022', 2020, 10), row('zeta20c', '2020-2022', 2020, 10), row('zeta20d', '2020-2022', 2020, 10),
    ];
    const r = assignSplits(small, { seed: 11, targetTest: 30, total: 84, pinDev: ['alpha60'] });
    expect(Object.fromEntries(Object.entries(r.books).map(([b, v]) => [b, v.split]))).toEqual({
      alpha60: 'dev', beta60: 'dev', gamma60: 'test', delta50: 'dev', epsilon50: 'test', zeta20a: 'test', zeta20b: 'dev', zeta20c: 'test', zeta20d: 'dev',
    });
    // 74 plans in the roster, a share of 30/84 of them: 26.4 wanted, 30 given (whole books).
    expect(r.totals).toMatchObject({ plans: 74, test: 30, dev: 44 });
    expect(r.strata.map((s) => [s.era, s.decade, s.test])).toEqual([['vintage', 1950, 4], ['vintage', 1960, 6], ['2020-2022', 2020, 20]]);
  });
});

describe('the table', () => {
  it('shows plans per era x decade and split with the deviation from the target, per split and era, and per book', () => {
    const r = assign();
    const lines = assignmentLines(r);
    expect(lines[0]).toMatch(/^assign-splits seed 20260929: 54 books, 400 plans; test target 150 of 400 \(37\.5%\), pinned to dev: legacy0,/);
    expect(lines.join('\n')).toMatch(/^era +decade +books +plans +dev +test +test target +deviation$/m);
    expect(lines.join('\n')).toMatch(/^vintage +1910s /m);
    expect(lines.join('\n')).toMatch(/^2020-2022 +2020s +16 +160 /m);
    expect(lines.join('\n')).toMatch(/^total +54 +400 +\d+ +\d+ +150\.0 +[+-]\d\.\d$/m);
    expect(lines.join('\n')).toMatch(/^split +era +books +plans$/m);
    expect(lines.join('\n')).toMatch(/^book +split +era +decade +plans +publisher$/m);
    expect(lines.join('\n')).toMatch(/^legacy0 +dev +vintage +1910 +5 +Old Press \(pinned dev\)$/m);
    expect(lines.join('\n')).not.toMatch(/WARNING/);
  });

  it('warns when a split has no plan of an era', () => {
    const r = assignSplits([row('a', 'vintage', 1960, 10), row('m', '2020-2022', 2020, 10)], { seed: 1, targetTest: 0, total: 20 });
    expect(assignmentLines(r).join('\n')).toMatch(/WARNING: no vintage plans in test: both splits must hold both eras/);
  });
});

describe('the roster of a set folder', () => {
  it('counts plans per book from the log, and for the plans that predate it from their names', () => {
    const set = makeSet();
    try {
      for (const n of ['old50-n1', 'old50-n2', 'old50-n3', 'older14-p1', 'listing-004', 'pacific25-n41', 'pacific25-n42', 'dg21-940a', 'dg21-940b', 'dg21-77a']) set.addPlan(n, newPlan(n));
      writeLog(set, [
        planEvent('pacific25-n41', { book: 'Pacific 1925', publisher: 'Pacific Ready-Cut', year: 1925, decade: 1920 }),
        planEvent('pacific25-n42', { book: 'Pacific 1925', publisher: 'Pacific Ready-Cut', year: 1925, decade: 1920 }),
        planEvent('dg21-940a', {
          book: 'Design Group', era: '2020-2022', year: 2021, decade: 2020, unit: '940', site: 'design-group.example', url: 'https://web.archive.org/web/20210101000000id_/https://x/a.png',
        }),
        planEvent('dg21-940b', {
          book: 'Design Group', era: '2020-2022', year: 2021, decade: 2020, unit: '940', site: 'design-group.example', url: 'https://web.archive.org/web/20210101000000id_/https://x/b.png',
        }),
        planEvent('dg21-77a', {
          book: 'Design Group', era: '2020-2022', year: 2021, decade: 2020, unit: '77', site: 'design-group.example', url: 'https://web.archive.org/web/20210101000000id_/https://x/c.png',
        }),
      ]);
      const { rows, warnings } = rosterFromSet(set.dir, loadCatalog(set.dir));
      // The plans of the set before the log take their book from the name's stem (a `-p101` page as well as a `-n15` one)
      // and their year from its digits; an aggregator's plans take the designer code as their book.
      expect(rows).toEqual([
        {
          book: '77', era: '2020-2022', decade: 2020, plans: 1, publisher: null, site: 'design-group.example',
        },
        {
          book: '940', era: '2020-2022', decade: 2020, plans: 2, publisher: null, site: 'design-group.example',
        },
        {
          book: 'old50', era: 'vintage', decade: 1950, plans: 3, publisher: null,
        },
        {
          book: 'older14', era: 'vintage', decade: 1910, plans: 1, publisher: null,
        },
        {
          book: 'pacific25', era: 'vintage', decade: 1920, plans: 2, publisher: 'Pacific Ready-Cut',
        },
      ]);
      expect(warnings).toEqual([expect.stringMatching(/^listing-004: no era or decade/)]);
    } finally {
      set.cleanup();
    }
  });

  it('warns of a logged plan with no file, refuses a book of two eras, and takes a book\'s decade from most of its plans', () => {
    const set = makeSet();
    try {
      for (const n of ['pacific25-n41', 'pacific25-n42', 'pacific25-n43']) set.addPlan(n, newPlan(n));
      writeLog(set, [
        planEvent('pacific25-n41', { book: 'Pacific 1925', year: 1925, decade: 1920 }),
        planEvent('pacific25-n42', { book: 'Pacific 1925', year: 1925, decade: 1920 }),
        planEvent('pacific25-n43', { book: 'Pacific 1925', year: 1929, decade: 1920 }),
        planEvent('pacific25-n50', { book: 'Pacific 1925', year: 1925, decade: 1920 }),
      ]);
      const { rows, warnings } = rosterFromSet(set.dir, loadCatalog(set.dir));
      expect(rows).toEqual([{ book: 'pacific25', era: 'vintage', decade: 1920, plans: 3, publisher: null }]);
      expect(warnings).toEqual(['pacific25-n50 is in sources.jsonl but has no plan file in the set folder: not counted']);
      writeLog(set, [
        planEvent('pacific25-n41', { book: 'Pacific 1925', year: 1925, decade: 1920 }),
        planEvent('pacific25-n42', { book: 'Pacific 1925', era: '2020-2022', year: 2021, decade: 2020, url: 'https://web.archive.org/web/20210101000000id_/https://x/a.png' }),
      ]);
      expect(() => rosterFromSet(set.dir, loadCatalog(set.dir))).toThrow(/book pacific25 holds plans of two eras/);
    } finally {
      set.cleanup();
    }
  });
});
