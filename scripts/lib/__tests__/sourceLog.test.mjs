// The sourcing log (scripts/lib/sourceLog.mjs): what a plan, a rejection and a
// book must say to be logged, that a page cannot be rejected for how the app
// traces it, that many sourcers logging at once lose no line, and how the
// report groups the log. A scratch set folder stands in for the real one.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  BOOK_CAP, activePlanNames, buildBookEvent, buildPlanEvent, buildRejectEvent, logEvent, normalizeReason, parseBuilderLine, parseCrop, parseSize,
  readLog, regenerate, renderReport, sizeAfterFit, sourcesFiles, summarize, summaryLines,
} from '../sourceLog.mjs';
import { fakeClock } from './fakeNet.mjs';

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sourcelog-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const LINE = (name, tail = '9 labels, 6 rooms set the scale, 10.12 px/ft (high), 1 outline(s), trace ok') => `${name}: ${tail} -> C:\\set\\${name}.floorplan`;
const vintage = (over = {}) => ({
  name: 'popular63-n44a',
  book: 'Popular Homes 1963',
  publisher: 'Popular Homes Inc',
  era: 'vintage',
  year: '1963',
  leaf: '44',
  url: 'https://archive.org/download/PopularHomes1963/page/n44',
  crop: '120,340,1600,1300',
  line: LINE('popular63-n44a'),
  tag: 'src-popular',
  ...over,
});
const modern = (over = {}) => ({
  name: 'dongardner21-1234',
  book: 'dongardner.com',
  era: '2020-2022',
  year: '2021',
  url: 'https://web.archive.org/web/20210614120000id_/https://www.dongardner.com/plan/1234-floor.png',
  crop: '0,0,1800,1400',
  line: LINE('dongardner21-1234'),
  ...over,
});
const problemsOf = (fn) => {
  try {
    fn();
  } catch (error) {
    return error.message;
  }
  return null;
};

describe('reject reasons', () => {
  it('take the closed list, in the words people use for it', () => {
    for (const r of ['3d', 'elevation', 'site-plan', 'too-small', 'hand-lettered', 'not-us-home', 'duplicate-house', 'not-a-plan']) expect(normalizeReason(r)).toBe(r);
    expect(normalizeReason('3D')).toBe('3d');
    expect(normalizeReason('site plan')).toBe('site-plan');
    expect(normalizeReason('Too small')).toBe('too-small');
    expect(normalizeReason('hand lettered')).toBe('hand-lettered');
    expect(normalizeReason('not a US home')).toBe('not-us-home');
    expect(normalizeReason('duplicate house')).toBe('duplicate-house');
    expect(normalizeReason('not a plan')).toBe('not-a-plan');
    expect(normalizeReason('other: a title page with a floor plan drawn on a map')).toBe('other:a title page with a floor plan drawn on a map');
  });

  it('refuse anything else, and say what the list is', () => {
    expect(() => normalizeReason('ugly')).toThrow(/not on the list: 3d, elevation, site-plan, too-small, hand-lettered, not-us-home, duplicate-house, not-a-plan, or other:<text>/);
    expect(() => normalizeReason('')).toThrow(/not on the list/);
    expect(() => normalizeReason('other:')).toThrow(/needs its text/);
  });

  it('refuse a quality-of-trace reason, on the list or in other: text (integrity rule 6)', () => {
    for (const r of [
      'trace is wrong', 'other:the tracer fails on it', 'other: verdict was wrong', 'other:IoU too low', 'other:scored badly', 'other:no labels read',
      'other:OCR misses the sizes', 'other:the app reads it badly', 'labels not read',
    ]) {
      expect(() => normalizeReason(r), r).toThrow(/integrity rule 6/);
    }
    // Words that only look like them are fine.
    expect(normalizeReason('other:title page of an appliance catalogue')).toBe('other:title page of an appliance catalogue');
  });
});

describe('the pieces of a plan event', () => {
  it('reads a crop as four whole numbers, x and y from 0', () => {
    expect(parseCrop('120,340,1600,1300')).toEqual([120, 340, 1600, 1300]);
    expect(parseCrop('0,0,800,600')).toEqual([0, 0, 800, 600]);
    expect(parseCrop([1, 2, 3, 4])).toEqual([1, 2, 3, 4]);
    for (const bad of ['1,2,3', '1,2,3,4,5', '1,2,0,4', '1,2,3,-4', '-1,2,3,4', '1.5,2,3,4', 'a,b,c,d', '', '1,,3,4']) expect(() => parseCrop(bad), bad).toThrow(/crop/);
  });

  it('reads a size', () => {
    expect(parseSize('1600,1300')).toEqual([1600, 1300]);
    expect(parseSize('1600x1300')).toEqual([1600, 1300]);
    for (const bad of ['1600', '0,5', '1,2,3', 'wide,tall']) expect(() => parseSize(bad), bad).toThrow(/size/);
  });

  it('works out the size a draft comes out at, as the app\'s loader scales it', () => {
    expect(sizeAfterFit([0, 0, 1600, 1300])).toEqual([1600, 1300]);
    expect(sizeAfterFit([0, 0, 4000, 4000])).toEqual([4000, 4000]);
    expect(sizeAfterFit([10, 10, 6000, 3000])).toEqual([4000, 2000]);
    expect(sizeAfterFit([0, 0, 3000, 8000])).toEqual([1500, 4000]);
  });

  it('reads the builder line realDrafts prints', () => {
    expect(parseBuilderLine(LINE('a63-n1'))).toEqual({
      name: 'a63-n1', labels: 9, cutOff: 0, rooms: 6, scale: '10.12 px/ft (high)', outlines: 1, level: 'ok',
    });
    expect(parseBuilderLine(LINE('a63-n1', '14 labels (2 regions cut off), 5 rooms set the scale, 8.00 px/ft (medium), 2 outline(s), trace review'))).toMatchObject({
      labels: 14, cutOff: 2, rooms: 5, scale: '8.00 px/ft (medium)', outlines: 2, level: 'review',
    });
    expect(parseBuilderLine(LINE('a63-n1', '0 labels, 0 rooms set the scale, no scale, 1 outline(s), trace failed'))).toMatchObject({ labels: 0, scale: 'no scale' });
    expect(parseBuilderLine('a63-n1: already there (--force replaces it)')).toBeNull();
    expect(parseBuilderLine('')).toBeNull();
  });
});

describe('a plan event', () => {
  const build = (input, options = {}) => buildPlanEvent(input, { clock: fakeClock(), ...options });

  it('takes a vintage plan and records what the builder line says', () => {
    const { event, warnings } = build(vintage());
    expect(event).toMatchObject({
      event: 'plan', name: 'popular63-n44a', book: 'Popular Homes 1963', publisher: 'Popular Homes Inc', era: 'vintage', year: 1963, decade: 1960, leaf: 44,
      url: 'https://archive.org/download/PopularHomes1963/page/n44', crop: [120, 340, 1600, 1300], size: [1600, 1300], labels: 9, scale: '10.12 px/ft (high)',
      cutOff: 0, tag: 'src-popular',
    });
    expect(event.at).toBe(new Date(fakeClock().now()).toISOString());
    expect(event.line).toContain('9 labels');
    expect(warnings).toEqual([]);
  });

  it('takes a modern plan, its leaf null', () => {
    const { event } = build(modern());
    expect(event).toMatchObject({ era: '2020-2022', year: 2021, decade: 2020, leaf: null, publisher: null });
  });

  it('takes the leaf from a vintage name that carries it', () => {
    expect(build(vintage({ leaf: undefined })).event.leaf).toBe(44);
  });

  it('refuses a name of the wrong shape for its era', () => {
    expect(problemsOf(() => build(vintage({ name: 'popular63-44' })))).toMatch(/must look like <book><yy>-n<leaf>/);
    expect(problemsOf(() => build(vintage({ name: 'Popular63-n44' })))).toMatch(/must look like <book><yy>-n<leaf>/);
    expect(problemsOf(() => build(vintage({ name: 'popular-n44' })))).toMatch(/must look like/);
    expect(problemsOf(() => build(vintage({ name: 'popular63-n44c' })))).toMatch(/must look like/);
    expect(problemsOf(() => build(modern({ name: 'dongardner-1234' })))).toMatch(/must look like <site><yy>-<plan id>/);
    expect(problemsOf(() => build(modern({ name: 'dongardner21-12 34' })))).toMatch(/must look like/);
    expect(problemsOf(() => build(modern({ name: 'dongardner21-Plan_1234.a-b' })))).toMatch(/must look like/);
    expect(build(modern({ name: 'dongardner21-plan_12.4-b', line: LINE('dongardner21-plan_12.4-b') })).event.name).toBe('dongardner21-plan_12.4-b');
  });

  it('refuses a name whose year or leaf is not the entry\'s', () => {
    expect(problemsOf(() => build(vintage({ year: '1957' })))).toMatch(/carries the year 63, but --year is 1957/);
    expect(problemsOf(() => build(vintage({ leaf: '45' })))).toMatch(/says leaf 44, but --leaf is 45/);
    expect(problemsOf(() => build(vintage({ url: 'https://archive.org/download/PopularHomes1963/page/n45.jpg' })))).toMatch(/--url is leaf 45, but the leaf is 44/);
  });

  it('needs era and year to agree', () => {
    expect(problemsOf(() => build(modern({ year: '2019', name: 'dongardner19-1234' })))).toMatch(/2020 to 2022 \(got 2019\)/);
    expect(problemsOf(() => build(modern({ year: '2023', name: 'dongardner23-1234', url: 'https://web.archive.org/web/20230101000000id_/https://x.com/a.png' })))).toMatch(/2020 to 2022 \(got 2023\)/);
    expect(problemsOf(() => build(vintage({ era: 'vintage', year: '2021', name: 'popular21-n44a' })))).toMatch(/vintage needs a year before 2020/);
    expect(problemsOf(() => build(vintage({ era: 'old' })))).toMatch(/--era must be vintage or 2020-2022/);
    expect(problemsOf(() => build(vintage({ decade: '1950' })))).toMatch(/--decade 1950 does not hold the year 1963/);
    expect(build(vintage({ decade: '1960' })).event.decade).toBe(1960);
  });

  it('needs a modern plan to name the capture\'s original bytes, in the year it says', () => {
    expect(problemsOf(() => build(modern({ url: 'https://web.archive.org/web/20210614120000/https://www.dongardner.com/plan/1234.png' })))).toMatch(/original-bytes URL/);
    expect(problemsOf(() => build(modern({ url: 'https://www.dongardner.com/plan/1234.png' })))).toMatch(/refused www\.dongardner\.com/);
    expect(problemsOf(() => build(modern({ url: 'https://web.archive.org/web/20220614120000id_/https://x.com/a.png' })))).toMatch(/capture from 2022, but --year is 2021/);
  });

  it('refuses a URL off the allowlist, for either era', () => {
    expect(problemsOf(() => build(vintage({ url: 'https://example.com/page/n44' })))).toMatch(/refused example\.com/);
  });

  it('refuses a crop that is not four whole numbers', () => {
    expect(problemsOf(() => build(vintage({ crop: '1,2,3' })))).toMatch(/crop/);
    expect(problemsOf(() => build(vintage({ crop: undefined })))).toMatch(/crop/);
  });

  it('refuses a name already logged unless --replace, and names every problem at once', () => {
    expect(problemsOf(() => build(vintage(), { activeNames: new Set(['popular63-n44a']) }))).toMatch(/already logged \(--replace/);
    expect(build(vintage(), { activeNames: new Set(['popular63-n44a']), replace: true }).event.name).toBe('popular63-n44a');
    const message = problemsOf(() => build({ name: 'x', era: 'vintage' }));
    expect(message).toMatch(/--book is needed/);
    expect(message).toMatch(/--line is needed/);
    expect(message).toMatch(/--url is needed/);
    expect(message).toMatch(/--year is needed/);
    expect(message.split('; ').length).toBeGreaterThan(4);
  });

  it('needs the builder line, whole, and for this plan', () => {
    expect(problemsOf(() => build(vintage({ line: 'popular63-n44a: already there (--force replaces it)' })))).toMatch(/not a line realDrafts prints/);
    expect(problemsOf(() => build(vintage({ line: LINE('popular63-n45a') })))).toMatch(/--line is for popular63-n45a, not popular63-n44a/);
  });

  it('warns of a draft that needs another look, but logs it', () => {
    const cut = build(vintage({ line: LINE('popular63-n44a', '9 labels (3 regions cut off), 6 rooms set the scale, 10.12 px/ft (high), 1 outline(s), trace ok') }));
    expect(cut.event.cutOff).toBe(3);
    expect(cut.warnings.join('\n')).toMatch(/3 regions were cut off: draft it again with --force/);
    const none = build(vintage({ line: LINE('popular63-n44a', '0 labels, 0 rooms set the scale, no scale, 1 outline(s), trace failed') }));
    expect(none.warnings.join('\n')).toMatch(/no labels were read: check the crop/);
    expect(none.warnings.join('\n')).toMatch(/no scale was set/);
    expect(none.event.labels).toBe(0);
    expect(build(vintage({ crop: '0,0,900,700' })).warnings.join('\n')).toMatch(/900x700, under about 1000 px across: that breaks an inclusion rule \(too-small\)/);
  });

  it('sizes a draft from its crop when no size is given, scaled as the app scales', () => {
    expect(build(vintage({ crop: '0,0,6000,3000' })).event.size).toEqual([4000, 2000]);
    expect(build(vintage({ size: '1600,1300' })).event.size).toEqual([1600, 1300]);
  });

  describe('against the plan in the set folder', () => {
    const plan = (name, source) => fs.writeFileSync(path.join(dir, `${name}.floorplan`), JSON.stringify({ fileType: 'floorplan', source, floors: [] }));

    it('warns when the plan is not there yet', () => {
      expect(build(vintage(), { dir }).warnings.join('\n')).toMatch(/no plan named popular63-n44a in the set folder yet/);
    });

    it('takes the size the plan records, and accepts a log that agrees', () => {
      plan('popular63-n44a', { url: vintage().url, crop: [120, 340, 1600, 1300], size: [1600, 1300] });
      const { event, warnings } = build(vintage({ crop: '120,340,1600,1300' }), { dir });
      expect(event.size).toEqual([1600, 1300]);
      expect(warnings).toEqual([]);
      plan('popular63-n44a', { url: vintage().url, crop: [120, 340, 4200, 3000], size: [4000, 2857] });
      expect(build(vintage({ crop: '120,340,4200,3000' }), { dir }).event.size).toEqual([4000, 2857]);
    });

    it('refuses a log that says something else than the plan does', () => {
      plan('popular63-n44a', { url: 'https://archive.org/download/PopularHomes1963/page/n40', crop: [0, 0, 1600, 1300], size: [1500, 1200] });
      const message = problemsOf(() => build(vintage(), { dir }));
      expect(message).toMatch(/was drafted from https:\/\/archive\.org\/download\/PopularHomes1963\/page\/n40, not/);
      expect(message).toMatch(/drafted with crop 0,0,1600,1300, not 120,340,1600,1300/);
      expect(problemsOf(() => build(vintage({ size: '1600,1300' }), { dir }))).toMatch(/is 1500x1200, not 1600x1300/);
      // ... unless asked not to look.
      expect(build(vintage(), { dir, verify: false }).event.name).toBe('popular63-n44a');
    });

    it('says when the plan records no source, or cannot be read', () => {
      plan('popular63-n44a', undefined);
      expect(build(vintage(), { dir }).warnings.join('\n')).toMatch(/records no source/);
      fs.writeFileSync(path.join(dir, 'popular63-n44a.floorplan'), '{ not json');
      expect(build(vintage(), { dir }).warnings.join('\n')).toMatch(/could not be read/);
    });
  });
});

describe('reject and book events', () => {
  it('log a page by leaf or by URL, with a reason from the list', () => {
    const clock = fakeClock();
    expect(buildRejectEvent({ book: 'Popular Homes 1963', leaf: '12', reason: '3D', tag: 't' }, { clock })).toMatchObject({
      event: 'reject', book: 'Popular Homes 1963', leaf: 12, url: null, reason: '3d', tag: 't',
    });
    expect(buildRejectEvent({ book: 'dongardner.com', url: 'https://web.archive.org/web/20210614120000id_/https://x.com/a.png', reason: 'not a plan' }, { clock })).toMatchObject({
      leaf: null, reason: 'not-a-plan',
    });
  });

  it('need a book, a page and a reason, and say which is missing', () => {
    const message = problemsOf(() => buildRejectEvent({}));
    expect(message).toMatch(/--book is needed/);
    expect(message).toMatch(/--leaf N or --url URL/);
    expect(message).toMatch(/not on the list/);
    expect(problemsOf(() => buildRejectEvent({ book: 'b', leaf: '3', reason: 'the trace was poor' }))).toMatch(/integrity rule 6/);
    expect(problemsOf(() => buildRejectEvent({ book: 'b', url: 'https://example.com/x.png', reason: '3d' }))).toMatch(/refused example\.com/);
  });

  it('log a book with what is known of it', () => {
    expect(buildBookEvent({
      book: 'Pacific 1925', id: 'PacificBook', publisher: 'Pacific Ready-Cut Homes', year: '1925', leaves: '164', note: 'typeset sizes',
    }, { clock: fakeClock() })).toMatchObject({ event: 'book', book: 'Pacific 1925', id: 'PacificBook', year: 1925, leaves: 164, note: 'typeset sizes' });
    expect(problemsOf(() => buildBookEvent({}))).toMatch(/--book is needed/);
    expect(problemsOf(() => buildBookEvent({ book: 'b', leaves: 'many' }))).toMatch(/--leaves "many" must be a whole number/);
  });
});

describe('the log file', () => {
  const log = (kind, input, options = {}) => {
    const clock = options.clock ?? fakeClock();
    return clock.run(logEvent(kind, input, { dir, clock, ...options }));
  };

  it('appends one JSON line per event and regenerates the report', async () => {
    const { files, warnings } = await log('plan', vintage());
    expect(files.jsonl).toBe(path.join(dir, 'orchestration', 'sources.jsonl'));
    expect(files.md).toBe(path.join(dir, 'orchestration', 'sources.md'));
    expect(warnings.join('\n')).toMatch(/no plan named/);
    await log('reject', { book: 'Popular Homes 1963', leaf: '12', reason: 'elevation' });
    await log('book', { book: 'Popular Homes 1963', id: 'PopularHomes1963', leaves: '90' });
    const lines = fs.readFileSync(files.jsonl, 'utf8').trimEnd().split('\n').map((l) => JSON.parse(l));
    expect(lines.map((l) => l.event)).toEqual(['plan', 'reject', 'book']);
    const md = fs.readFileSync(files.md, 'utf8');
    expect(md).toContain('## Popular Homes 1963');
    expect(md).toContain('popular63-n44a');
    expect(md).toContain('leaf 12: elevation');
  });

  it('refuses a duplicate name, and with --replace keeps the old line, marked superseded', async () => {
    await log('plan', vintage());
    await expect(log('plan', vintage({ crop: '100,300,1700,1400' }))).rejects.toThrow(/already logged/);
    expect(fs.readFileSync(sourcesFiles(dir).jsonl, 'utf8').trimEnd().split('\n')).toHaveLength(1);

    const clock = fakeClock();
    clock.advance(60000);
    const { event } = await log('plan', vintage({ crop: '100,300,1700,1400' }), { replace: true, clock });
    const lines = fs.readFileSync(sourcesFiles(dir).jsonl, 'utf8').trimEnd().split('\n').map((l) => JSON.parse(l));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ name: 'popular63-n44a', crop: [120, 340, 1600, 1300], superseded: event.at });
    expect(lines[1].crop).toEqual([100, 300, 1700, 1400]);
    expect(lines[1].superseded).toBeUndefined();
    expect([...activePlanNames(readLog(sourcesFiles(dir).jsonl).events)]).toEqual(['popular63-n44a']);
    expect(fs.readFileSync(sourcesFiles(dir).md, 'utf8')).toContain('## Superseded entries');
  });

  it('keeps a torn last line out of the next one', async () => {
    const files = sourcesFiles(dir);
    fs.mkdirSync(path.dirname(files.jsonl), { recursive: true });
    fs.writeFileSync(files.jsonl, `${JSON.stringify({ event: 'book', book: 'B' })}\n{"event":"pla`);
    await log('reject', { book: 'B', leaf: '2', reason: 'not-a-plan' });
    const { events, raw } = readLog(files.jsonl);
    expect(raw).toHaveLength(3);
    expect(events.map((e) => e?.event ?? null)).toEqual(['book', null, 'reject']);
  });

  it('loses no line when many sourcers log at once', async () => {
    const clock = fakeClock();
    const jobs = [];
    for (let i = 1; i <= 12; i += 1) {
      jobs.push(logEvent('plan', vintage({
        name: `popular63-n${100 + i}`, leaf: String(100 + i), url: `https://archive.org/download/PopularHomes1963/page/n${100 + i}`, line: LINE(`popular63-n${100 + i}`),
      }), { dir, clock }));
      jobs.push(logEvent('reject', { book: 'Popular Homes 1963', leaf: String(i), reason: 'site plan' }, { dir, clock }));
    }
    await clock.run(Promise.all(jobs));
    const { events, raw } = readLog(sourcesFiles(dir).jsonl);
    expect(raw).toHaveLength(24);
    expect(events.every(Boolean)).toBe(true);
    expect(new Set(events.filter((e) => e.event === 'plan').map((e) => e.name)).size).toBe(12);
    expect(fs.existsSync(sourcesFiles(dir).lock)).toBe(false);
  });

  it('does not write an event it refuses, and does not leave the lock', async () => {
    await expect(log('reject', { book: 'B', leaf: '2', reason: 'the trace was poor' })).rejects.toThrow(/integrity rule 6/);
    expect(fs.existsSync(sourcesFiles(dir).jsonl)).toBe(false);
    expect(fs.existsSync(sourcesFiles(dir).lock)).toBe(false);
    await expect(log('sketch', {})).rejects.toThrow(/unknown event/);
  });

  it('regenerates the report from the log on its own', async () => {
    await log('plan', vintage());
    fs.rmSync(sourcesFiles(dir).md);
    const clock = fakeClock();
    const { events, files } = await clock.run(regenerate({ dir, clock }));
    expect(events).toHaveLength(1);
    expect(fs.existsSync(files.md)).toBe(true);
  });
});

describe('the report', () => {
  const at = '2026-09-29T00:00:00.000Z';
  const plan = (name, book, era, over = {}) => ({
    event: 'plan', at, name, book, publisher: 'P', era, year: era === 'vintage' ? 1963 : 2021, leaf: era === 'vintage' ? 5 : null,
    url: era === 'vintage' ? 'https://archive.org/download/x/page/n5' : 'https://web.archive.org/web/20210101000000id_/https://s.com/a.png',
    crop: [1, 2, 3, 4], size: [3, 4], labels: 7, scale: '9.00 px/ft (high)', cutOff: 0, line: `${name}: 7 labels | odd`, ...over,
  });
  const events = [
    { event: 'book', book: 'Popular Homes 1963', id: 'PopularHomes1963', publisher: 'Popular Homes Inc', year: 1963, leaves: 90, note: 'typeset sizes' },
    plan('popular63-n5', 'Popular Homes 1963', 'vintage'),
    plan('popular63-n6', 'Popular Homes 1963', 'vintage'),
    plan('gardner21-1', 'gardner.com', '2020-2022'),
    { event: 'reject', at, book: 'Popular Homes 1963', leaf: 9, url: null, reason: '3d', tag: 't1' },
    { event: 'reject', at, book: 'gardner.com', leaf: null, url: 'https://web.archive.org/web/20210101000000id_/https://s.com/b.png', reason: 'not-a-plan', tag: null },
    { event: 'reject', at, book: 'Never Drafted Book', leaf: 3, url: null, reason: 'hand-lettered', tag: null },
    plan('old63-n1', 'Popular Homes 1963', 'vintage', { superseded: at }),
  ];

  it('counts per book and per era, leaving out what was superseded', () => {
    const s = summarize(events);
    expect(s.total).toBe(3);
    expect(s.rejected).toBe(3);
    expect(s.eras).toEqual([
      { era: 'vintage', books: 1, plans: 2, rejects: 1 },
      { era: '2020-2022', books: 1, plans: 1, rejects: 1 },
    ]);
    expect(s.groups.map((g) => [g.book, g.plans.length])).toEqual([
      ['Popular Homes 1963', 2], ['gardner.com', 1], ['Never Drafted Book', 0],
    ]);
    expect(s.superseded).toHaveLength(1);
    expect(s.overCap).toEqual([]);
  });

  it('flags a book over the cap of 12', () => {
    const many = Array.from({ length: BOOK_CAP + 1 }, (_, i) => plan(`big63-n${i + 1}`, 'Big Book', 'vintage', { leaf: i + 1 }));
    const s = summarize(many);
    expect(s.overCap.map((g) => g.book)).toEqual(['Big Book']);
    expect(summaryLines(many).join('\n')).toMatch(/Big Book: 13 plans, 0 rejected\s+OVER THE CAP OF 12/);
    expect(summaryLines(many).join('\n')).toMatch(/OVER THE CAP OF 12: Big Book \(13\)/);
    expect(renderReport(many, { at })).toMatch(/Over the cap of 12 plans from one book or site:\*\* Big Book \(13\)/);
    expect(summaryLines(events).join('\n')).toMatch(/no book or site over the cap of 12/);
  });

  it('writes plans by book with their sources, then the rejections, then the totals', () => {
    const md = renderReport(events, { at });
    expect(md).toContain('| vintage | 1 | 2 | 1 |');
    expect(md).toContain('| 2020-2022 | 1 | 1 | 1 |');
    expect(md).toContain('| **all** | 2 | 3 | 3 |');
    expect(md).toContain('## Popular Homes 1963 (vintage, 1963, Popular Homes Inc, id PopularHomes1963, 90 leaves)');
    expect(md).toContain('typeset sizes');
    // A vintage plan is found by leaf, a modern one by its URL; a pipe in a cell cannot break the table.
    expect(md).toContain('| popular63-n5 | n5 | 1,2,3,4 | 3x4 | 7 | 0 | 9.00 px/ft (high) | popular63-n5: 7 labels \\| odd |');
    expect(md).toContain('| gardner21-1 | https://web.archive.org/web/20210101000000id_/https://s.com/a.png |');
    expect(md).toContain('- leaf 9: 3d (t1)');
    expect(md).toContain('- https://web.archive.org/web/20210101000000id_/https://s.com/b.png: not-a-plan');
    expect(md).toContain('## Never Drafted Book');
    expect(md).toContain('- old63-n1 logged');
    expect(md.indexOf('## Popular Homes 1963')).toBeLessThan(md.indexOf('## gardner.com'));
  });
});
