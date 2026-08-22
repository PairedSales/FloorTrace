import { AlertTriangle, Loader2, SlidersHorizontal } from 'lucide-react';

/**
 * The bottom of the phone screen, which is the only part of it a thumb reaches
 * without regripping — so it holds the thing the user is most likely to do
 * next, not a row of everything they might.
 *
 * The desktop command bar offers seven verbs at equal weight and lets the eye
 * choose. That works with a mouse and a 1400 px row; at 390 px it becomes
 * seven 50 px targets with truncated labels. Instead this bar states **one**
 * verb — the next step of the pipeline the app already models (plan → scale →
 * outline → report) — and keeps the other routes to it in the menu and the
 * tool sheet, which is where a deliberate choice belongs.
 *
 * The area sits on the right at all times. It is the app's output, it changes
 * under the user's edits, and on a phone the panel that would otherwise show
 * it is closed by default.
 */
const MobileActionBar = ({
  primary,
  onTools,
  toolsActive,
  onPanel,
  panelOpen,
  areaText,
  areaSuffix,
  areaWarn,
  isProcessing,
}) => {
  const PrimaryIcon = isProcessing ? Loader2 : primary?.icon;

  return (
    <nav
      className="shrink-0 bg-panel-2 border-t border-line select-none pb-safe px-safe"
      aria-label="Actions"
    >
      <div className="flex items-stretch gap-1.5 h-[60px] px-2">
        <button
          type="button"
          onClick={onTools}
          aria-pressed={toolsActive}
          className={`tap-target flex-col gap-0.5 w-[62px] shrink-0 rounded-xl text-[10.5px]
                      font-semibold transition-colors
                      ${toolsActive
                        ? 'bg-accent/12 text-accent-strong'
                        : 'text-fg-3 active:bg-sunken active:text-fg'}`}
        >
          <SlidersHorizontal className="w-[21px] h-[21px]" aria-hidden="true" />
          Tools
        </button>

        <button
          type="button"
          onClick={primary?.onPress}
          disabled={!primary || primary.disabled || isProcessing}
          className="flex-1 min-w-0 my-2 inline-flex items-center justify-center gap-2 rounded-xl
                     bg-accent text-accent-ink text-[15px] font-semibold px-3
                     active:brightness-110 transition-[filter]
                     disabled:opacity-40 disabled:active:brightness-100"
        >
          {PrimaryIcon && (
            <PrimaryIcon
              className={`w-[18px] h-[18px] shrink-0 ${isProcessing ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
          )}
          <span className="truncate">{isProcessing ? 'Working…' : (primary?.label ?? 'Open a plan')}</span>
        </button>

        {/* Tapping the number opens the panel the number came from — the area,
            its breakdown, the scale it rests on and the detector's doubts are
            all one question, and this is where it gets asked. */}
        <button
          type="button"
          onClick={onPanel}
          aria-pressed={panelOpen}
          aria-label="Measurement details"
          className={`tap-target flex-col gap-0 w-[74px] shrink-0 rounded-xl px-1
                      transition-colors
                      ${panelOpen ? 'bg-accent/12' : 'active:bg-sunken'}`}
        >
          <span className={`flex items-center gap-1 font-mono tabular-nums font-bold leading-none
                            ${areaWarn ? 'text-warn' : 'text-fg'}
                            ${areaText.length > 5 ? 'text-[13px]' : 'text-[15px]'}`}>
            {areaWarn && <AlertTriangle className="w-3 h-3 shrink-0" aria-hidden="true" />}
            {areaText}
          </span>
          <span className="text-[10px] font-medium text-fg-3 leading-tight mt-0.5">
            {areaSuffix}
          </span>
        </button>
      </div>
    </nav>
  );
};

export default MobileActionBar;
