import { describe, it, expect } from 'vitest';
import { primaryWarning, qualitySummary } from '../boundaryQuality.js';
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
