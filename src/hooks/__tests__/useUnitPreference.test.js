// @vitest-environment happy-dom
//
// The defect this hook exists for is a silent one: a user who works in feet
// opens a metric plan, the scan switches the unit, and every reading they take
// after that is in metres with nothing having asked them.

import { beforeEach, describe, expect, it } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useUnitPreference from '../useUnitPreference';
import useAppStore from '../../store/appStore';
import useWorkspaceStore from '../../store/workspaceStore';
import { app, oneDocument } from './harness';

describe('useUnitPreference', () => {
  beforeEach(() => {
    oneDocument();
    localStorage.clear();
    useWorkspaceStore.setState({ unitPreference: 'auto' });
  });

  it('leaves the plan alone while the preference is auto', () => {
    useAppStore.setState({ unit: 'metric' });
    renderHook(() => useUnitPreference());
    expect(app().unit).toBe('metric');
  });

  it('pulls the live plan onto a pinned unit', () => {
    useAppStore.setState({ unit: 'metric' });
    const { rerender } = renderHook(() => useUnitPreference());
    act(() => useWorkspaceStore.getState().setUnitPreference('inches'));
    rerender();
    expect(app().unit).toBe('inches');
  });

  // The five arrival paths — scan, new plan, project load, adopt, draft
  // restore — are covered by one effect rather than five call sites, so what
  // this asserts is that any of them writing `unit` is corrected.
  it('corrects a plan that arrives in another unit', () => {
    const { rerender } = renderHook(() => useUnitPreference());
    act(() => useWorkspaceStore.getState().setUnitPreference('decimal'));
    rerender();
    act(() => useAppStore.getState().loadProject({ unit: 'metric' }));
    rerender();
    expect(app().unit).toBe('decimal');
  });

  it('choosing a unit pins it and persists it', () => {
    const { result } = renderHook(() => useUnitPreference());
    act(() => result.current.chooseUnit('metric'));
    expect(app().unit).toBe('metric');
    expect(useWorkspaceStore.getState().unitPreference).toBe('metric');
    expect(localStorage.getItem('floortrace:unit')).toBe('metric');
  });

  // 'auto' is the way back, and it must not also change what is on screen —
  // the plan keeps reading in whatever it reads in until something re-decides.
  it('handing the choice back to the plan leaves the current unit standing', () => {
    useAppStore.setState({ unit: 'metric' });
    const { rerender } = renderHook(() => useUnitPreference());
    act(() => useWorkspaceStore.getState().setUnitPreference('auto'));
    rerender();
    expect(app().unit).toBe('metric');
  });

  it('ignores a unit it cannot format', () => {
    renderHook(() => useUnitPreference());
    act(() => useWorkspaceStore.getState().setUnitPreference('furlongs'));
    expect(useWorkspaceStore.getState().unitPreference).toBe('auto');
  });
});
