import { Minus, Plus, Maximize, RotateCcw, RotateCw } from 'lucide-react';
import useAppStore from '../store/appStore';

/**
 * How the plan sits on screen — its size, which way up it is — and the way
 * back to seeing all of it.
 *
 * In the corner of the plan, where every map and every document viewer keeps
 * it. Turning the plan lives here because it is a way of looking at the plan,
 * not something done to it: nothing measured changes.
 *
 * It sits *on* the paper, and the paper is white in both themes
 * (`.canvas-grid-bg` re-applies the light tokens to its subtree), so this
 * wears the light palette in the dark theme too. That is on purpose: a dark
 * slab in the corner of a white sheet reads as part of the drawing.
 */
const ViewControls = ({ onZoomIn, onZoomOut, onFitToWindow, onRotate }) => {
  const zoomScale = useAppStore((s) => s.zoomScale);
  const zoomPct = zoomScale > 0 ? Math.round(zoomScale * 100) : 100;

  return (
    <div
      role="group"
      aria-label="View"
      className="absolute right-4 bottom-4 z-10 flex items-center gap-0.5 p-1
                 bg-panel-2 border border-line rounded-xl shadow-float select-none"
    >
      <button type="button" onClick={onZoomOut} aria-label="Zoom out" title="Zoom out" className="icon-btn w-8 h-8">
        <Minus className="w-4 h-4" aria-hidden="true" />
      </button>
      <span className="min-w-[48px] text-center text-[13.5px] tabular-nums text-fg-2">{zoomPct}%</span>
      <button type="button" onClick={onZoomIn} aria-label="Zoom in" title="Zoom in" className="icon-btn w-8 h-8">
        <Plus className="w-4 h-4" aria-hidden="true" />
      </button>
      <span className="w-px h-5 mx-1 bg-line" aria-hidden="true" />
      <button
        type="button"
        onClick={onFitToWindow}
        title="Show the whole plan (F)"
        className="btn btn-quiet btn-sm"
      >
        <Maximize className="w-4 h-4" aria-hidden="true" />
        Fit
      </button>
      {onRotate && (
        <>
          <span className="w-px h-5 mx-1 bg-line" aria-hidden="true" />
          <button type="button" onClick={() => onRotate('counterclockwise')} aria-label="Turn the plan left"
                  title="Turn the plan left (Shift+R)" className="icon-btn w-8 h-8">
            <RotateCcw className="w-4 h-4" aria-hidden="true" />
          </button>
          <button type="button" onClick={() => onRotate('clockwise')} aria-label="Turn the plan right"
                  title="Turn the plan right (R)" className="icon-btn w-8 h-8">
            <RotateCw className="w-4 h-4" aria-hidden="true" />
          </button>
        </>
      )}
    </div>
  );
};

export default ViewControls;
