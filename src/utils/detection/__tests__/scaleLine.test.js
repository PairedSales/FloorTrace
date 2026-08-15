// A scale asserted by drawing a line and stating its true length. One line
// gives one equation in two unknowns, so which of the three readings applies
// is the whole design — and the precedence guard beside it is the bug fix:
// without it a re-scan silently replaces a number the user typed.
import { describe, expect, it } from 'vitest';
import {
  resolveLineScale,
  classifyScaleLine,
  isUserAsserted,
  PINNED_SOURCES,
  MIN_CONFIDENT_SCALE_LINE_PX,
  resolveScaleUpdate,
} from '../validate.js';
import { scaleQualitySummary } from '../../boundaryQuality.js';

const line = (dx, dy, feet, x0 = 0, y0 = 0) => ({
  id: `l${dx}x${dy}`,
  start: { x: x0, y: y0 },
  end: { x: x0 + dx, y: y0 + dy },
  feet,
});

const deg = (d, len = 200) => ({
  dx: len * Math.cos((d * Math.PI) / 180),
  dy: len * Math.sin((d * Math.PI) / 180),
});

describe('classifyScaleLine', () => {
  it('splits axis from diagonal at 5 degrees', () => {
    const under = deg(4.9);
    const over = deg(5.1);
    expect(classifyScaleLine(line(under.dx, under.dy, 10))).toBe('x');
    expect(classifyScaleLine(line(over.dx, over.dy, 10))).toBe('diagonal');
    // and the same either side of vertical
    expect(classifyScaleLine(line(under.dy, under.dx, 10))).toBe('y');
    expect(classifyScaleLine(line(over.dy, over.dx, 10))).toBe('diagonal');
  });

  it('costs under 0.4% to read a 5 degree line as an axis length', () => {
    const { dx, dy } = deg(5);
    const L = 24;
    const isotropic = L / Math.hypot(dx, dy);
    const asAxis = L / Math.abs(dx);
    expect(Math.abs(asAxis / isotropic - 1)).toBeLessThan(0.004);
  });
});

describe('resolveLineScale — one line', () => {
  it('reads a diagonal isotropically', () => {
    const r = resolveLineScale({ lines: [line(300, 400, 50)] });
    expect(r.scale.x).toBe(r.scale.y);
    // hypot is 500 px for 50 ft
    expect(r.scale.x).toBeCloseTo(0.1, 12);
    expect(r.quality.lineCount).toBe(1);
    expect(r.quality.source).toBe('line');
    expect(r.quality.axes).toEqual(['diagonal']);
  });

  it('reads a single axis line isotropically too', () => {
    const r = resolveLineScale({ lines: [line(200, 0, 20)] });
    expect(r.scale).toEqual({ x: 0.1, y: 0.1 });
    expect(r.quality.reason).toBe(null);
    expect(r.quality.level).toBe('ok');
  });
});

describe('resolveLineScale — two perpendicular lines', () => {
  // The invariance the whole design rests on: area is exactly linear in sx*sy,
  // so collapsing an agreeing pair to their geometric mean must leave the
  // product — and therefore every reported area — untouched.
  it('collapses an agreeing pair to the geometric mean at unchanged sx*sy', () => {
    const sx = 10 / 100;
    const sy = 10.2 / 100;
    const r = resolveLineScale({
      lines: [line(100, 0, 10), line(0, 100, 10.2)],
    });
    expect(r.scale.x).toBe(r.scale.y);
    expect(r.scale.x).toBeCloseTo(Math.sqrt(sx * sy), 12);
    expect(r.scale.x * r.scale.y).toBeCloseTo(sx * sy, 12);
    expect(r.quality.lineCount).toBe(2);
    expect(r.quality.reason).toBe(null);
  });

  it('keeps both scalars and says so when they disagree past tolerance', () => {
    const r = resolveLineScale({
      lines: [line(100, 0, 10), line(0, 100, 12)],
    });
    expect(r.scale.x).toBeCloseTo(0.1, 12);
    expect(r.scale.y).toBeCloseTo(0.12, 12);
    expect(r.quality.reason).toBe('scale-anisotropic');
    expect(r.quality.axes).toEqual(['x', 'y']);
  });
});

describe('resolveLineScale — superseding', () => {
  it('treats a second parallel line as a fresh assertion, not a new axis', () => {
    const r = resolveLineScale({
      lines: [line(100, 0, 10), line(200, 0, 25)],
    });
    expect(r.quality.lineCount).toBe(1);
    expect(r.scale.x).toBe(r.scale.y);
    expect(r.scale.x).toBeCloseTo(0.125, 12);
  });

  it('lets a diagonal supersede the axis pair drawn before it', () => {
    const r = resolveLineScale({
      lines: [line(100, 0, 10), line(0, 100, 12), line(300, 400, 50)],
    });
    expect(r.quality.lineCount).toBe(1);
    expect(r.scale).toEqual({ x: 0.1, y: 0.1 });
    expect(r.quality.reason).toBe(null);
  });
});

describe('resolveLineScale — quality', () => {
  it('warns below the confident-length floor and states the percentage', () => {
    const short = resolveLineScale({ lines: [line(99, 0, 8)] });
    expect(short.quality.reason).toBe('short-line');
    expect(short.quality.lengthPx).toBe(99);
    expect(scaleQualitySummary(short.quality).detail).toContain('about 2%');

    const atFloor = resolveLineScale({ lines: [line(MIN_CONFIDENT_SCALE_LINE_PX, 0, 8)] });
    expect(atFloor.quality.reason).toBe(null);
  });

  it('reports a gap against the measured rooms without applying it', () => {
    const rooms = [0.12, 0.12, 0.12, 0.12];
    const r = resolveLineScale({ lines: [line(200, 0, 20)], roomSamples: rooms });
    expect(r.scale.x).toBeCloseTo(0.1, 12);
    expect(r.quality.reason).toBe('line-vs-rooms');
    expect(r.quality.level).toBe('note');

    const far = resolveLineScale({ lines: [line(200, 0, 20)], roomSamples: [0.15, 0.15, 0.15, 0.15] });
    expect(far.quality.level).toBe('check');
    expect(far.scale.x).toBeCloseTo(0.1, 12);
  });

  it('returns null for a length that is not a length', () => {
    expect(resolveLineScale({ lines: [] })).toBe(null);
    expect(resolveLineScale({ lines: [line(100, 0, 0)] })).toBe(null);
    expect(resolveLineScale({ lines: [line(100, 0, -5)] })).toBe(null);
    expect(resolveLineScale({ lines: [line(0, 0, 10)] })).toBe(null);
  });

  it('reports changed against the calibration in force', () => {
    const first = resolveLineScale({ lines: [line(200, 0, 20)] });
    expect(first.changed).toBe(true);
    const held = { calibrated: true, feetPerPixel: first.scale, quality: first.quality };
    expect(resolveLineScale({ lines: [line(200, 0, 20)], calibration: held }).changed).toBe(false);
  });
});

// The panel line is the only durable statement of where the number came from
// once the toast has gone, and a clean line calibration carries no `reason` —
// so the ordering inside scaleQualitySummary is what makes it appear at all.
describe('scaleQualitySummary for a line calibration', () => {
  it('renders a clean line calibration rather than nothing', () => {
    const r = resolveLineScale({ lines: [line(200, 0, 20)] });
    expect(r.quality.level).toBe('ok');
    expect(r.quality.reason).toBe(null);
    const summary = scaleQualitySummary(r.quality);
    expect(summary).not.toBe(null);
    expect(summary.short).toBe('Scale set by hand');
    expect(summary.detail).toContain('20 ft line');
  });

  it('names both directions when two lines are in force', () => {
    const r = resolveLineScale({ lines: [line(100, 0, 10), line(0, 100, 12)] });
    expect(scaleQualitySummary(r.quality).short).toContain('differ by');
  });
});

describe('isUserAsserted', () => {
  it('covers both gestures the user can make and nothing else', () => {
    expect(isUserAsserted({ quality: { source: 'line' } })).toBe(true);
    expect(isUserAsserted({ quality: { source: 'manual' } })).toBe(true);
    expect(isUserAsserted({ quality: { source: 'auto' } })).toBe(false);
    expect(isUserAsserted({ quality: {} })).toBe(false);
    expect(isUserAsserted(null)).toBe(false);
    expect(isUserAsserted(undefined)).toBe(false);
    expect(PINNED_SOURCES.has('line')).toBe(true);
    expect(PINNED_SOURCES.has('manual')).toBe(true);
  });

  // The widening is inert today by design — no caller reaches resolveScaleUpdate
  // with pinned:false after a line calibration — so this pins the behaviour it
  // will have when one does, rather than a behaviour change now.
  it('makes a line calibration outrank the room pool in resolveScaleUpdate', () => {
    const others = [1 / 16, 1 / 16, 1 / 16.4, 1 / 15.6, 1 / 16.2, 1 / 15.8];
    const args = {
      dimensions: { width: '10', height: '12' },
      overlay: { x1: 0, y1: 0, x2: 120, y2: 144 },
      otherSamples: others,
      pinned: false,
    };
    const againstAuto = resolveScaleUpdate({
      ...args,
      calibration: { calibrated: true, feetPerPixel: { x: 1 / 16, y: 1 / 16 }, quality: { source: 'auto' } },
    });
    const againstLine = resolveScaleUpdate({
      ...args,
      calibration: { calibrated: true, feetPerPixel: { x: 1 / 16, y: 1 / 16 }, quality: { source: 'line' } },
    });

    expect(againstAuto.quality.adopted).toBe(false);
    expect(againstLine.quality.adopted).toBe(true);
    expect(againstLine.scale.x).toBeCloseTo(1 / 12, 9);
  });
});
