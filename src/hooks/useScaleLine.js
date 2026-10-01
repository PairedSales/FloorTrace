import { useCallback } from 'react';
import useAppStore, { roomScaleSamples } from '../store/appStore';
import * as undoManager from '../store/undoManager';
import { resolveLineScale } from '../utils/detection/validate';

/**
 * useScaleLine
 *
 * The store write for a scale asserted by drawing a line and stating its true
 * length. The decision — one scalar or two, which line supersedes which, what
 * is worth doubting — is resolveLineScale's and is unit tested there; only the
 * thing a pure function cannot do lives here.
 *
 * Nothing is announced. A line that disagrees with the rooms the app measured
 * is written into the calibration's `quality`, and the panel's Scale section —
 * open, because this tool opens it — says so directly over the length the user
 * has just typed, for as long as that scale is in force.
 */
export function useScaleLine() {
  const setLength = useCallback((lineId, feet) => {
    const state = useAppStore.getState();
    const next = state.scaleLines.map((l) => (l.id === lineId ? { ...l, feet } : l));
    const resolved = resolveLineScale({
      lines: next,
      roomSamples: roomScaleSamples(state.rooms),
      calibration: state.calibration,
    });

    undoManager.save();
    state.setScaleLines(next);
    if (!resolved) return;

    if (resolved.changed) {
      state.applyRoomCalibration(resolved.scale, null, 'line-calibration', resolved.quality);
    }
  }, []);

  const removeLine = useCallback((lineId) => {
    const state = useAppStore.getState();
    undoManager.save();
    state.removeScaleLine(lineId);
    const next = useAppStore.getState().scaleLines;
    // Re-resolve rather than leave the scale the removed line set: the
    // remaining lines are the whole evidence, and a stale scalar outliving its
    // evidence is exactly the answer that looks right and is not.
    const resolved = resolveLineScale({
      lines: next,
      roomSamples: roomScaleSamples(state.rooms),
      calibration: state.calibration,
    });
    if (resolved?.changed) {
      state.applyRoomCalibration(resolved.scale, null, 'line-calibration', resolved.quality);
    } else if (!resolved && state.calibration?.source === 'line-calibration') {
      state.clearLineCalibration();
    }
  }, []);

  const clearAll = useCallback(() => {
    undoManager.save();
    useAppStore.getState().clearLineCalibration();
  }, []);

  return { setLength, removeLine, clearAll };
}

/**
 * useScaleTool
 *
 * Picking the length tool up and putting it down. It is the one manual tool
 * the app has: when no room size can be read from a plan, a length the user
 * knows is the only scale there is.
 *
 * Putting it down drops the line in progress and nothing else — the committed
 * lines and the scale they set are untouched.
 */
export function useScaleTool() {
  const leaveScaleTool = useCallback(() => {
    const state = useAppStore.getState();
    if (!state.scaleToolActive) return;
    state.setCurrentScaleLine(null);
    state.setScaleToolActive(false);
  }, []);

  const toggleScaleTool = useCallback(() => {
    const state = useAppStore.getState();
    if (state.scaleToolActive) leaveScaleTool();
    else state.setScaleToolActive(true);
  }, [leaveScaleTool]);

  return { toggleScaleTool, leaveScaleTool };
}
