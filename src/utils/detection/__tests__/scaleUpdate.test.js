// The interactive scale path: what one room's label and overlay do to the
// project scale. `npm run bench:scale` only exercises the automatic scan, so
// nothing here is covered by it — and the failure this pins was invisible from
// inside App.jsx because it needed two consecutive gestures to show up.
import { describe, expect, it } from 'vitest';
import { resolveScaleUpdate } from '../validate.js';
import { scaleQualitySummary } from '../../boundaryQuality.js';

// Three rooms already measured at ~16 px/ft: enough samples, and tight enough,
// for decideProjectScale to treat them as authoritative.
const OTHERS = [1 / 16, 1 / 16, 1 / 16.4, 1 / 15.6, 1 / 16.2, 1 / 15.8];

// A room whose overlay implies 12 px/ft — 33% from the pool, well past the 22%
// plan-spread tolerance, so unpinned it is outvoted.
const DIMS = { width: '10', height: '12' };
const OVERLAY = { x1: 0, y1: 0, x2: 120, y2: 144 };

const AUTO_CALIBRATION = {
  calibrated: true,
  feetPerPixel: { x: 1 / 16, y: 1 / 16 },
  quality: { level: 'ok', reason: null, source: 'auto', adopted: true, roomCount: 3 },
};

// What App.jsx does between two gestures: the resolved scale and quality become
// the calibration the next gesture reads.
const commit = (resolved) => ({
  calibrated: true,
  feetPerPixel: resolved.scale,
  quality: resolved.quality,
});

const drag = (calibration, pinned = true) => resolveScaleUpdate({
  dimensions: DIMS, overlay: OVERLAY, otherSamples: OTHERS, calibration, pinned,
});

describe('resolveScaleUpdate', () => {
  it('answers the same on the second drag as on the first', () => {
    const first = drag(AUTO_CALIBRATION);
    const second = drag(commit(first));

    expect(first.scale).toEqual(second.scale);
    expect(first.quality.adopted).toBe(second.quality.adopted);
    expect(first.quality.reason).toBe(second.quality.reason);
    expect(first.quality.level).toBe(second.quality.level);
    expect(first.quality.source).toBe(second.quality.source);
    // And the drag is honoured, not discarded in favour of the rooms that
    // produced the overlay the user is correcting.
    expect(first.quality.adopted).toBe(true);
    expect(first.scale.x).toBeCloseTo(1 / 12, 9);
  });

  // The same symmetry on the path that is still unpinned (typing a dimension
  // into the panel): the write that ends the first update must not change what
  // the second one decides.
  it('answers the same twice unpinned, where the project outvotes the room', () => {
    const first = drag(AUTO_CALIBRATION, false);
    const second = drag(commit(first), false);

    expect(first.quality.adopted).toBe(false);
    expect(first.scale.x).toBeCloseTo(1 / 16, 9);
    expect(second.scale).toEqual(first.scale);
    expect(second.quality.adopted).toBe(first.quality.adopted);
    expect(second.quality.source).toBe(first.quality.source);
  });

  it('does not call an outvoted room the manual scale', () => {
    const outvoted = drag(AUTO_CALIBRATION, false);

    expect(outvoted.quality.adopted).toBe(false);
    expect(outvoted.quality.reason).toBe('room-vs-project');
    // 'manual' here is what pinned the next update to a room the app had just
    // declined to use, and what silenced reviewAgainstFootprint for good.
    expect(outvoted.quality.source).toBe('auto');
  });

  it('records the source as manual only when the room actually set the scale', () => {
    const adopted = drag(AUTO_CALIBRATION);
    expect(adopted.quality.adopted).toBe(true);
    expect(adopted.quality.source).toBe('manual');
  });

  it('counts a source change as a change worth writing', () => {
    const outvoted = drag(AUTO_CALIBRATION, false);
    // Same scale as the calibration already in force; only the verdict moved.
    expect(outvoted.scale.x).toBeCloseTo(AUTO_CALIBRATION.feetPerPixel.x, 9);
    expect(outvoted.changed).toBe(true);

    const again = drag(commit(outvoted), false);
    expect(again.changed).toBe(false);
  });

  it('states the area change when a pinned room disagrees with the others', () => {
    const pinned = drag(AUTO_CALIBRATION);

    expect(pinned.quality.reason).toBe('room-vs-auto');
    expect(pinned.quality.level).toBe('check');
    expect(pinned.quality.roomCount).toBe(3);

    // Scale is 33% out, so the area moves ~78% — the number the user acts on.
    const summary = scaleQualitySummary(pinned.quality);
    expect(summary.level).toBe('check');
    expect(summary.short).toMatch(/areas ~78% different/);
    expect(summary.detail).toMatch(/about 33% from the 3 rooms/);
    expect(summary.detail).toMatch(/roughly 78%/);
  });

  it('keeps the outvoted-room wording once that verdict is sourced auto', () => {
    const outvoted = drag(AUTO_CALIBRATION, false);
    const summary = scaleQualitySummary(outvoted.quality);

    // Not the auto-consensus note: what happened is that this room was refused.
    expect(summary.short).toBe('Kept the scale from earlier rooms');
    expect(summary.detail).toMatch(/was not used/);
  });

  it('says nothing about a pinned room that agrees with the others', () => {
    const agreeing = resolveScaleUpdate({
      dimensions: { width: '10', height: '12' },
      overlay: { x1: 0, y1: 0, x2: 160, y2: 192 },
      otherSamples: OTHERS,
      calibration: AUTO_CALIBRATION,
      pinned: true,
    });

    expect(agreeing.quality.adopted).toBe(true);
    expect(agreeing.quality.reason).toBe(null);
    expect(scaleQualitySummary(agreeing.quality)).toBe(null);
  });

  it('returns null rather than a scale for unusable input', () => {
    const base = { otherSamples: [], calibration: null, pinned: true };
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
