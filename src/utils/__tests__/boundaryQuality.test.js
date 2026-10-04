import { describe, it, expect } from 'vitest';
import { primaryWarning, qualitySummary, scaleQualitySummary } from '../boundaryQuality.js';
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

describe('the order reasons are ranked in', () => {
  it('puts a wrong number ahead of a note about how the outline was reached', () => {
    // `no-inner` outranks `heavy-closing`: in interior mode it means the
    // outline on screen is the exterior one under an interior caption, which
    // is a wrong number rather than a note about how the trace was reached.
    const list = [
      warning('no-alternative', null, 'info'),
      warning('heavy-closing', { radius: 12 }),
      warning('no-inner', { floor: 0 }),
    ];
    expect(primaryWarning(list)).toBe(warning('no-inner', { floor: 0 }).message);
  });

  it('does not reorder the list it was handed', () => {
    const list = [warning('no-inner', { floor: 0 }), warning('unsealed', null, 'error')];
    primaryWarning(list);
    expect(list.map((w) => w.code)).toEqual(['no-inner', 'unsealed']);
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

  // Both messages a hand-set scale raises point at a button the panel has, by
  // the name printed on it.
  it('sends a scale set by hand to a button that exists, by its name', () => {
    for (const key of ['a line against the rooms', 'a room against the scan']) {
      expect(scaleQualitySummary(cases[key]).remedy).toContain('“Use a different room”');
    }
  });
});
