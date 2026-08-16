import { Fragment } from 'react';
import {
  MousePointer2, Ruler, Pentagon, Compass, Spline, SquareDashedBottom,
  Crop, Eraser, Scaling, RotateCw, Brush, Trash2, Tags,
} from 'lucide-react';

/**
 * The tool rail. Three rules the old ToolsPanel broke:
 *
 *  1. Nothing is hidden. Line/Area/Angle/Void used to be gated behind
 *     `hasArea`, so four buttons appeared the moment a trace landed and the
 *     two-column grid reflowed under the cursor. They now disable in place,
 *     with the reason in the tooltip.
 *  2. The order matches the digit map in useKeyboardShortcuts exactly. That
 *     hook already refuses to renumber itself by app state; the panel used to
 *     disagree with it.
 *  3. An icon-only rail is learnable by hover alone, which costs twelve
 *     hovers on the first visit. `showLabels` puts the name and the digit
 *     beside every icon instead — on by default for a new user (see
 *     useToolLabels) and switched from the button at the foot of the rail.
 *
 * `short` is the rail's own name for a tool and matches the status bar's
 * MODE_LABEL; `label` stays the fuller phrase, and stays the accessible name
 * in both densities so a screen reader never hears less than it used to.
 */
const TOOL_GROUPS = [
  {
    id: 'edit',
    title: 'Edit',
    tools: [
      { id: 'select',  digit: null, icon: MousePointer2,      short: 'Select', label: 'Select & adjust',
        hint: 'Drag corners, voids and shapes' },
    ],
  },
  {
    id: 'outline',
    title: 'Outline',
    tools: [
      { id: 'draw',    digit: '7',  icon: Brush,              short: 'Paint outline', label: 'Paint the outline',
        hint: 'Paint over the exterior walls and let FloorTrace read them' },
      { id: 'vertex',  digit: '4',  icon: Spline,             short: 'Place corners', label: 'Place corners',
        hint: 'Place the exterior outline corner by corner' },
      { id: 'void',    digit: '8',  icon: SquareDashedBottom, short: 'Cut out', label: 'Cut out a void',
        hint: 'Punch a courtyard or light well out of an outline',
        needsArea: 'Cutting a void needs a traced outline first.' },
    ],
  },
  {
    id: 'measure',
    title: 'Measure',
    tools: [
      { id: 'scale',   digit: '9',  icon: Scaling,            short: 'Set scale', label: 'Set the scale',
        hint: 'Set the scale from a length you know' },
      { id: 'line',    digit: '1',  icon: Ruler,              short: 'Measure', label: 'Measure a length',
        needsArea: 'Measuring needs a traced outline first.' },
      { id: 'angle',   digit: '3',  icon: Compass,            short: 'Angle', label: 'Measure an angle',
        needsArea: 'Measuring needs a traced outline first.' },
      { id: 'area',    digit: '2',  icon: Pentagon,           short: 'Area', label: 'Draw an area',
        needsArea: 'Drawing an area needs a traced outline first.' },
    ],
  },
  {
    id: 'image',
    title: 'Plan image',
    tools: [
      { id: 'crop',    digit: '5',  icon: Crop,               short: 'Crop', label: 'Crop the plan' },
      { id: 'eraser',  digit: '6',  icon: Eraser,             short: 'Erase', label: 'Erase clutter',
        hint: 'Remove legends or notes that confuse detection' },
      { id: 'rotate',  digit: null, icon: RotateCw,           short: 'Rotate', label: 'Rotate 45°',
        hint: 'Right-click to rotate the other way' },
    ],
  },
];

const TOOLTIP = `pointer-events-none absolute right-[calc(100%+8px)] top-1/2 -translate-y-1/2 z-50
                 whitespace-nowrap rounded-md border border-line bg-raised px-2.5 py-1.5
                 text-[12px] text-fg shadow-xl opacity-0
                 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity`;

const ToolButton = ({ tool, active, disabled, showLabels, onSelect, onRotate }) => {
  const Icon = tool.icon;
  // Compact, the tooltip is the only name the tool has. Labelled, the name and
  // the keybinding are already on screen, so only a hint or a disabled reason
  // earns a popup — a tooltip that restates the row is noise.
  const tip = showLabels
    ? (disabled ? tool.needsArea : tool.hint ?? null)
    : (disabled ? tool.needsArea : (tool.hint || tool.label));

  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={active}
      aria-label={tool.label}
      aria-keyshortcuts={tool.digit ?? undefined}
      onClick={() => (tool.id === 'rotate' ? onRotate('clockwise') : onSelect(tool.id))}
      onContextMenu={tool.id === 'rotate'
        ? (e) => { e.preventDefault(); onRotate('counterclockwise'); }
        : undefined}
      className={`group relative shrink-0 border rounded-md transition-colors cursor-pointer
        disabled:opacity-40 disabled:cursor-default
        ${showLabels
          ? 'flex items-center gap-2.5 w-full h-8 px-2 text-[12.5px] font-medium'
          : 'grid place-items-center w-9 h-9'}
        ${active
          ? 'bg-accent text-accent-ink border-accent'
          : 'border-transparent text-fg-2 hover:bg-sunken hover:text-fg disabled:hover:bg-transparent'}`}
    >
      <Icon className="w-[17px] h-[17px] shrink-0" aria-hidden="true" />

      {showLabels ? (
        <>
          <span className="flex-1 text-left truncate">{tool.short}</span>
          {tool.digit && (
            <span className={`font-mono text-[11px] leading-none shrink-0
              ${active ? 'text-accent-ink' : 'text-fg-dim'}`}>
              {tool.digit}
            </span>
          )}
        </>
      ) : (
        tool.digit && (
          <span className={`absolute right-0.5 bottom-0 font-mono text-[10px] leading-none
            opacity-0 group-hover:opacity-100 transition-opacity
            ${active ? 'text-accent-ink' : 'text-fg-dim'}`}>
            {tool.digit}
          </span>
        )
      )}

      {/* A real tooltip, not `title`: compact, it carries the keybinding, which
          is how the shortcut gets taught at all. Left-hand side — the rail is
          on the right edge of the window. */}
      {tip && (
        <span role="tooltip" className={TOOLTIP}>
          {tip}
          {tool.digit && !showLabels && (
            <span className="ml-2 font-mono text-[11px] text-fg-dim">{tool.digit}</span>
          )}
        </span>
      )}
    </button>
  );
};

const ToolRail = ({
  activeTool, hasArea, hasToolData, showLabels,
  onSelect, onRotate, onClearTools, onToggleLabels,
}) => (
  <div
    role="toolbar"
    aria-label="Tools"
    aria-orientation="vertical"
    className={`flex shrink-0 flex-col bg-panel-2 border-l border-line select-none
                ${showLabels ? 'w-[156px]' : 'w-12'}`}
  >
    <div className={`flex-1 min-h-0 overflow-y-auto flex flex-col py-1.5
                     ${showLabels ? 'px-1.5 gap-0.5' : 'items-center gap-0.5'}`}>
      {TOOL_GROUPS.map((group, gi) => (
        <Fragment key={group.id}>
          {gi > 0 && !showLabels && <span className="w-6 h-px bg-line my-1.5 shrink-0" />}
          <div
            role="group"
            aria-label={group.title}
            className={`flex flex-col gap-0.5
              ${showLabels ? (gi > 0 ? 'mt-2.5' : '') : 'items-center'}`}
          >
            {showLabels && (
              <span className="px-2 pb-0.5 text-[10px] font-bold uppercase tracking-[.07em] text-fg-dim">
                {group.title}
              </span>
            )}

            {group.tools.map((tool) => (
              <ToolButton
                key={tool.id}
                tool={tool}
                active={activeTool === tool.id}
                disabled={!!tool.needsArea && !hasArea}
                showLabels={showLabels}
                onSelect={onSelect}
                onRotate={onRotate}
              />
            ))}
          </div>
        </Fragment>
      ))}
    </div>

    {/* Pinned, so the labels switch is in the same place whether or not the
        clear button is there and however long the tool list grows. */}
    <div className={`shrink-0 flex flex-col gap-0.5 border-t border-line py-1.5
                     ${showLabels ? 'px-1.5' : 'items-center'}`}>
      {hasToolData && (
        <button
          type="button"
          onClick={onClearTools}
          aria-label="Clear all measurements and shapes"
          className={`group relative shrink-0 border border-transparent rounded-md cursor-pointer
            text-fg-2 hover:bg-crit/12 hover:text-crit transition-colors
            ${showLabels
              ? 'flex items-center gap-2.5 w-full h-8 px-2 text-[12.5px] font-medium'
              : 'grid place-items-center w-9 h-9'}`}
        >
          <Trash2 className="w-[17px] h-[17px] shrink-0" aria-hidden="true" />
          {/* Keyed: both branches are spans in the same slot, so without one
              React patches the name into the tooltip and the fresh `opacity-0`
              transitions down from the name's 1 — a tooltip that flashes on
              screen every time the rail collapses. */}
          {showLabels
            ? <span key="name" className="flex-1 text-left truncate">Clear tools</span>
            : <span key="tip" role="tooltip" className={TOOLTIP}>Clear measurements &amp; shapes</span>}
        </button>
      )}

      {/* The name is the action, not a state, so no aria-pressed: "Hide tool
          labels, pressed" is a contradiction to read out. */}
      <button
        type="button"
        onClick={onToggleLabels}
        aria-label={showLabels ? 'Hide tool labels' : 'Show tool labels'}
        className={`group relative shrink-0 border border-transparent rounded-md cursor-pointer
          text-fg-dim hover:bg-sunken hover:text-fg transition-colors
          ${showLabels
            ? 'flex items-center gap-2.5 w-full h-8 px-2 text-[12px]'
            : 'grid place-items-center w-9 h-9'}`}
      >
        <Tags className="w-[17px] h-[17px] shrink-0" aria-hidden="true" />
        {showLabels
          ? <span key="name" className="flex-1 text-left truncate">Hide labels</span>
          : <span key="tip" role="tooltip" className={TOOLTIP}>Show tool labels</span>}
      </button>
    </div>
  </div>
);

export default ToolRail;
