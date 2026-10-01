// @vitest-environment happy-dom
//
// What the automatic scale does when the user has already set one by hand. The
// app keeps theirs — that part was always true — and used to raise a toast of
// its own about it, a second before the trace that follows raised another.
// Nothing is announced from in here now: the outcome is handed back to the
// caller, which says it once, as the last line of the run.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAutoScale } from '../useAutoScale';
import useAppStore from '../../store/appStore';
import useWorkspaceStore from '../../store/workspaceStore';
import { app, oneDocument, IMAGE_A } from './harness';

const detection = vi.hoisted(() => ({ detectRoomsFromLabels: vi.fn() }));
vi.mock('../../utils/detection', () => detection);

// The rooms' verdict, fixed: three rooms that agree on ten pixels to the foot.
const scale = vi.hoisted(() => ({ selectProjectScale: vi.fn() }));
vi.mock('../../utils/detection/scale.js', () => scale);

const DECISION = {
  pixelsPerFoot: 10,
  feetPerPixel: 0.1,
  level: 'ok',
  reason: null,
  spread: 0.02,
  roomCount: 3,
  contributors: [],
  rejected: [],
};

const labels = [{ id: 'a', point: { x: 5, y: 5 }, labelBbox: { x: 0, y: 0, width: 10, height: 10 }, labelDims: { width: 12, height: 10 } }];

const handScale = (feetPerPixel) => useAppStore.setState({
  calibration: {
    calibrated: true,
    feetPerPixel: { x: feetPerPixel, y: feetPerPixel },
    source: 'line-calibration',
    quality: { source: 'line', level: 'ok' },
  },
});

const run = async () => {
  const { result } = renderHook(() => useAutoScale());
  let decision;
  await act(async () => { decision = await result.current.measureAndCalibrate(labels); });
  return decision;
};

beforeEach(() => {
  vi.clearAllMocks();
  oneDocument();
  act(() => { app().setImage(IMAGE_A); });
  useWorkspaceStore.setState({ statusFlash: null, notice: null });
  detection.detectRoomsFromLabels.mockResolvedValue([{ id: 'a' }]);
  scale.selectProjectScale.mockReturnValue({ ...DECISION });
});

describe('useAutoScale — measuring the rooms', () => {
  it('sets the scale from the rooms when the user has not set one', async () => {
    const decision = await run();
    expect(app().calibration.feetPerPixel).toEqual({ x: 0.1, y: 0.1 });
    expect(app().calibration.quality).toMatchObject({ source: 'auto', roomCount: 3 });
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
    handScale(0.101);
    const decision = await run();
    expect(app().calibration.feetPerPixel).toEqual({ x: 0.101, y: 0.101 });
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
    scale.selectProjectScale.mockReturnValue({ ...DECISION, pixelsPerFoot: 0 });
    expect(await run()).toBeNull();
    expect(app().calibration.calibrated).toBe(false);
  });
});
