import { Check } from 'lucide-react';
import { TOOL_MODES } from '../toolModes';

/**
 * While a mode is on — setting the scale from a known length, or choosing the
 * room to take it from — this *replaces* the action bar rather than stacking
 * above it. A mode on a phone is the whole task: the only two things that
 * matter are what it wants and how to leave.
 *
 * It sits at the bottom for the same reason the action bar does: the way out is
 * the control a user reaches for one-handed, and the desktop puts it at the top
 * of a 1400 px window where a thumb is not.
 */
const MobileToolContext = ({ active, onCancel }) => {
  const mode = TOOL_MODES[active];
  if (!mode) return null;

  const Icon = mode.icon;

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
        </p>
        <p className="mt-0.5 text-[12.5px] leading-snug text-fg-2">
          {mode.touchHint ?? mode.hint}
        </p>
      </div>

      <div className="flex items-center gap-2 px-3 py-2.5">
        <button
          type="button"
          onClick={onCancel}
          className="tap-target flex-1 gap-1.5 rounded-xl bg-accent text-accent-ink
                     text-[14px] font-semibold active:brightness-110 transition-[filter]"
        >
          <Check className="w-4 h-4" aria-hidden="true" />
          Done
        </button>
      </div>
    </div>
  );
};

export default MobileToolContext;
