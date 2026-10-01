import { Check, X } from 'lucide-react';
import { TOOL_MODES } from '../toolModes';

/**
 * While a tool is on, this *replaces* the action bar rather than stacking above
 * it. A tool on a phone is a mode: the only two things that matter are what it
 * wants and how to leave, and the six other commands underneath would be six
 * ways to lose the stroke in progress.
 *
 * It sits at the bottom for the same reason the action bar does — Cancel and
 * Done are the two controls a user reaches for mid-gesture, one-handed, and
 * the desktop puts them at the top of a 1400 px window where a thumb is not.
 *
 * The brush slider is here too. `[` and `]` resize the brush on the desktop and
 * there is no keyboard to press them on, so without a control on screen the
 * brush is stuck at whatever it was — on a dense plan that is the difference
 * between painting the exterior and painting the whole floor.
 */
const MobileToolContext = ({
  active, count, brushSize, onBrushSizeChange, onCancel, onDone,
}) => {
  const mode = TOOL_MODES[active];
  if (!mode) return null;

  const Icon = mode.icon;
  const isDraw = mode.brush === 'draw';
  const label = mode.doneLabel;

  return (
    <div
      className="shrink-0 bg-accent/10 border-t border-accent/40 select-none pb-safe px-safe"
      role="region"
      aria-label={mode.name}
    >
      <div className="px-3 pt-2.5">
        <p className="flex items-center gap-1.5 text-[13.5px] font-semibold text-accent-strong">
          <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span className="truncate">{mode.name}</span>
          {count > 0 && (
            <span className="font-mono tabular-nums font-normal text-fg-2">({count})</span>
          )}
        </p>
        <p className="mt-0.5 text-[12.5px] leading-snug text-fg-2">
          {mode.touchHint ?? mode.hint}
        </p>
      </div>

      {mode.brush && (
        <div className="flex items-center gap-3 px-3 pt-2.5">
          <label htmlFor="mobile-brush" className="text-[12.5px] text-fg-2 shrink-0">Brush</label>
          <input
            id="mobile-brush"
            type="range"
            min={isDraw ? 8 : 4}
            max={isDraw ? 400 : 200}
            step={isDraw ? 6 : 4}
            value={brushSize}
            onChange={(e) => onBrushSizeChange(Number(e.target.value))}
            // h-11 on the input itself, not just the thumb: a 4 px track is a
            // 4 px target, and the slider is used mid-task with one thumb.
            className="flex-1 min-w-0 h-11 accent-accent"
          />
          <span className="font-mono tabular-nums text-[12.5px] text-fg min-w-[52px] text-right">
            {brushSize} px
          </span>
        </div>
      )}

      <div className="flex items-center gap-2 px-3 py-2.5">
        <button
          type="button"
          onClick={onCancel}
          className="tap-target flex-1 gap-1.5 rounded-xl border border-line bg-panel-2
                     text-[14px] font-medium text-fg-2 active:bg-sunken active:text-fg"
        >
          <X className="w-4 h-4" aria-hidden="true" />
          Cancel
        </button>
        {onDone && label && (
          <button
            type="button"
            onClick={onDone}
            className="tap-target flex-[1.4] gap-1.5 rounded-xl bg-accent text-accent-ink
                       text-[14px] font-semibold active:brightness-110 transition-[filter]"
          >
            <Check className="w-4 h-4" aria-hidden="true" />
            <span className="truncate">{label}</span>
          </button>
        )}
      </div>
    </div>
  );
};

export default MobileToolContext;
