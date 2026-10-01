import { useState, useEffect, useCallback } from 'react';
import { warmupNeuralOcr } from '../utils/ocrLazy';
import { notify } from '../utils/notify';
import useWorkspaceStore from '../store/workspaceStore';

const ENHANCED_OCR_KEY = 'floortrace:enhancedOcr';

/**
 * useEnhancedOcr
 *
 * Opt-in setting for the PaddleOCR neural rescue pass. Paddle's WebGL shader
 * compile blocks the main thread for ~10s, so it is never auto-initialised —
 * only users who enable this toggle pay that cost (immediately on enable, or
 * during the first idle moment after load when the setting persists).
 *
 * How it is getting on is `workspaceStore.enhancedOcrStatus`, which the switch
 * itself reads and says in its own line — "getting ready", "ready", "couldn't
 * start". It used to be three messages over the plan, raised while the
 * Settings dialog that had started it was still open in front of them.
 *
 * @returns {{ enhancedOcr: boolean, handleEnhancedOcrChange: (enabled: boolean) => void }}
 */
export function useEnhancedOcr() {
  const [enhancedOcr, setEnhancedOcr] = useState(() => {
    try {
      return localStorage.getItem(ENHANCED_OCR_KEY) === 'true';
    } catch {
      return false;
    }
  });

  const warmup = useCallback(() => {
    const ws = useWorkspaceStore.getState();
    ws.setEnhancedOcrStatus('starting');
    warmupNeuralOcr().then((api) => {
      const now = useWorkspaceStore.getState();
      if (api) {
        now.setEnhancedOcrStatus('ready');
        return;
      }
      now.setEnhancedOcrStatus('failed');
      // The switch says so where it is on screen. Warmed in the background
      // from a setting kept from an earlier visit, nothing is — and the user
      // would go on believing the faint print was getting a second look.
      if (!now.showSettings) {
        notify('The slower reader for room sizes could not start, so they will be read the usual way.', {
          type: 'warning',
        });
      }
    });
  }, []);

  // If enabled from a previous session, warm during the first idle moment so
  // the shader-compile stall lands before the user starts working.
  useEffect(() => {
    if (!enhancedOcr) return;
    const idle = window.requestIdleCallback ?? ((fn) => setTimeout(fn, 3000));
    const handle = idle(() => warmup(), { timeout: 10000 });
    const cancel = window.cancelIdleCallback ?? clearTimeout;
    return () => cancel(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleEnhancedOcrChange = useCallback((enabled) => {
    setEnhancedOcr(enabled);
    try {
      localStorage.setItem(ENHANCED_OCR_KEY, String(enabled));
    } catch {
      // persistence is best-effort
    }
    if (enabled) warmup();
    else useWorkspaceStore.getState().setEnhancedOcrStatus('idle');
  }, [warmup]);

  return { enhancedOcr, handleEnhancedOcrChange };
}

// What the switch says under its label, by how the reader is getting on.
export const ENHANCED_OCR_HINT = {
  idle: 'Adds a second, slower reader for small or blurry text. Turning it on can pause the app for about 10 seconds while it gets ready.',
  starting: 'Getting the slower reader ready — the app may pause for about 10 seconds.',
  ready: 'On. Small or blurry text gets a second, slower reading.',
  failed: 'The slower reader couldn’t start in this browser, so room sizes are read the usual way.',
};
