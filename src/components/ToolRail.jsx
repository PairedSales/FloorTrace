import {
  MousePointer2, Ruler, Pentagon, Compass, Spline, SquareDashedBottom,
  Crop, Eraser, Scaling, RotateCw, Brush, Trash2,
} from 'lucide-react';

/**
 * The tool rail. Two rules the old ToolsPanel broke:
 *
 *  1. Nothing is hidden. Line/Area/Angle/Void used to be gated behind
 *     `hasArea`, so four buttons appeared the moment a trace landed and the
 *     two-column grid reflowed under the cursor. They now disable in place,
 *     with the reason in the tooltip.
 *  2. The order matches the digit map in useKeyboardShortcuts exactly. That
 *     hook already refuses to renumber itself by app state; the panel used to
 *     disagree with it.
 */
const TOOLS = [
  { id: 'select',  digit: null, icon: MousePointer2,       label: 'Select & adjust',
    hint: 'Drag corners, voids and shapes' },
  { sep: true },
  { id: 'draw',    digit: '7',  icon: Brush,               label: 'Paint the outline',
    hint: 'Paint over the exterior walls and let FloorTrace read them' },
  { id: 'vertex',  digit: '4',  icon: Spline,              label: 'Place corners',
    hint: 'Place the exterior outline corner by corner' },
  { id: 'void',    digit: '8',  icon: SquareDashedBottom,  label: 'Cut out a void',
    hint: 'Punch a courtyard or light well out of an outline',
    needsArea: 'Cutting a void needs a traced outline first.' },
  { sep: true },
  { id: 'scale',   digit: '9',  icon: Scaling,             label: 'Set the scale',
    hint: 'Set the scale from a length you know' },
  { id: 'line',    digit: '1',  icon: Ruler,               label: 'Measure a length',
    needsArea: 'Measuring needs a traced outline first.' },
  { id: 'angle',   digit: '3',  icon: Compass,             label: 'Measure an angle',
    needsArea: 'Measuring needs a traced outline first.' },
  { id: 'area',    digit: '2',  icon: Pentagon,            label: 'Draw an area',
    needsArea: 'Drawing an area needs a traced outline first.' },
  { sep: true },
  { id: 'crop',    digit: '5',  icon: Crop,                label: 'Crop the plan' },
  { id: 'eraser',  digit: '6',  icon: Eraser,              label: 'Erase clutter',
    hint: 'Remove legends or notes that confuse detection' },
  { id: 'rotate',  digit: null, icon: RotateCw,            label: 'Rotate 45°',
    hint: 'Right-click to rotate the other way' },
];

const ToolRail = ({ activeTool, hasArea, hasToolData, onSelect, onRotate, onClearTools }) => (
  <div
    role="toolbar"
    aria-label="Tools"
    aria-orientation="vertical"
    className="flex w-12 shrink-0 flex-col items-center gap-0.5 py-1.5
               bg-panel-2 border-l border-line select-none overflow-y-auto"
  >
    {TOOLS.map((tool, i) => {
      if (tool.sep) return <span key={`sep-${i}`} className="w-6 h-px bg-line my-1.5 shrink-0" />;

      const Icon = tool.icon;
      const disabled = !!tool.needsArea && !hasArea;
      const active = activeTool === tool.id;
      const title = disabled ? tool.needsArea : (tool.hint || tool.label);

      return (
        <button
          key={tool.id}
          type="button"
          disabled={disabled}
          aria-pressed={active}
          aria-label={tool.label}
          onClick={() => (tool.id === 'rotate' ? onRotate('clockwise') : onSelect(tool.id))}
          onContextMenu={tool.id === 'rotate'
            ? (e) => { e.preventDefault(); onRotate('counterclockwise'); }
            : undefined}
          className={`group relative grid place-items-center w-9 h-9 rounded-md shrink-0
            border transition-colors cursor-pointer
            disabled:opacity-30 disabled:cursor-default
            ${active
              ? 'bg-accent text-accent-ink border-accent'
              : 'border-transparent text-fg-2 hover:bg-sunken hover:text-fg disabled:hover:bg-transparent'}`}
        >
          <Icon className="w-[17px] h-[17px]" aria-hidden="true" />
          {tool.digit && (
            <span className={`absolute right-0.5 bottom-0 font-mono text-[10px] leading-none
              opacity-0 group-hover:opacity-100 transition-opacity
              ${active ? 'text-accent-ink' : 'text-fg-dim'}`}>
              {tool.digit}
            </span>
          )}
          {/* A real tooltip, not `title`: it shows the keybinding, which is how
              the shortcut gets taught at all. Left-hand side — the rail is on
              the right edge of the window. */}
          <span
            role="tooltip"
            className="pointer-events-none absolute right-[calc(100%+8px)] top-1/2 -translate-y-1/2 z-50
                       whitespace-nowrap rounded-md border border-line bg-raised px-2.5 py-1.5
                       text-[12px] text-fg shadow-xl opacity-0
                       group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity"
          >
            {title}
            {tool.digit && <span className="ml-2 font-mono text-[11px] text-fg-dim">{tool.digit}</span>}
          </span>
        </button>
      );
    })}

    {hasToolData && (
      <>
        <span className="w-6 h-px bg-line my-1.5 shrink-0" />
        <button
          type="button"
          onClick={onClearTools}
          aria-label="Clear all measurements and shapes"
          className="group relative grid place-items-center w-9 h-9 rounded-md shrink-0
                     border border-transparent text-fg-2 hover:bg-crit/12 hover:text-crit
                     transition-colors cursor-pointer"
        >
          <Trash2 className="w-[17px] h-[17px]" aria-hidden="true" />
          <span
            role="tooltip"
            className="pointer-events-none absolute right-[calc(100%+8px)] top-1/2 -translate-y-1/2 z-50
                       whitespace-nowrap rounded-md border border-line bg-raised px-2.5 py-1.5
                       text-[12px] text-fg shadow-xl opacity-0
                       group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity"
          >
            Clear measurements &amp; shapes
          </span>
        </button>
      </>
    )}
  </div>
);

export default ToolRail;
