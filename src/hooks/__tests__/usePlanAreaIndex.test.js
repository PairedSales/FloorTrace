// @vitest-environment happy-dom
//
// The roll-up can only measure the live plan. Everything else it adds up is
// what each plan recorded while it *was* live — so if this hook stops
// recording, a property total silently becomes a plan total.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePlanAreaIndex } from '../usePlanAreaIndex';
import useAppStore from '../../store/appStore';
import { app, oneDocument, IMAGE_A } from './harness';
import { newTraceId } from '../../store/ids';

const square = (n) => [{ x: 0, y: 0 }, { x: n, y: 0 }, { x: n, y: n }, { x: 0, y: n }];
const trace = (n, type = 'gla') => ({
  id: newTraceId(), name: '1st Floor', vertices: square(n), holes: [],
  visible: true, closed: true, type, colorSource: 'type', nameSource: 'auto', color: '#BD93F9',
});

const calibrated = () => ({
  calibrated: true, feetPerPixel: { x: 1, y: 1 }, source: 'room-calibration',
});

describe('usePlanAreaIndex', () => {
  let docA;
  const mounted = [];

  beforeEach(() => {
    vi.clearAllMocks();
    docA = oneDocument();
    useAppStore.setState({ image: IMAGE_A, calibration: calibrated() });
  });

  const mount = () => {
    const r = renderHook(() => usePlanAreaIndex());
    mounted.push(r);
    return r;
  };

  it('records what the live plan contributes', () => {
    mount();
    act(() => { useAppStore.setState({ perimeterTraces: [trace(30)] }); });

    const area = app().documents[docA].area;
    expect(area.total).toBeCloseTo(900, 6);
    expect(area.gla).toBeCloseTo(900, 6);
    expect(area.counts.gla).toBe(1);
  });

  it('keeps it current as the outline changes', () => {
    mount();
    act(() => { useAppStore.setState({ perimeterTraces: [trace(30)] }); });
    act(() => { useAppStore.setState({ perimeterTraces: [trace(40)] }); });
    expect(app().documents[docA].area.total).toBeCloseTo(1600, 6);
  });

  // Scale multiplies every area, so a recalibration has to be reflected or the
  // property total keeps a figure from the wrong scale.
  it('follows a change of scale', () => {
    mount();
    act(() => { useAppStore.setState({ perimeterTraces: [trace(30)] }); });
    act(() => {
      useAppStore.setState({ calibration: { ...calibrated(), feetPerPixel: { x: 2, y: 2 } } });
    });
    expect(app().documents[docA].area.total).toBeCloseTo(3600, 6);
  });

  it('records nothing rather than zero when the plan has no outline', () => {
    mount();
    act(() => { useAppStore.setState({ perimeterTraces: [] }); });
    expect(app().documents[docA].area).toBeNull();
  });

  it('clears the record when the last outline goes', () => {
    mount();
    act(() => { useAppStore.setState({ perimeterTraces: [trace(30)] }); });
    expect(app().documents[docA].area).not.toBeNull();
    act(() => { useAppStore.setState({ perimeterTraces: [] }); });
    expect(app().documents[docA].area).toBeNull();
  });

  it('reports the plan it is given on mount, without waiting for an edit', () => {
    act(() => { useAppStore.setState({ perimeterTraces: [trace(20)] }); });
    mount();
    expect(app().documents[docA].area.total).toBeCloseTo(400, 6);
  });
});
