import { useEffect, useState } from 'react';
import { AlertTriangle, CloudOff, Loader2, Maximize } from 'lucide-react';
import useAppStore from '../../store/appStore';
import useWorkspaceStore from '../../store/workspaceStore';

/**
 * What the desktop status bar says, said where a phone has room for it: over
 * the plan, and only while it is true.
 *
 * The status bar is a 26 px strip of permanent chrome carrying four cells. On a
 * 390 px screen that strip costs more than it tells — the scale and the zoom
 * are both readable from the plan itself, and mode has its own bar. What cannot
 * be dropped is the pair the app is honest about: that something is running,
 * and that the draft is *not* being kept. Both appear only in that state.
 */
const MobileCanvasOverlay = ({ hasImage, onFitToWindow }) => {
  const isProcessing = useAppStore((s) => s.isProcessing);
  const processingMessage = useAppStore((s) => s.processingMessage);
  const draftState = useAppStore((s) => s.draftState);
  const flash = useWorkspaceStore((s) => s.statusFlash);

  const [shownFlash, setShownFlash] = useState(null);
  useEffect(() => {
    if (!flash) return undefined;
    setShownFlash(flash.text);
    const t = setTimeout(() => setShownFlash(null), 2600);
    return () => clearTimeout(t);
  }, [flash]);

  const draftRisk = hasImage && (draftState === 'off' || draftState === 'error');

  return (
    <>
      {hasImage && (
        <button
          type="button"
          onClick={onFitToWindow}
          aria-label="Fit plan to screen"
          className="absolute top-3 right-3 z-10 tap-target rounded-full bg-panel-2/90
                     border border-line text-fg-2 shadow-sm backdrop-blur-sm
                     active:bg-sunken active:text-fg"
        >
          <Maximize className="w-5 h-5" aria-hidden="true" />
        </button>
      )}

      {draftRisk && (
        <span
          className="absolute top-3 left-3 z-10 inline-flex items-center gap-1.5 h-8 px-3
                     rounded-full bg-warn/15 border border-warn/40 text-[12px] font-semibold
                     text-warn backdrop-blur-sm"
        >
          {draftState === 'error'
            ? <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
            : <CloudOff className="w-3.5 h-3.5" aria-hidden="true" />}
          {draftState === 'error' ? 'Draft not saved' : 'Not kept'}
        </span>
      )}

      {/* The one live region on mobile, matching the status bar's role on the
          desktop: without it a screen-reader user hears sonner's toasts and
          nothing at all for the app's own acknowledgements. */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex justify-center px-4"
      >
        {isProcessing ? (
          <span className="inline-flex items-center gap-2 h-9 px-3.5 rounded-full bg-raised
                           border border-line shadow-lg text-[12.5px] font-semibold text-accent">
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
            {processingMessage || 'Working…'}
          </span>
        ) : shownFlash ? (
          <span className="inline-flex items-center gap-2 h-9 px-3.5 rounded-full bg-raised
                           border border-line shadow-lg text-[12.5px] font-semibold text-ok
                           animate-fade-in">
            {shownFlash}
          </span>
        ) : null}
      </div>
    </>
  );
};

export default MobileCanvasOverlay;
