import { useEffect, useState } from 'react';
import { AlertTriangle, CloudOff, Loader2, Maximize } from 'lucide-react';
import useAppStore from '../../store/appStore';
import useWorkspaceStore from '../../store/workspaceStore';

/**
 * What the desktop's action bar and header say, said where a phone has room
 * for it: over the plan, and only while it is true.
 *
 * On the desktop those are two bands above the plan. On a 390 px screen a
 * strip costs more than it tells — the zoom is readable from the plan itself,
 * and mode has its own bar.
 * What cannot be dropped is the pair the app is honest about: that something is
 * running, and that the draft is *not* being kept. Both appear only in that
 * state.
 */
const MobileCanvasOverlay = ({ hasImage, onFitToWindow }) => {
  const isProcessing = useAppStore((s) => s.isProcessing);
  const processingMessage = useAppStore((s) => s.processingMessage);
  const draftState = useAppStore((s) => s.draftState);
  const flash = useWorkspaceStore((s) => s.statusFlash);

  // Amber stays longer than green: a refusal has to be read, a confirmation
  // only noticed. Only for what is left of its window, so a flash raised while
  // this was off screen is not replayed over the next plan.
  const [shownFlash, setShownFlash] = useState(null);
  useEffect(() => {
    if (!flash) return undefined;
    const left = (flash.tone === 'warn' ? 5000 : 2600) - (Date.now() - (flash.at ?? 0));
    if (left <= 0) {
      setShownFlash(null);
      return undefined;
    }
    setShownFlash(flash);
    const t = setTimeout(() => setShownFlash(null), left);
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
          // Opaque, not a `warn` tint: this chip floats on the *plan*, which is
          // white paper in both themes, so a translucent warn ground put the
          // dark theme's light `--warn` at 1.53:1. `--panel-2` gives it a
          // surface of its own — 9.44:1 dark, 5.49:1 light — and at full
          // opacity the plan's own ink cannot bleed through and eat it.
          className="absolute top-3 left-3 z-10 inline-flex items-center gap-1.5 h-8 px-3
                     rounded-full bg-panel-2 border border-warn text-[12px] font-semibold
                     text-warn shadow-sm"
        >
          {draftState === 'error'
            ? <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
            : <CloudOff className="w-3.5 h-3.5" aria-hidden="true" />}
          {draftState === 'error' ? 'Draft not saved' : 'Not kept'}
        </span>
      )}

      {/* The one live region on mobile, matching the action bar's role on the
          desktop: what just happened to the plan is said here and nowhere
          else, so without it a screen-reader user hears nothing at all. */}
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
          // Wraps rather than truncates: a phone has no hover to read the rest.
          <span className={`inline-flex items-center gap-2 min-h-9 px-3.5 py-1.5 rounded-2xl bg-raised
                            border border-line shadow-lg text-[12.5px] font-semibold text-center
                            animate-fade-in ${shownFlash.tone === 'warn' ? 'text-warn' : 'text-ok'}`}>
            {shownFlash.text}
          </span>
        ) : null}
      </div>
    </>
  );
};

export default MobileCanvasOverlay;
