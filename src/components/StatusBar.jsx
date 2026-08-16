import { useState, useEffect } from 'react';
import { Check, Loader2, Minus, Plus } from 'lucide-react';
import useAppStore from '../store/appStore';

const Cell = ({ children, className = '' }) => (
  <span className={`inline-flex items-center gap-1.5 h-[25px] px-2.5 whitespace-nowrap shrink-0
                    border-l border-line-soft first:border-l-0 ${className}`}>
    {children}
  </span>
);

/**
 * The desktop convention the app was missing entirely: one place that always
 * answers "what mode am I in, how big is the view, what scale is in force,
 * is my work saved". Before this, mode lived only in eight `duration: Infinity`
 * toasts over the canvas and zoom was not displayed anywhere at all.
 *
 * Live cursor coordinates are deliberately absent. `currentMousePos` is local
 * state inside useToolRouter, and lifting it here would put a store write on
 * every mousemove — a 60 Hz re-render of the whole shell to display a number
 * nobody is reading while they drag.
 */
const StatusBar = ({ mode, hint, onZoomIn, onZoomOut, hasImage }) => {
  const zoomScale = useAppStore((s) => s.zoomScale);
  const calibration = useAppStore((s) => s.calibration);
  const isProcessing = useAppStore((s) => s.isProcessing);
  const processingMessage = useAppStore((s) => s.processingMessage);

  // Low-stakes confirmations land here rather than as a toast over the plan.
  const flash = useAppStore((s) => s.statusFlash);
  const [shownFlash, setShownFlash] = useState(null);
  useEffect(() => {
    if (!flash) return;
    setShownFlash(flash.text);
    const t = setTimeout(() => setShownFlash(null), 2600);
    return () => clearTimeout(t);
  }, [flash]);

  const fpp = calibration?.feetPerPixel;
  const pxPerFoot = calibration?.calibrated && fpp?.x > 0 && fpp?.y > 0
    ? { x: 1 / fpp.x, y: 1 / fpp.y }
    : null;
  const anisotropic = pxPerFoot && Math.abs(pxPerFoot.x - pxPerFoot.y) > 1e-6;
  const zoomPct = zoomScale > 0 ? Math.round(zoomScale * 100) : 100;

  return (
    <footer className="flex items-center h-[26px] px-1 bg-panel-2 border-t border-line
                       text-[11.5px] text-fg-3 select-none shrink-0 overflow-x-auto">
      {/* The one live region in the app. Acknowledgements moved off toasts and
          into `flash`, and sonner announces its own toasts but this channel had
          nothing — so confirmation of a user's own action was the one thing a
          screen-reader user could not hear. `polite` so it waits its turn
          rather than cutting across whatever is being read. */}
      <div role="status" aria-live="polite" aria-atomic="true" className="contents">
        {isProcessing ? (
          <Cell className="text-accent font-semibold">
            <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
            {processingMessage || 'Working…'}
          </Cell>
        ) : (
          <Cell className="text-accent font-semibold">{mode}</Cell>
        )}

        {shownFlash
          ? <Cell className="text-ok font-semibold">{shownFlash}</Cell>
          : hint && !isProcessing && <Cell>{hint}</Cell>}
      </div>

      <span className="flex-1 min-w-[10px]" />

      <Cell>
        <b className="text-fg-2 font-semibold">Scale</b>
        <span className="font-mono tabular-nums text-fg-2">
          {pxPerFoot
            ? (anisotropic
              ? `${pxPerFoot.x.toFixed(2)} × ${pxPerFoot.y.toFixed(2)} px/ft`
              : `${pxPerFoot.x.toFixed(2)} px/ft`)
            : 'not set'}
        </span>
      </Cell>

      <Cell>
        <button
          type="button"
          onClick={onZoomOut}
          disabled={!hasImage}
          aria-label="Zoom out"
          title="Zoom out"
          className="w-[18px] h-[18px] grid place-items-center rounded text-fg-3
                     hover:bg-sunken hover:text-fg disabled:opacity-40 disabled:hover:bg-transparent
                     cursor-pointer disabled:cursor-default"
        >
          <Minus className="w-3 h-3" aria-hidden="true" />
        </button>
        <span className="font-mono tabular-nums text-fg-2 min-w-[38px] text-center">{zoomPct}%</span>
        <button
          type="button"
          onClick={onZoomIn}
          disabled={!hasImage}
          aria-label="Zoom in"
          title="Zoom in"
          className="w-[18px] h-[18px] grid place-items-center rounded text-fg-3
                     hover:bg-sunken hover:text-fg disabled:opacity-40 disabled:hover:bg-transparent
                     cursor-pointer disabled:cursor-default"
        >
          <Plus className="w-3 h-3" aria-hidden="true" />
        </button>
      </Cell>

      <Cell className="text-fg-3">
        <Check className="w-3 h-3 text-ok" aria-hidden="true" />
        Saved
      </Cell>
    </footer>
  );
};

export default StatusBar;
