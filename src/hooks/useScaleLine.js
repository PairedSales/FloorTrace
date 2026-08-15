import { useCallback } from 'react';
import { toast } from 'sonner';
import useAppStore, { roomScaleSamples } from '../store/appStore';
import * as undoManager from '../store/undoManager';
import { resolveLineScale } from '../utils/detection/validate';
import { scaleQualitySummary } from '../utils/boundaryQuality';

/**
 * useScaleLine
 *
 * The store write and the toast for a scale asserted by drawing a line and
 * stating its true length. The decision — one scalar or two, which line
 * supersedes which, what is worth doubting — is resolveLineScale's and is unit
 * tested there; only the two things a pure function cannot do live here.
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

    // Said out loud only when it is in doubt; the Area panel carries the same
    // verdict for as long as the scale is in force, which is where the
    // question is actually asked.
    const summary = scaleQualitySummary(resolved.quality);
    if (summary && summary.level === 'check') {
      toast.warning(summary.detail, { duration: 8000, id: 'line-scale-disagreement' });
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
