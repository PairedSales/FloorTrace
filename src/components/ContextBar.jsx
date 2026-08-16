import { TOOL_MODES } from './toolModes';

/**
 * What tool is on, what it needs, and how to leave it — docked under the
 * command bar rather than floating over the plan.
 *
 * This replaces eight `duration: Infinity` toasts that were the app's only
 * persistent mode indicator. They rendered top-centre over the canvas, stacked
 * with real notifications, and carried the sole documentation of Esc-to-cancel.
 *
 * `active` is resolved by the caller from the store's tool flags, so this stays
 * a pure presentational component with no store coupling.
 */

const ContextBar = ({
  active,
  count,
  brushSize,
  onBrushSizeChange,
  onCancel,
  onDone,
}) => {
  const mode = TOOL_MODES[active];
  if (!mode) return null;

  const Icon = mode.icon;

  return (
    <div className="flex items-center gap-3 h-9 px-3 bg-accent/10 border-b border-accent/40
                    text-[12.5px] select-none shrink-0 overflow-x-auto">
      <span className="inline-flex items-center gap-1.5 font-semibold text-accent whitespace-nowrap shrink-0">
        <Icon className="w-[15px] h-[15px]" aria-hidden="true" />
        {mode.name}
        {count > 0 && (
          <span className="font-mono tabular-nums font-normal text-fg-2">({count})</span>
        )}
      </span>

      <span className="text-fg-2 whitespace-nowrap shrink-0">{mode.hint}</span>

      {mode.brush && (
        <span className="inline-flex items-center gap-2 shrink-0">
          <label htmlFor="ctx-brush" className="text-fg-2 whitespace-nowrap">Brush</label>
          <input
            id="ctx-brush"
            type="range"
            min={mode.brush === 'draw' ? 8 : 4}
            max={mode.brush === 'draw' ? 400 : 200}
            step={mode.brush === 'draw' ? 6 : 4}
            value={brushSize}
            onChange={(e) => onBrushSizeChange(Number(e.target.value))}
            className="w-28 accent-accent cursor-pointer"
          />
          <span className="font-mono tabular-nums text-fg min-w-[46px]">{brushSize} px</span>
          <span className="text-fg-dim whitespace-nowrap">
            or <kbd className="font-mono bg-panel-2 border border-line rounded px-1.5 py-px">[</kbd>
            {' '}
            <kbd className="font-mono bg-panel-2 border border-line rounded px-1.5 py-px">]</kbd>
          </span>
        </span>
      )}

      <span className="flex-1 min-w-[8px]" />

      <button
        type="button"
        onClick={onCancel}
        className="inline-flex items-center gap-1.5 h-7 px-3 rounded-md border border-line
                   bg-panel-2 text-[12px] text-fg-2 hover:text-fg hover:border-accent/50
                   transition-colors cursor-pointer shrink-0"
      >
        Cancel
        <kbd className="font-mono text-[10.5px] opacity-70">Esc</kbd>
      </button>

      {onDone && mode.doneLabel && (
        <button
          type="button"
          onClick={onDone}
          className="inline-flex items-center gap-1.5 h-7 px-3 rounded-md border border-accent
                     bg-accent text-accent-ink text-[12px] font-semibold hover:brightness-110
                     transition-[filter] cursor-pointer shrink-0"
        >
          {mode.doneLabel}
          {mode.doneKey && <kbd className="font-mono text-[10.5px] opacity-80">{mode.doneKey}</kbd>}
        </button>
      )}
    </div>
  );
};

export default ContextBar;
