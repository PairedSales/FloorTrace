// @vitest-environment happy-dom
//
// The scale the app sets by itself is one room's: the room it chose. This runs
// the real selector over rooms as the worker returns them and pins what the
// hook writes, and that neither a scale set by hand nor the footprint check
// that follows a trace is moved by it.
//
// Nothing is announced from in here: the outcome is handed back to the caller,
// which says it once, as the last line of the run.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAutoScale } from '../useAutoScale';
import useAppStore from '../../store/appStore';
import useWorkspaceStore from '../../store/workspaceStore';
import { app, oneDocument, IMAGE_A } from './harness';

const detection = vi.hoisted(() => ({ detectRoomsFromLabels: vi.fn() }));
vi.mock('../../utils/detection', () => detection);

// A room as the worker measures it: a 12 x 10 label, and the px/ft it reads.
const measured = (id, left, ppfX, ppfY = ppfX) => ({
  labelId: id,
  rect: { left, right: left + 12 * ppfX, top: 0, bottom: 10 * ppfY },
  confidence: 0.95,
  sides: {},
  pixelsPerFoot: { x: ppfX, y: ppfY },
  labelDims: { width: 12, height: 10 },
});

// Three rooms near ten pixels to the foot. B sits in the middle of them, so B
// is the room chosen.
const ROOMS = () => [
  measured('A', 0, 9.8),
  measured('B', 300, 10.0, 10.1),
  measured('C', 600, 10.2),
];

const labels = [{ id: 'a', point: { x: 5, y: 5 }, labelBbox: { x: 0, y: 0, width: 10, height: 10 }, labelDims: { width: 12, height: 10 } }];

const handScale = (feetPerPixel) => useAppStore.setState({
  calibration: {
    calibrated: true,
    feetPerPixel: { x: feetPerPixel, y: feetPerPixel },
    source: 'line-calibration',
    quality: { source: 'line', level: 'ok' },
  },
});

const mount = () => renderHook(() => useAutoScale()).result;

const run = async (hook = mount()) => {
  let decision;
  await act(async () => { decision = await hook.current.measureAndCalibrate(labels); });
  return decision;
};

beforeEach(() => {
  vi.clearAllMocks();
  oneDocument();
  act(() => { app().setImage(IMAGE_A); });
  useWorkspaceStore.setState({ statusFlash: null, notice: null });
  detection.detectRoomsFromLabels.mockResolvedValue(ROOMS());
});

describe('useAutoScale — measuring the rooms', () => {
  it('sets the scale from the one room it chose, and from no other', async () => {
    const decision = await run();
    expect(decision.room.name).toBe('B');
    // B's own two sides — not one number for both, taken from the middle of
    // all three rooms.
    expect(app().calibration.feetPerPixel.x).toBeCloseTo(1 / 10.0, 12);
    expect(app().calibration.feetPerPixel.y).toBeCloseTo(1 / 10.1, 12);
    expect(app().calibration.quality).toMatchObject({ source: 'auto', level: 'ok', roomCount: 3 });
    expect(decision.keptByHand).toBeUndefined();
  });

  it('keeps a scale set by hand, and says the rooms disagree with it', async () => {
    handScale(0.125);
    const decision = await run();
    // Theirs stands.
    expect(app().calibration.feetPerPixel).toEqual({ x: 0.125, y: 0.125 });
    expect(app().calibration.quality.source).toBe('line');
    // 0.125 against 0.1 is a quarter again.
    expect(decision.keptByHand).toEqual({ agrees: false });
  });

  it('says so when the rooms bear the hand-set scale out', async () => {
    handScale(0.0995);
    const decision = await run();
    expect(app().calibration.feetPerPixel).toEqual({ x: 0.0995, y: 0.0995 });
    expect(decision.keptByHand).toEqual({ agrees: true });
  });

  // The stages of the automatic run do not narrate themselves. This one used
  // to, and the trace that follows replaced its message a second later.
  it('announces nothing itself, whichever way it goes', async () => {
    await run();
    handScale(0.125);
    await run();
    expect(useWorkspaceStore.getState().statusFlash).toBeNull();
    expect(useWorkspaceStore.getState().notice).toBeNull();
  });

  it('comes back with nothing when no room could be measured', async () => {
    detection.detectRoomsFromLabels.mockResolvedValue([null, null]);
    expect(await run()).toBeNull();
    expect(app().calibration.calibrated).toBe(false);
  });

  // Once the outline is traced the scale is judged again, against the
  // building. The green box is not redrawn by that, so the scale must not move.
  it('changes what is said about the scale after a trace, and never the scale', async () => {
    const hook = mount();
    await run(hook);
    const before = app().calibration.feetPerPixel;

    // Three 12 x 10 rooms state 360 sq ft; a footprint of 100 sq ft at this
    // scale cannot hold them.
    act(() => hook.current.reviewAgainstFootprint(100 * 10.0 * 10.1));
    expect(app().calibration.quality).toMatchObject({
      source: 'auto', level: 'check', reason: 'area-implausible',
    });
    expect(app().calibration.feetPerPixel).toEqual(before);
  });
});
