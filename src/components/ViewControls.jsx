import { Minus, Plus, Maximize } from 'lucide-react';
import useAppStore from '../store/appStore';

/**
 * How big the plan is on screen, and the way back to seeing all of it.
 *
 * In the corner of the plan, where every map and every document viewer keeps
 * it. The zoom used to share the status band with the instruction for a
 * running tool, and stood down whenever one ran — which is exactly when a
 * person zooms in to place a corner. Floating, it never has to give way.
 *
 * It sits *on* the paper, and the paper is white in both themes
 * (`.canvas-grid-bg` re-applies the light tokens to its subtree), so this
 * wears the light palette in the dark theme too. That is on purpose: a dark
 * slab in the corner of a white sheet reads as part of the drawing.
 */
const ViewControls = ({ onZoomIn, onZoomOut, onFitToWindow }) => {
  const zoomScale = useAppStore((s) => s.zoomScale);
  const zoomPct = zoomScale > 0 ? Math.round(zoomScale * 100) : 100;

  return (
    <div
      role="group"
      aria-label="Zoom"
      className="absolute right-4 bottom-4 z-10 flex items-center gap-0.5 p-1
                 bg-panel-2 border border-line rounded-xl select-none"
    >
      <button type="button" onClick={onZoomOut} aria-label="Zoom out" title="Zoom out" className="icon-btn">
        <Minus className="w-[18px] h-[18px]" aria-hidden="true" />
      </button>
      <span className="min-w-[52px] text-center text-[15.5px] tabular-nums text-fg-2">{zoomPct}%</span>
      <button type="button" onClick={onZoomIn} aria-label="Zoom in" title="Zoom in" className="icon-btn">
        <Plus className="w-[18px] h-[18px]" aria-hidden="true" />
      </button>
      <span className="w-px h-5 mx-1 bg-line" aria-hidden="true" />
      <button
        type="button"
        onClick={onFitToWindow}
        title="Show the whole plan (F)"
        className="btn btn-quiet btn-sm h-10"
      >
        <Maximize className="w-4 h-4" aria-hidden="true" />
        Fit to window
      </button>
    </div>
  );
};

export default ViewControls;
