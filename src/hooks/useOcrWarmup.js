import { useEffect } from 'react';
import { warmupOcrEngines } from '../utils/DimensionsOCR';

// Warming the OCR engines at mount cost every visitor ~4.4 MB gz — tesseract's
// worker script, the core WASM and the 5.2 MB language model — because
// tesseract.js v6's `createWorker` is not lazy: it fetches all three inside the
// call. That is 18x the app's entire initial JS, pulled in the window that
// decides time-to-interactive, for everyone including the people who bounce
// without ever dropping a floorplan.
//
// Two triggers, whichever fires first, because neither is sufficient alone:
//   - an idle callback alone still downloads everything for a visitor who
//     bounces; it only removes the contention with first paint.
//   - interaction alone has a narrower window than it looks. Dropping a file
//     already auto-scans, so warming at drop overlaps only the decode; and
//     Ctrl+V has no pre-signal at all, so a paste-first user would eat the
//     full cold boot inside the scan's own time budget. `keydown` is the
//     pre-signal a paste does have.
//
// Warm-up is pure prefetch — `detectAllDimensions` calls `warmOcrEngine()`
// itself — so firing late is a slower first scan, never a broken one.
const INTENT_EVENTS = ['pointerdown', 'dragenter', 'keydown', 'focusin'];

export const useOcrWarmup = (idleTimeout = 10000) => {
  useEffect(() => {
    let fired = false;
    const idle = window.requestIdleCallback ?? ((fn) => setTimeout(fn, idleTimeout));
    const cancelIdle = window.cancelIdleCallback ?? clearTimeout;
    let handle = null;

    const detach = () => {
      for (const name of INTENT_EVENTS) window.removeEventListener(name, fire, true);
      if (handle !== null) cancelIdle(handle);
    };

    function fire() {
      if (fired) return;
      fired = true;
      detach();
      warmupOcrEngines();
    }

    for (const name of INTENT_EVENTS) {
      window.addEventListener(name, fire, { capture: true, passive: true });
    }
    handle = idle(fire, { timeout: idleTimeout });

    return detach;
  }, [idleTimeout]);
};
