// The interactive scale path: what one room's label and overlay do to the
// project scale. `npm run bench:scale` only exercises the automatic scan, so
// nothing here is covered by it.
//
// The rule: the scale is the room under the box, always. The other rooms are
// what it is compared with and can never take its place.
import { describe, expect, it } from 'vitest';
import { resolveScaleUpdate } from '../validate.js';
import { scaleQualitySummary } from '../../boundaryQuality.js';

// Three other rooms already measured at ~16 px/ft.
const OTHERS = [1 / 16, 1 / 16, 1 / 16.4, 1 / 15.6, 1 / 16.2, 1 / 15.8];

// A room whose overlay implies 12 px/ft — 33% from the others, well past the
// 22% two rooms on one plan may differ by. The others used to outvote it.
const DIMS = { width: '10', height: '12' };
const OVERLAY = { x1: 0, y1: 0, x2: 120, y2: 144 };

// What the automatic scan leaves behind: the scale of the room it chose.
const AUTO_CALIBRATION = {
  calibrated: true,
  feetPerPixel: { x: 1 / 16, y: 1 / 16 },
  quality: { level: 'ok', reason: 'auto-room', source: 'auto', adopted: true, roomCount: 4 },
};

// What App.jsx does between two gestures: the resolved scale and quality become
// the calibration the next gesture reads.
const commit = (resolved) => ({
  calibrated: true,
  feetPerPixel: resolved.scale,
  quality: resolved.quality,
});

const drag = (calibration, otherSamples = OTHERS) => resolveScaleUpdate({
  dimensions: DIMS, overlay: OVERLAY, otherSamples, calibration,
});

describe('resolveScaleUpdate', () => {
  it('sets the scale from the room under the box, whatever the other rooms say', () => {
    const resolved = drag(AUTO_CALIBRATION);
    expect(resolved.scale.x).toBeCloseTo(1 / 12, 12);
    expect(resolved.scale.y).toBeCloseTo(1 / 12, 12);
    expect(resolved.quality.adopted).toBe(true);
    expect(resolved.quality.source).toBe('manual');
    expect(resolved.changed).toBe(true);
  });

  // However many rooms disagree and however tightly they agree with each
  // other: none of their numbers reaches the scale.
  it('never puts the other rooms’ number in force', () => {
    const many = Array.from({ length: 40 }, () => 1 / 16);
    for (const others of [[], [1 / 16, 1 / 16], OTHERS, many]) {
      expect(drag(AUTO_CALIBRATION, others).scale).toEqual({ x: 1 / 12, y: 1 / 12 });
      expect(drag(null, others).scale).toEqual({ x: 1 / 12, y: 1 / 12 });
    }
  });

  it('uses the room’s own average when its two sides disagree, not the other rooms’', () => {
    // 10 x 12 on a square box: the room implies 1/12 across and 1/10 down.
    const resolved = resolveScaleUpdate({
      dimensions: DIMS, overlay: { x1: 0, y1: 0, x2: 120, y2: 120 },
      otherSamples: OTHERS, calibration: AUTO_CALIBRATION,
    });
    const own = Math.sqrt((10 / 120) * (12 / 120));
    expect(resolved.scale.x).toBeCloseTo(own, 12);
    expect(resolved.scale.y).toBeCloseTo(own, 12);
  });

  it('answers the same on the second gesture as on the first', () => {
    const first = drag(AUTO_CALIBRATION);
    const second = drag(commit(first));

    expect(second.scale).toEqual(first.scale);
    expect(second.quality).toEqual(first.quality);
    expect(second.changed).toBe(false);
  });

  it('states the area change when the room disagrees with the others', () => {
    const resolved = drag(AUTO_CALIBRATION);

    expect(resolved.quality.reason).toBe('room-vs-auto');
    expect(resolved.quality.level).toBe('check');
    expect(resolved.quality.roomCount).toBe(3);

    // Scale is 33% out, so the area moves ~78% — the number the user acts on.
    const summary = scaleQualitySummary(resolved.quality);
    expect(summary.level).toBe('check');
    expect(summary.short).toMatch(/areas ~78% different/);
    expect(summary.detail).toMatch(/about 33% from the other 3 rooms/);
    expect(summary.detail).toMatch(/roughly 78%/);
    expect(summary.detail).toMatch(/The scale comes from this room/);
  });

  it('says nothing about a room that agrees with itself and with the others', () => {
    const agreeing = resolveScaleUpdate({
      dimensions: { width: '10', height: '12' },
      overlay: { x1: 0, y1: 0, x2: 162, y2: 194 },
      otherSamples: OTHERS,
      calibration: AUTO_CALIBRATION,
    });

    expect(agreeing.quality.source).toBe('manual');
    expect(agreeing.quality.reason).toBe(null);
    expect(scaleQualitySummary(agreeing.quality)).toBe(null);
  });

  // The room the app chose is already what its box and its size fields say.
  // Clicking into a field and out again re-runs this with the same numbers,
  // and that must not turn the app's choice into a scale set by hand — a
  // re-read would then never choose again.
  it('leaves an automatic scale automatic when the gesture moved nothing', () => {
    const untouched = resolveScaleUpdate({
      dimensions: { width: '10', height: '12' },
      overlay: { x1: 0, y1: 0, x2: 160, y2: 192 },
      otherSamples: OTHERS,
      calibration: AUTO_CALIBRATION,
    });

    expect(untouched.changed).toBe(false);
    expect(untouched.quality).toBe(AUTO_CALIBRATION.quality);
    expect(untouched.scale).toEqual(AUTO_CALIBRATION.feetPerPixel);
  });

  it('returns null rather than a scale for unusable input', () => {
    const base = { otherSamples: [], calibration: null };
    expect(resolveScaleUpdate({ ...base, dimensions: DIMS, overlay: null })).toBe(null);
    expect(resolveScaleUpdate({
      ...base, dimensions: { width: '', height: '12' }, overlay: OVERLAY,
    })).toBe(null);
    expect(resolveScaleUpdate({
      ...base, dimensions: { width: 'abc', height: '12' }, overlay: OVERLAY,
    })).toBe(null);
    expect(resolveScaleUpdate({
      ...base, dimensions: DIMS, overlay: { x1: 40, y1: 0, x2: 40, y2: 144 },
    })).toBe(null);
  });
});
