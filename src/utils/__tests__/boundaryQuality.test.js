import { describe, it, expect } from 'vitest';
import {
  primaryWarning, qualitySummary, rankedWarnings, warningLabel, WARNING_CODES,
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
      .toBe('a 42px opening was bridged to close the outline');
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
    expect(ranked.map((w) => w.code)).toEqual([
      'self-intersecting', 'heavy-closing', 'no-inner', 'no-alternative',
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
