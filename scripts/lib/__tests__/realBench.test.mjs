// The decisions behind `bench:real` (lib/realBench.mjs): which plans a run may
// touch and what gates the test split, how sharded results merge, the
// statistics, the aggregates, and when two runs may be compared. Pure, so no
// set and no process.
import { describe, expect, it } from 'vitest';
import {
  TEST_SPLIT_ENV, UsageError, aggregateOf, causeLine, compareRefusal, diffRuns, mergeInOrder,
  moveLines, parseArgs, quantile, resolveSelection, summaryOf, testPlansHeldWithoutManifest,
  timingOf,
} from '../realBench.mjs';

const HEX = 'b'.repeat(64);
const manifest = {
  version: 1,
  plans: {
    a1: { split: 'dev', era: 'vintage', keySha256: HEX },
    a2: { split: 'dev', era: '2020-2022', keySha256: HEX },
    a4: { split: 'dev', era: 'vintage', keySha256: HEX },
    t1: { split: 'test', era: 'vintage', keySha256: HEX },
    t2: { split: 'test', era: '2020-2022', keySha256: HEX },
  },
};
// a3 is in the folder and not in the manifest; a4 is in the manifest and not in the folder.
const names = ['a1', 'a2', 'a3', 't1', 't2'];
const watch = { lists: { porch: ['a1', 't1'], stale: ['a1', 'gone'] } };
const OK = { [TEST_SPLIT_ENV]: '1' };
const select = (argv, { env = {}, m = manifest, w = watch } = {}) => resolveSelection({
  names, manifest: m, watch: w, args: parseArgs(argv), env,
});
const namesOf = (selection, state) => selection.entries.filter((e) => !state || e.state === state).map((e) => e.name);

describe('the options', () => {
  it('read every option', () => {
    const args = parseArgs(['--dir', 'x', '--out', 'r', '--compare', 'c', '--split', 'all', '--only', 'a1,a2', '--only', 'a3',
      '--watch', 'porch', '--jobs', '8', '--manifest', 'm.json', '--draw', '--fixtures']);
    expect(args).toMatchObject({
      dir: 'x', out: 'r', compare: 'c', split: 'all', only: ['a1', 'a2', 'a3'], watch: 'porch', jobs: 8, manifest: 'm.json', draw: true, fixtures: true,
    });
  });

  it('refuse what they do not know, instead of running something else', () => {
    expect(() => parseArgs(['--splt', 'test'])).toThrow(UsageError);
    expect(() => parseArgs(['dev'])).toThrow(/unknown option dev/);
    expect(() => parseArgs(['--split', 'train'])).toThrow(/dev, test or all/);
    expect(() => parseArgs(['--split'])).toThrow(/needs a value/);
    expect(() => parseArgs(['--only', '--draw'])).toThrow(/needs a value/);
    for (const jobs of ['0', 'x', '1.5', '65', '-2']) expect(() => parseArgs(['--jobs', jobs])).toThrow(/--jobs/);
  });
});

describe('which plans a run covers', () => {
  it('is the dev split by default, and never names a test plan', () => {
    const selection = select([]);
    expect(selection.split).toBe('dev');
    expect(selection.entries.some((e) => e.split === 'test')).toBe(false);
    expect(namesOf(selection)).toEqual(['a1', 'a2', 'a3', 'a4']);
    expect(namesOf(selection, 'run')).toEqual(['a1', 'a2']);
    expect(selection.entries.some((e) => e.name.startsWith('t'))).toBe(false);
  });

  it('is refused for the test split without the variable, whichever way it is reached', () => {
    expect(() => select(['--split', 'test'])).toThrow(/only by the orchestrator/);
    expect(() => select(['--split', 'all'])).toThrow(/only by the orchestrator/);
    expect(() => select(['--only', 't1'])).toThrow(/only by the orchestrator/);
    expect(() => select(['--only', 'a1,t2'])).toThrow(/only by the orchestrator/);
    expect(() => select(['--split', 'test'], { env: { [TEST_SPLIT_ENV]: '0' } })).toThrow(/only by the orchestrator/);
    expect(() => select(['--split', 'test'], { env: { [TEST_SPLIT_ENV]: 'yes' } })).toThrow(UsageError);
  });

  it('covers the test split, or both, once the variable is set', () => {
    const test = select(['--split', 'test'], { env: OK });
    expect(test.split).toBe('test');
    expect(test.entries.filter((e) => e.state !== 'unlisted').every((e) => e.split === 'test')).toBe(true);
    expect(namesOf(test, 'run')).toEqual(['t1', 't2']);
    const all = select(['--split', 'all'], { env: OK });
    expect(all.split).toBe('all');
    expect(namesOf(all, 'run')).toEqual(['a1', 'a2', 't1', 't2']);
  });

  it('refuses names it does not know, and a plan outside the split asked for', () => {
    expect(() => select(['--only', 'a1,nope'])).toThrow(/no such plan: nope/);
    expect(() => select(['--only', 'a3'])).toThrow(/a3 is not in the manifest/);
    expect(() => select(['--only', 'a1', '--split', 'test'], { env: OK })).toThrow(/a1 is in split dev, not test/);
    expect(() => select(['--only', 'a1', '--split', 'dev'])).not.toThrow();
  });

  it('is every plan in the folder when there is no manifest, as it always was', () => {
    const selection = select([], { m: null });
    expect(selection.split).toBe('all');
    expect(namesOf(selection, 'run')).toEqual(names);
    expect(selection.entries[0]).toMatchObject({ split: null, era: null, keySha256: null });
    expect(namesOf(select(['--split', 'all'], { m: null }))).toEqual(names);
  });

  it('cannot name a split without a manifest, and still refuses unknown names', () => {
    expect(() => select(['--split', 'dev'], { m: null })).toThrow(/reads the manifest, and there is none/);
    expect(() => select(['--split', 'test'], { m: null, env: OK })).toThrow(/reads the manifest/);
    expect(() => select(['--only', 'zzz'], { m: null })).toThrow(/no such plan in the folder: zzz/);
    expect(namesOf(select(['--only', 'a2,a1'], { m: null }))).toEqual(['a1', 'a2']);
    expect(namesOf(select(['--watch', 'porch'], { m: null }))).toEqual(['a1', 't1']);
    expect(() => select(['--watch', 'stale'], { m: null })).toThrow(/gone/);
  });
});

describe('a folder with no manifest of its own', () => {
  it('holds no test plan the set\'s manifest knows, or it says how many, never which', () => {
    expect(testPlansHeldWithoutManifest(['a1', 'a2', 'zz'], manifest)).toBe(0);
    expect(testPlansHeldWithoutManifest(['a1', 't1', 't2', 'zz'], manifest)).toBe(2);
    expect(testPlansHeldWithoutManifest(['t1'], null)).toBe(0);
    expect(testPlansHeldWithoutManifest(['constructor', 'toString'], manifest)).toBe(0);
  });
});

describe('sharded results', () => {
  it('merge into the order of the plans, whichever worker finished first', () => {
    const order = ['a', 'b', 'c', 'd'];
    const merged = mergeInOrder(order, [{ name: 'c', v: 3 }, { name: 'a', v: 1 }, { name: 'd', v: 4 }, { name: 'b', v: 2 }]);
    expect(merged.map((r) => r.v)).toEqual([1, 2, 3, 4]);
  });

  it('report a plan that never came back, instead of dropping it', () => {
    const merged = mergeInOrder(['a', 'b'], [{ name: 'a', v: 1 }]);
    expect(merged[1]).toEqual({ name: 'b', error: 'no result came back from the worker' });
  });
});

describe('the trace time', () => {
  it('is the median and the 90th percentile, linear between ranks', () => {
    expect(quantile([], 0.5)).toBeNull();
    expect(quantile([7], 0.9)).toBe(7);
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([50, 10, 30, 20, 40], 0.5)).toBe(30);
    expect(quantile([10, 20, 30, 40, 50], 0.9)).toBeCloseTo(46, 9);
    expect(quantile(Array.from({ length: 11 }, (_, i) => i * 10), 0.9)).toBe(90);
  });

  it('is taken over app and bare separately, in whole milliseconds', () => {
    const rows = [1000, 1200, 1500, 2600].map((ms) => ({ app: { ms }, bare: { ms: ms + 100 } }));
    expect(timingOf(rows)).toEqual({ app: { median: 1350, p90: 2270 }, bare: { median: 1450, p90: 2370 } });
    expect(timingOf([])).toEqual({ app: null, bare: null });
  });
});

// A scored row, with what the scoreboard reads.
const row = (name, verdict, confidence, causes = {}, ms = 1000) => ({
  name,
  app: {
    verdict, confidence, ms, overNonGla: 0, overOther: 0, missed: 0, ...causes,
  },
  bare: { verdict: verdict === 'wrong' ? 'wrong' : 'near', ms: ms + 100 },
});

describe('the aggregate', () => {
  const rows = [
    row('a1', 'perfect', 0.9),
    row('a2', 'near', 0.9, { overNonGla: 0.1 }),
    row('t1', 'wrong', 0.9, { overNonGla: 0.3, overOther: 0.2, missed: 0.1 }),
    row('t2', 'wrong', 0.3),
    { name: 'bad', error: 'boom' },
    { name: 'skip', skipped: 'no key' },
  ];
  const eraOf = (name) => ({
    a1: 'vintage', a2: '2020-2022', a5: 'vintage', t1: 'vintage', t2: 'vintage',
  })[name] ?? null;

  it('counts perfect, near-perfect, and wrong but shown as good', () => {
    const { measures, plans, errors, skipped, bareNearPerfect } = aggregateOf(rows, eraOf);
    expect(plans).toBe(4);
    expect(errors).toBe(1);
    expect(skipped).toBe(1);
    expect(measures['near-perfect']).toEqual({ count: 2, share: 0.5 });
    expect(measures.perfect).toEqual({ count: 1, share: 0.25 });
    expect(measures['wrong but shown as good']).toEqual({ count: 1, share: 0.25 });
    expect(bareNearPerfect).toEqual({ count: 2, share: 0.5 });
  });

  it('means the error by cause over the scored plans', () => {
    const { causes } = summaryOf(rows.filter((r) => r.app));
    expect(causes).toEqual({ overNonGla: 0.1, overOther: 0.05, missed: 0.025 });
    expect(causeLine(summaryOf(rows.filter((r) => r.app)))).toBe(
      '   mean error by cause: non-GLA space kept 10.0%, other space taken in 5.0%, living space left out 2.5%',
    );
  });
});

describe('the verdict moves against an earlier run', () => {
  it('says better and worse, and stays quiet for a plan that did not move', () => {
    const before = [
      { name: 'p1', app: { verdict: 'wrong', iou: 0.5 } },
      { name: 'p2', app: { verdict: 'perfect', iou: 0.99 } },
      { name: 'p3', app: { verdict: 'near', iou: 0.9 } },
    ];
    const now = [row('p1', 'near', 0.9), row('p2', 'near', 0.9), row('p3', 'near', 0.9), row('p4', 'wrong', 0.9)]
      .map((r) => ({ ...r, app: { ...r.app, iou: 0.9 } }));
    const lines = moveLines(before, now, ['perfect', 'near', 'wrong']);
    expect(lines).toEqual([
      '   better p1: wrong -> near  IoU 50.0% -> 90.0%',
      '   worse  p2: perfect -> near  IoU 99.0% -> 90.0%',
    ]);
  });
});

describe('whether two run files scored the same', () => {
  const p1 = { name: 'p1', app: { verdict: 'perfect', iou: 0.99, ms: 100, rings: [[[1, 2]]] }, bare: { verdict: 'near', ms: 90 } };
  const p2 = { name: 'p2', app: { verdict: 'wrong', iou: 0.5, ms: 300 }, bare: { verdict: 'wrong', ms: 200 } };
  const run = (...results) => ({ meta: { date: 'x' }, results });

  it('says identical when only the times, the metadata and the key order differ', () => {
    const later = {
      meta: { date: 'y', jobs: 8 },
      results: [
        { bare: { ms: 5, verdict: 'near' }, app: { rings: [[[1, 2]]], ms: 7, iou: 0.99, verdict: 'perfect' }, name: 'p1' },
        { ...p2, app: { ...p2.app, ms: 1 } },
      ],
    };
    expect(diffRuns(run(p1, p2), later)).toEqual({
      plans: 2, onlyLeft: [], onlyRight: [], differing: [],
    });
  });

  it('names the plan whose number moved, and a plan only one run has', () => {
    const moved = { ...p1, app: { ...p1.app, iou: 0.98 } };
    expect(diffRuns(run(p1, p2), run(moved, p2))).toMatchObject({ differing: ['p1'] });
    expect(diffRuns(run(p1, p2), run(p1))).toMatchObject({ onlyLeft: ['p2'], onlyRight: [] });
    expect(diffRuns(run(p1), run(p1, p2))).toMatchObject({ onlyLeft: [], onlyRight: ['p2'] });
    const ring = { ...p1, app: { ...p1.app, rings: [[[1, 3]]] } };
    expect(diffRuns(run(p1), run(ring)).differing).toEqual(['p1']);
  });

  it('is not equality for a run with nothing in it: two empty or wrong files prove nothing', () => {
    expect(() => diffRuns(run(), run())).toThrow(/first run has no results/);
    expect(() => diffRuns(run(p1), run())).toThrow(/second run has no results/);
    expect(() => diffRuns(run(), run(p1))).toThrow(/first run has no results/);
    expect(() => diffRuns({ meta: {} }, run(p1))).toThrow(/first run has no results/);
    expect(() => diffRuns({ meta: {}, testAggregate: {} }, { results: 'x' })).toThrow(/no results/);
    expect(() => diffRuns(null, run(p1))).toThrow(/no results/);
  });
});

describe('comparing two runs', () => {
  const A = 'a'.repeat(64);
  const B = 'b'.repeat(64);

  it('is refused across manifests, naming both', () => {
    const message = compareRefusal({ manifestHash: A }, B, 'base');
    expect(message).toContain(A);
    expect(message).toContain(B);
    expect(message).toMatch(/base/);
  });
});
