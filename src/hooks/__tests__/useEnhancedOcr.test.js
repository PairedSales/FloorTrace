// @vitest-environment happy-dom
//
// The slower reader takes about ten seconds to start and can fail. How it is
// getting on used to be three messages over the plan, raised while the Settings
// dialog that had started it was open in front of them. It is now a status the
// switch itself reads — and a notice only when there is no switch on screen to
// say it.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useEnhancedOcr } from '../useEnhancedOcr';
import useWorkspaceStore from '../../store/workspaceStore';

const ocr = vi.hoisted(() => ({ warmupNeuralOcr: vi.fn() }));
vi.mock('../../utils/ocrLazy', () => ocr);

const ws = () => useWorkspaceStore.getState();

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useWorkspaceStore.setState({
    enhancedOcrStatus: 'idle', notice: null, statusFlash: null, showSettings: true,
  });
});

const turnOn = async (result) => {
  await act(async () => { result.current.handleEnhancedOcrChange(true); });
};

describe('useEnhancedOcr', () => {
  it('says it is getting ready, then that it is, without a message over the plan', async () => {
    let finish;
    ocr.warmupNeuralOcr.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const { result } = renderHook(() => useEnhancedOcr());

    await turnOn(result);
    expect(result.current.enhancedOcr).toBe(true);
    expect(ws().enhancedOcrStatus).toBe('starting');

    await act(async () => { finish({}); });
    expect(ws().enhancedOcrStatus).toBe('ready');
    expect(ws().notice).toBeNull();
    expect(ws().statusFlash).toBeNull();
  });

  it('says on the switch that it could not start, while the switch is on screen', async () => {
    ocr.warmupNeuralOcr.mockResolvedValue(null);
    const { result } = renderHook(() => useEnhancedOcr());

    await turnOn(result);
    expect(ws().enhancedOcrStatus).toBe('failed');
    // Settings is open: the switch's own line says it.
    expect(ws().notice).toBeNull();
  });

  // Warmed in the background from a setting kept from an earlier visit, there
  // is no switch on screen — and the user would go on believing faint print
  // was getting a second look.
  it('raises a notice when it fails with no switch on screen to say so', async () => {
    useWorkspaceStore.setState({ showSettings: false });
    ocr.warmupNeuralOcr.mockResolvedValue(null);
    const { result } = renderHook(() => useEnhancedOcr());

    await turnOn(result);
    expect(ws().enhancedOcrStatus).toBe('failed');
    expect(ws().notice).toMatchObject({ tone: 'warn' });
    expect(ws().notice.text).toMatch(/could not start/);
  });

  it('goes back to saying what it is for when it is turned off', async () => {
    ocr.warmupNeuralOcr.mockResolvedValue({});
    const { result } = renderHook(() => useEnhancedOcr());
    await turnOn(result);
    await act(async () => { result.current.handleEnhancedOcrChange(false); });
    expect(result.current.enhancedOcr).toBe(false);
    expect(ws().enhancedOcrStatus).toBe('idle');
    expect(localStorage.getItem('floortrace:enhancedOcr')).toBe('false');
  });
});
