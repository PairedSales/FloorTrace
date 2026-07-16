import { useState, useEffect, useCallback } from 'react';
import { warmupNeuralOcr } from '../utils/DimensionsOCR';

const ENHANCED_OCR_KEY = 'floortrace:enhancedOcr';

/**
 * useEnhancedOcr
 *
 * Opt-in setting for the PaddleOCR neural rescue pass. Paddle's WebGL shader
 * compile blocks the main thread for ~10s, so it is never auto-initialised —
 * only users who enable this toggle pay that cost (immediately on enable, or
 * during the first idle moment after load when the setting persists).
 *
 * @returns {{ enhancedOcr: boolean, handleEnhancedOcrChange: (enabled: boolean) => void }}
 */
export function useEnhancedOcr(notify) {
  const [enhancedOcr, setEnhancedOcr] = useState(() => {
    try {
      return localStorage.getItem(ENHANCED_OCR_KEY) === 'true';
    } catch {
      return false;
    }
  });

  const warmup = useCallback(() => {
    warmupNeuralOcr().then((api) => {
      if (api) {
        notify('Enhanced OCR ready.', { type: 'success' });
      } else {
        notify('Enhanced OCR could not be initialized — scans will use standard OCR.', { type: 'error' });
      }
    });
  }, [notify]);

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
    if (enabled) {
      notify('Preparing enhanced OCR — the app may pause for ~10 seconds.', { type: 'info' });
      warmup();
    }
  }, [notify, warmup]);

  return { enhancedOcr, handleEnhancedOcrChange };
}
