import { describe, it, expect } from 'vitest';
import {
  primaryWarning, qualitySummary, rankedWarnings, scaleQualitySummary, warningLabel, WARNING_CODES,
} from '../boundaryQuality.js';
import { warning } from '../detection/scoring.js';

describe('primaryWarning', () => {
  it('returns null when there is nothing to report', () => {
    expect(primaryWarning(undefined)).toBeNull();
    expect(primaryWarning([])).toBeNull();
  });

  it('prefers an error over a warn regardless of push order', () => {
    const err = warning('unsealed', { cover: 0.2, solidity: 0.3 }, 'error');
    const warn = warning('heavy-closing', { radius: 12 });
    expect(primaryWarning([warn, err])).toBe(err.message);
    expect(primaryWarning([err, warn])).toBe(err.message);
  });

  it('ranks codes within one severity regardless of push order', () => {
    const worse = warning('wall-left-outside', { coverage: 0.6 });
    const milder = warning('no-inner', { floor: 0 });
    expect(primaryWarning([milder, worse])).toBe(worse.message);
    expect(primaryWarning([worse, milder])).toBe(worse.message);
  });

  it('ranks an unlisted code below every listed one but still reports it', () => {
    const unknown = warning('some-future-code');
    const listed = warning('no-inner', { floor: 0 });
    expect(primaryWarning([unknown, listed])).toBe(listed.message);
    expect(primaryWarning([unknown])).toBe(unknown.message);
  });

  it('never reports an info warning', () => {
    const info = warning('no-alternative', null, 'info');
    expect(primaryWarning([info])).toBeNull();
    expect(primaryWarning([info, warning('heavy-closing', { radius: 12 })]))
      .toBe(warning('heavy-closing', { radius: 12 }).message);
  });

  it('reports the detail text when the code has one', () => {
    expect(primaryWarning([warning('bridged-opening', { px: 42 })]))
      .toBe('a gap in the wall was bridged to close the outline');
  });

  it('picks the worst warning through qualitySummary too', () => {
    const summary = qualitySummary({
      confidence: 0.4,
      warnings: [
        warning('heavy-closing', { radius: 12 }),
        warning('self-intersecting', { floor: 0 }, 'error'),
      ],
    });
    expect(summary.level).toBe('poor');
    expect(summary.reason).toBe('the traced outline crosses itself');
    expect(summary.warnings).toHaveLength(2);
  });
});

describe('rankedWarnings', () => {
  it('agrees with primaryWarning about which warning is worst', () => {
    const list = [
      warning('no-alternative', null, 'info'),
      warning('heavy-closing', { radius: 12 }),
      warning('self-intersecting', { floor: 0 }, 'error'),
      warning('no-inner', { floor: 0 }),
    ];
    const ranked = rankedWarnings(list);
    // `no-inner` outranks `heavy-closing`: in interior mode it means the
    // outline on screen is the exterior one under an interior caption, which
    // is a wrong number rather than a note about how the trace was reached.
    expect(ranked.map((w) => w.code)).toEqual([
      'self-intersecting', 'no-inner', 'heavy-closing', 'no-alternative',
    ]);
    expect(primaryWarning(list)).toBe(ranked[0].detail);
  });

  it('keeps the index of the source array so a click cannot land elsewhere', () => {
    const list = [warning('no-inner', { floor: 0 }), warning('unsealed', null, 'error')];
    const ranked = rankedWarnings(list);
    expect(ranked[0].code).toBe('unsealed');
    expect(list[ranked[0].index].code).toBe('unsealed');
    expect(list[ranked[1].index].code).toBe('no-inner');
  });

  it('skips info notes when picking the primary, but still lists them', () => {
    const list = [warning('no-alternative', null, 'info')];
    expect(rankedWarnings(list)).toHaveLength(1);
    expect(primaryWarning(list)).toBeNull();
  });

  it('derives the scope when the tag did not survive a round trip', () => {
    const ranked = rankedWarnings([
      warning('label-outside', { count: 1, of: 3 }, 'error'),
      warning('unsealed', null, 'error'),
    ]);
    expect(ranked.find((w) => w.code === 'label-outside').scope).toBe('result');
    expect(ranked.find((w) => w.code === 'unsealed').scope).toBe('floor');
  });

  it('prefers the tag the detector attached over the derived one', () => {
    const [only] = rankedWarnings([{ ...warning('unsealed'), scope: 'result' }]);
    expect(only.scope).toBe('result');
  });

  it('gives every code a headline, including one it has never seen', () => {
    for (const code of WARNING_CODES) {
      expect(warningLabel(code), code).toBeTruthy();
    }
    expect(warningLabel('some-future-code')).toBe('Some future code');
  });
});

// The detector re-searches a trace below `REMEDIATION_CONFIDENCE`, and the UI
// calls a trace `good` at or above `QUALITY_GOOD`. They are deliberately the
// same line — a trace the detector was willing to accept is a trace the user is
// shown as finished — and `remediate.js` says so in a comment.
//
// Asserted rather than shared. Importing `boundaryQuality` into `remediate`
// would put presentation code in the worker's graph, and importing the other
// way would drag the whole remediation graph into the UI chunk. Neither edge is
// worth one number, but a comment claiming two literals agree is not worth
// anything either.
describe('the remediation and quality thresholds', () => {
  it('are the same number', async () => {
    const { QUALITY_GOOD } = await import('../boundaryQuality');
    const { REMEDIATION_CONFIDENCE } = await import('../detection/remediate.js');
    expect(REMEDIATION_CONFIDENCE).toBe(QUALITY_GOOD);
  });
});

/**
 * `detail` is the finding and is printed on the saved image, for whoever reads
 * the report. `remedy` names a control in the app, which means nothing on a
 * page in a workfile — as one sentence, the image told its reader to "click a
 * dimension".
 */
describe('scaleQualitySummary keeps the finding apart from what to do about it', () => {
  const NAMES_A_CONTROL = /choose|click|under Scale|green box|zoom in|pick a/i;
  const cases = {
    'too few rooms': { source: 'auto', reason: 'too-few-rooms', roomCount: 1, disagreement: 0 },
    'rooms disagree': { source: 'auto', reason: 'rooms-disagree', roomCount: 4, disagreement: 0.4 },
    'area implausible': { source: 'auto', reason: 'area-implausible', roomCount: 3, disagreement: 0.1 },
    'the usual consensus': { source: 'auto', roomCount: 5, disagreement: 0.08 },
    'a line against the rooms': { source: 'line', reason: 'line-vs-rooms', level: 'check', disagreement: 0.3 },
    'a short line': { source: 'line', reason: 'short-line', disagreement: 0.02, lengthPx: 40 },
    'a room against the scan': { source: 'manual', reason: 'room-vs-auto', level: 'check', roomCount: 3, disagreement: 0.3 },
    'a room adopted over earlier ones': { source: 'manual', reason: 'room-vs-project', level: 'check', adopted: true, roomCount: 2, disagreement: 0.3 },
    'a room that was outvoted': { source: 'auto', reason: 'room-vs-project', level: 'check', adopted: false, roomCount: 2, disagreement: 0.3 },
    'a room that disagrees with its own label': { source: 'manual', reason: 'room-internal', level: 'check', disagreement: 0.5 },
  };

  for (const [name, quality] of Object.entries(cases)) {
    it(`${name}: the finding names no control, and the remedy is its own sentence`, () => {
      const summary = scaleQualitySummary(quality);
      expect(summary.detail).not.toMatch(NAMES_A_CONTROL);
      expect(summary.detail.trim().endsWith('.')).toBe(true);
      expect(summary.remedy).toMatch(NAMES_A_CONTROL);
    });
  }

  // The length of the drawn line is image pixels: nothing the person who drew
  // it can do anything with.
  it('never states a length in pixels', () => {
    for (const quality of Object.values(cases)) {
      const { short, detail, remedy } = scaleQualitySummary(quality);
      expect(`${short} ${detail} ${remedy ?? ''}`).not.toMatch(/\bpx\b/);
    }
  });

  // Both messages a hand-set scale raises point at the same way back, by the
  // name the panel prints on it.
  it('sends a scale set by hand back by the name on the button', () => {
    for (const key of ['a line against the rooms', 'a room against the scan']) {
      expect(scaleQualitySummary(cases[key]).remedy).toContain('“Go back to the automatic scale”');
    }
  });
});
