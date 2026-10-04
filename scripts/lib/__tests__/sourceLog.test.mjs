// The sourcing log (scripts/lib/sourceLog.mjs): what a plan, a rejection and a
// book must say to be logged, that a page cannot be rejected for how the app
// traces it, that many sourcers logging at once lose no line, and how the
// report groups the log. A scratch set folder stands in for the real one.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  activePlanNames, buildPlanEvent, logEvent, normalizeReason, readLog, sourcesFiles,
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
const problemsOf = (fn) => {
  try {
    fn();
  } catch (error) {
    return error.message;
  }
  return null;
};

describe('reject reasons', () => {
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

describe('a plan event', () => {
  const build = (input, options = {}) => buildPlanEvent(input, { clock: fakeClock(), ...options });

  describe('against the plan in the set folder', () => {
    const plan = (name, source) => fs.writeFileSync(path.join(dir, `${name}.floorplan`), JSON.stringify({ fileType: 'floorplan', source, floors: [] }));

    it('refuses a log that says something else than the plan does', () => {
      plan('popular63-n44a', { url: 'https://archive.org/download/PopularHomes1963/page/n40', crop: [0, 0, 1600, 1300], size: [1500, 1200] });
      const message = problemsOf(() => build(vintage(), { dir }));
      expect(message).toMatch(/was drafted from https:\/\/archive\.org\/download\/PopularHomes1963\/page\/n40, not/);
      expect(message).toMatch(/drafted with crop 0,0,1600,1300, not 120,340,1600,1300/);
      expect(problemsOf(() => build(vintage({ size: '1600,1300' }), { dir }))).toMatch(/is 1500x1200, not 1600x1300/);
      // ... unless asked not to look.
      expect(build(vintage(), { dir, verify: false }).event.name).toBe('popular63-n44a');
    });
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
});
