// The verdict of outlines against a key (scripts/lib/keyScore.mjs), on synthetic
// outlines whose IoUs are worked out by hand: the truth grid is 2 px per cell,
// and every coordinate here is even, so a polygon's cells are exact.
import { describe, expect, it } from 'vitest';
import { QUALITY_GOOD } from '../../../src/utils/boundaryQuality.js';
import { answerKey, scoreTrace } from '../realScore.mjs';
import { scoreAgainstKey, scoreLines, tracedOfJson } from '../keyScore.mjs';

const SIZE = { width: 500, height: 300 };
const rect = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const pairs = (ring) => ring.map((p) => [p.x, p.y]);
// The key: a 200 x 140 house (14,000 px2 as 7,000 cells) with a 100 x 140 garage.
const HOUSE = rect(100, 80, 300, 220);
const GARAGE = rect(300, 80, 400, 220);
const KEY = [
  { type: 'gla', closed: true, vertices: HOUSE },
  { type: 'garage', closed: true, vertices: GARAGE },
];
const score = (json, key = KEY) => scoreAgainstKey(key, SIZE, tracedOfJson(json));

describe('score: hand-computed verdicts', () => {
  it('the key scored against itself is perfect, as outlines and as rings', () => {
    const asOutlines = score({ outlines: KEY });
    expect(asOutlines).toMatchObject({
      verdict: 'perfect', iou: 1, areaErr: 0, overNonGla: 0, overOther: 0, missed: 0, floors: 1,
    });
    expect(asOutlines.regions).toEqual([]);
    // The garage is the key's, and is not the trace: left out, and said so.
    expect(asOutlines.left).toEqual([{ index: 1, type: 'garage', why: 'not a building type' }]);
    expect(asOutlines.key).toEqual(['gla', 'garage']);
    expect(asOutlines.notes.join(' ')).toMatch(/left out of the traced area: outline 1 garage \(not a building type\)/);
    const asRings = score({ rings: [pairs(HOUSE)] });
    expect(asRings).toMatchObject({ verdict: 'perfect', iou: 1, areaErr: 0 });
    expect(asRings.left).toEqual([]);
  });

  it('a copy shifted 2 px (one cell) is IoU 6,930 / 7,070 = 98.0%: perfect; shifted 4 px, 6,860 / 7,140 = 96.08%: wrong', () => {
    const shifted = (dx) => score({ rings: [pairs(rect(100 + dx, 80, 300 + dx, 220))] });
    const one = shifted(2);
    expect(one.iou).toBeCloseTo(6930 / 7070, 4);
    expect(one.verdict).toBe('perfect');
    expect(one.areaErr).toBe(0);
    // A strip two cells wide is the outline sitting on another face of the wall, not
    // a region anyone would fix: under the line, it is wrong.
    const two = shifted(4);
    expect(two.iou).toBeCloseTo(6860 / 7140, 4);
    expect(two.verdict).toBe('wrong');
    expect(two.regions).toEqual([]);
    expect(two.areaErr).toBe(0);
  });

  it('an outline merged with the garage is wrong, with the garage as the non-GLA cause', () => {
    // 300 x 140 against 200 x 140: IoU 7,000 / 10,500 = 66.67%, 50% too much, all of it the garage.
    const merged = score({ outlines: [{ type: 'gla', closed: true, vertices: rect(100, 80, 400, 220) }] });
    expect(merged.verdict).toBe('wrong');
    expect(merged.iou).toBeCloseTo(2 / 3, 4);
    expect(merged.areaErr).toBe(0.5);
    expect(merged.overNonGla).toBe(0.5);
    expect(merged.overOther).toBe(0);
    expect(merged.missed).toBe(0);
    expect(merged.regions).toEqual([{ cause: 'nonGla', share: 0.5 }]);
  });

  it('a garage a sixth of the house kept is one region a person can fix: near, not wrong; a quarter is a redraw', () => {
    // A 200 x 120 house (24,000 px2), and a strip below it kept in the trace.
    const key = (depth) => [
      { type: 'gla', closed: true, vertices: rect(100, 80, 300, 200) },
      { type: 'garage', closed: true, vertices: rect(100, 200, 300, 200 + depth) },
    ];
    // 200 x 20 = 4,000 px2 is 1/6 of the house: under the 20% a region may be.
    const kept = score({ rings: [pairs(rect(100, 80, 300, 220))] }, key(20));
    expect(kept.verdict).toBe('near');
    expect(kept.overNonGla).toBeCloseTo(1 / 6, 4);
    expect(kept.regions[0]).toMatchObject({ cause: 'nonGla', share: 0.1667 });
    // 200 x 30 = 6,000 px2 is a quarter: more than one edit's worth.
    const redraw = score({ rings: [pairs(rect(100, 80, 300, 230))] }, key(30));
    expect(redraw.verdict).toBe('wrong');
    expect(redraw.overNonGla).toBe(0.25);
    expect(redraw.regions[0]).toMatchObject({ cause: 'nonGla', share: 0.25 });
  });

  it('unfinished space is nobody\'s error: taking it in or leaving it out costs nothing', () => {
    const key = [...KEY, { type: 'unfinished', closed: true, vertices: rect(100, 220, 300, 240) }];
    expect(score({ rings: [pairs(HOUSE)] }, key)).toMatchObject({ verdict: 'perfect', areaErr: 0 });
    // The trace runs on over the unfinished strip below the house: counted in neither the truth nor the trace.
    expect(score({ rings: [pairs(rect(100, 80, 300, 240))] }, key)).toMatchObject({
      verdict: 'perfect', iou: 1, areaErr: 0, overOther: 0,
    });
  });

  it('a hole is subtracted, in both forms it is kept, unless stale', () => {
    const hole = rect(160, 120, 240, 180);
    const whole = { type: 'gla', vertices: HOUSE };
    // 80 x 60 = 4,800 px2 of 28,000: the trace less its hole is 17.14% short.
    const cut = score({ outlines: [{ ...whole, holes: [hole] }] });
    expect(cut.missed).toBeCloseTo(4800 / 28000, 4);
    expect(cut.areaErr).toBeCloseTo(-4800 / 28000, 4);
    expect(score({ outlines: [{ ...whole, holes: [{ ring: hole }] }] }).missed).toBe(cut.missed);
    expect(score({ outlines: [{ ...whole, holes: [{ ring: hole, stale: true }] }] }).verdict).toBe('perfect');
  });

  it('reads points as pairs or objects, in vertices or in points, and an untyped outline as gla', () => {
    expect(score({ outlines: [{ points: pairs(HOUSE) }] }).verdict).toBe('perfect');
    expect(score({ outlines: [{ type: 'gla', vertices: pairs(HOUSE) }] }).verdict).toBe('perfect');
    expect(score([{ vertices: HOUSE }]).verdict).toBe('perfect');
    expect(score({ outlines: [{ type: 'below-grade', points: pairs(HOUSE) }] }).counted).toEqual([{ index: 0, type: 'below-grade' }]);
  });

  it('skips an outline that is not closed or has under 3 points, and says so', () => {
    const r = score({
      outlines: [
        { type: 'gla', vertices: HOUSE },
        { type: 'gla', closed: false, vertices: rect(300, 80, 400, 220) },
        { type: 'gla', points: [[1, 1], [2, 2]] },
      ],
    });
    expect(r.verdict).toBe('perfect');
    expect(r.left.map((l) => l.why)).toEqual(['not closed', 'fewer than 3 points']);
  });

  it('several floors are the union of their outlines, counted once each', () => {
    const key = [
      { type: 'gla', closed: true, vertices: rect(20, 20, 220, 120) },
      { type: 'below-grade', closed: true, vertices: rect(20, 140, 220, 240) },
    ];
    const r = score({ rings: [pairs(rect(20, 20, 220, 120)), pairs(rect(20, 140, 220, 240))] }, key);
    expect(r).toMatchObject({ verdict: 'perfect', floors: 2, iou: 1 });
    const half = score({ rings: [pairs(rect(20, 20, 220, 120))] }, key);
    expect(half.verdict).toBe('wrong');
    expect(half.missed).toBe(0.5);
  });
});

describe('score: the same verdict as bench:real, since it is the same code', () => {
  // The floors of a trace as `bench:real` holds them, and the rings it records
  // for them: score must reach `scoreTrace`'s figures from the rings alone.
  const floors = [
    { outer: { polygon: rect(100, 80, 320, 222) }, holes: [rect(150, 120, 200, 160)] },
    { outer: { polygon: rect(330, 90, 390, 200) }, holes: [] },
  ];
  it('gives exactly scoreTrace\'s figures for the rings of a trace (holes are not in a run\'s rings)', () => {
    const noHoles = floors.map((f) => ({ ...f, holes: [] }));
    const direct = scoreTrace({ floors: noHoles, quality: { confidence: 0.912345, warnings: [{ code: 'a', severity: 'warn' }, { code: 'n', severity: 'info' }] } }, answerKey(KEY, SIZE), 0);
    const ours = score({ rings: noHoles.map((f) => pairs(f.outer.polygon)), confidence: 0.912345, warnings: ['a'] });
    for (const field of ['verdict', 'iou', 'areaErr', 'overNonGla', 'overOther', 'missed', 'regions', 'scoredAreaPx', 'floors', 'confidence', 'warnings']) {
      expect(ours[field], field).toEqual(direct[field]);
    }
    expect(direct.verdict).toBe('wrong');
  });

  it('gives the same masks from a key held as the app\'s outlines and as an exported key', () => {
    const exported = KEY.map((o) => ({ type: o.type, points: pairs(o.vertices) }));
    const ring = pairs(rect(100, 80, 400, 220));
    const a = scoreAgainstKey(KEY, SIZE, tracedOfJson({ rings: [ring] }));
    const b = scoreAgainstKey(exported, SIZE, tracedOfJson({ rings: [ring] }));
    expect(b).toEqual(a);
  });
});

describe('score: confidence and wrong-but-shown-good', () => {
  const merged = { outlines: [{ type: 'gla', closed: true, vertices: rect(100, 80, 400, 220) }] };

  it('says a wrong outline shown at QUALITY_GOOD or better is wrong but shown as good', () => {
    const shown = score({ ...merged, confidence: 0.93 });
    expect(shown).toMatchObject({ verdict: 'wrong', confidence: 0.93, level: 'good', wrongButShownGood: true });
    expect(score({ ...merged, confidence: QUALITY_GOOD }).wrongButShownGood).toBe(true);
    const doubted = score({ ...merged, confidence: 0.6 });
    expect(doubted).toMatchObject({ level: 'fair', wrongButShownGood: false });
    expect(score({ ...merged, confidence: 0.3 })).toMatchObject({ level: 'poor', wrongButShownGood: false });
  });

  it('is never wrong-but-shown-good for a right outline, whatever it is shown as', () => {
    expect(score({ rings: [pairs(HOUSE)], confidence: 0.98 })).toMatchObject({ verdict: 'perfect', wrongButShownGood: false });
  });

  it('cannot say without a confidence, and says so', () => {
    const r = score(merged);
    expect(r).toMatchObject({ confidence: null, level: null, wrongButShownGood: null });
    expect(r.notes.join(' ')).toMatch(/no confidence given/);
  });

  it('takes warning codes as strings or as {code, severity}, and leaves out an info one', () => {
    const r = score({ ...merged, warnings: ['a', { code: 'b', severity: 'error' }, { code: 'c', severity: 'info' }, 'a'] });
    expect(r.warnings).toEqual(['a', 'b']);
  });

  it('words the result: the verdict, the causes, and the wrong-but-shown-good line', () => {
    const r = score({ ...merged, confidence: 0.93, warnings: ['thin-structure-excluded'] });
    const lines = scoreLines('demo', r, { keyRecord: 'annotators: a, b; checked 2026-09-29 (AI review)' });
    expect(lines[0]).toBe('score demo: verdict WRONG   IoU 66.67%   area error +50.0% (the outlines cover more than the key\'s building)');
    expect(lines[1]).toBe('key: gla, garage   (annotators: a, b; checked 2026-09-29 (AI review))');
    expect(lines.join('\n')).toMatch(/non-GLA space kept 50\.0%, other space taken in 0\.0%, living space missed 0\.0%/);
    expect(lines.join('\n')).toMatch(/error regions, largest first: non-GLA space kept 50\.0%/);
    expect(lines.join('\n')).toMatch(/confidence 93\.0% \(good\) {3}WRONG BUT SHOWN AS GOOD/);
    expect(lines.join('\n')).toMatch(/warnings: thin-structure-excluded/);
  });
});

describe('score: what it refuses and what it warns of', () => {
  it('names a file that is not outlines or rings, and a ring that is not a ring', () => {
    expect(() => tracedOfJson(null, 'f.json')).toThrow(/f\.json must be/);
    expect(() => tracedOfJson({}, 'f.json')).toThrow(/f\.json holds no "outlines" or "rings"/);
    expect(() => tracedOfJson({ outlines: [], rings: [] }, 'f.json')).toThrow(/"outlines" or "rings", not both/);
    expect(() => tracedOfJson({ rings: [[[1, 2], [3, 4]]] }, 'f.json')).toThrow(/ring 0 is not a list of at least 3 \[x, y\] points/);
    expect(() => tracedOfJson({ rings: [[[1, 2], [3, 4], [5, 'x']]] }, 'f.json')).toThrow(/ring 0 is not a list/);
    expect(() => tracedOfJson({ outlines: [{ type: 'gla' }] }, 'f.json')).toThrow(/outline 0 \(gla\) has no "vertices" or "points"/);
    expect(() => tracedOfJson({ outlines: ['gla'] }, 'f.json')).toThrow(/outline 0 is not an object/);
    expect(() => tracedOfJson({ outlines: [], confidence: 93 }, 'f.json')).toThrow(/"confidence" must be a number from 0 to 1/);
    expect(() => tracedOfJson({ outlines: [], warnings: 'x' }, 'f.json')).toThrow(/"warnings" must be an array/);
    expect(() => tracedOfJson({ outlines: [], warnings: [3] }, 'f.json')).toThrow(/warnings\[0\]/);
  });

  it('scores a file with no building outline as wrong and says nothing was traced', () => {
    const r = score({ outlines: [{ type: 'garage', vertices: GARAGE }] });
    expect(r.verdict).toBe('wrong');
    expect(r.iou).toBe(0);
    expect(r.notes.join(' ')).toMatch(/holds no gla or below-grade outline: nothing was traced/);
  });

  it('refuses a key with no building outline to hold a trace against', () => {
    expect(() => scoreAgainstKey([{ type: 'garage', closed: true, vertices: GARAGE }], SIZE, tracedOfJson({ rings: [pairs(HOUSE)] })))
      .toThrow(/no gla or below-grade outline/);
  });

  it('warns when the outlines lie beyond the plan\'s image, as they do at another scale', () => {
    const r = score({ rings: [pairs(rect(200, 160, 600, 440))] });
    expect(r.outside).toBe(3);
    expect(r.notes.join(' ')).toMatch(/3 point\(s\) of the traced outlines lie beyond the plan's 500 x 300 px image/);
    // Right up to the page's edge, and a hair past it, is a plan cut by its crop.
    expect(score({ rings: [pairs(rect(0, 0, 501, 300))] }).outside).toBe(0);
  });
});
