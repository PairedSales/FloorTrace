import { Fragment, useEffect, useMemo } from 'react';
import { Trash2 } from 'lucide-react';
import { TOOL_GROUPS } from './toolCatalog';
import useWorkspaceStore from '../store/workspaceStore';

/**
 * The tool rail. Three rules the old ToolsPanel broke:
 *
 *  1. Nothing is hidden. Line/Area/Angle/Void used to be gated behind
 *     `hasArea`, so four buttons appeared the moment a trace landed and the
 *     two-column grid reflowed under the cursor. They now disable in place,
 *     with the reason in the status bar.
 *  2. The order matches the digit map in useKeyboardShortcuts exactly. That
 *     hook already refuses to renumber itself by app state; the panel used to
 *     disagree with it.
 *  3. **A 48 px icon column says nothing until it is pointed at, so pointing at
 *     it is what makes it talk.** Hover or keyboard focus writes the tool's
 *     name and what it does into the status bar; the rail is one width, always.
 *     This replaces a `showLabels` preference that put the words beside every
 *     icon at the cost of 108 px of plan, a toggle in two places and a stored
 *     choice — and that still left the *description* to a floating tooltip.
 *     The status bar is a fixed place to look, which a tooltip that opens
 *     wherever the pointer happens to be is not.
 *
 * Disabled tools are `aria-disabled`, not `disabled`. A `disabled` button
 * dispatches no pointer events in Chrome, so the one control whose reason a
 * user most needs — "why can I not measure yet" — would be the only one that
 * stayed silent on hover. The click handler guards instead.
 *
 * Two things every button that writes a hint has to handle, because a hint has
 * no timeout and stays until something takes it back:
 *
 *  - **It can unmount under the pointer**, which fires no `mouseleave`. Clicking
 *    "Clear tools" is exactly that: it removes the last measurement, which
 *    removes the button. Each button clears its own hint on unmount, by id, so a
 *    late cleanup cannot wipe the hint the next button just set.
 *  - **Its text can change while the pointer rests on it.** The disabled reason
 *    is replaced by the tool's description the moment an outline lands, and
 *    nothing would re-write it — the status bar would keep saying a tool needs a
 *    traced outline while the outline sits on the canvas.
 *
 * `short` is the rail's own name for a tool; `label` stays the fuller phrase and
 * stays the accessible name, and `hint` is both the visible description and the
 * button's `aria-describedby`, so a screen reader hears what a pointer is shown.
 * Once a tool is *running*, the status bar stops printing the hover hint and
 * prints `TOOL_MODES[id]` instead — the name of the state and its instruction.
 */
const ToolButton = ({ tool, active, disabled, onSelect, onRotate }) => {
  const setToolHint = useWorkspaceStore((s) => s.setToolHint);
  const clearToolHint = useWorkspaceStore((s) => s.clearToolHint);
  const Icon = tool.icon;
  // Disabled, the reason it is disabled is the only description worth having.
  const detail = disabled ? tool.needsArea : tool.hint;
  const describedBy = detail ? `tool-hint-${tool.id}` : undefined;

  const hint = useMemo(
    () => ({ id: tool.id, name: tool.short, detail, digit: tool.digit }),
    [tool.id, tool.short, tool.digit, detail],
  );
  const show = () => setToolHint(hint);
  const clear = () => clearToolHint(tool.id);

  // Re-state it if the text changed while this button owns it.
  useEffect(() => {
    if (useWorkspaceStore.getState().toolHint?.id === hint.id) setToolHint(hint);
  }, [hint, setToolHint]);

  // ...and give it up if the button goes away while the pointer is on it.
  useEffect(() => () => clearToolHint(tool.id), [clearToolHint, tool.id]);

  return (
    <button
      type="button"
      aria-disabled={disabled || undefined}
      aria-pressed={active}
      aria-label={tool.label}
      aria-describedby={describedBy}
      aria-keyshortcuts={tool.digit ?? undefined}
      onClick={() => {
        if (disabled) return;
        if (tool.id === 'rotate') onRotate('clockwise');
        else onSelect(tool.id);
      }}
      onContextMenu={tool.id === 'rotate'
        ? (e) => { e.preventDefault(); onRotate('counterclockwise'); }
        : undefined}
      onMouseEnter={show}
      onMouseLeave={clear}
      onFocus={show}
      onBlur={clear}
      className={`group relative shrink-0 grid place-items-center w-9 h-9
        border rounded-md transition-colors cursor-pointer
        aria-disabled:opacity-40 aria-disabled:cursor-default
        ${active
          ? 'bg-accent text-accent-ink border-accent'
          : `border-transparent text-fg-2 hover:bg-sunken hover:text-fg
             aria-disabled:hover:bg-transparent aria-disabled:hover:text-fg-2`}`}
    >
      <Icon className="w-[17px] h-[17px] shrink-0" aria-hidden="true" />

      {tool.digit && (
        <span className={`absolute right-0.5 bottom-0 font-mono text-[10px] leading-none
          opacity-0 group-hover:opacity-100 transition-opacity
          ${active ? 'text-accent-ink' : 'text-fg-dim'}`}>
          {tool.digit}
        </span>
      )}

      {/* The same sentence the status bar prints, for a reader that is not
          looking at the status bar. `aria-label` above still supplies the name,
          so this is a description and never doubles it. */}
      {detail && <span id={describedBy} className="sr-only">{detail}</span>}
    </button>
  );
};

const CLEAR_HINT = {
  id: 'clear',
  name: 'Clear tools',
  detail: 'Remove every measurement and shape drawn on this plan',
};

// Its own component so it can own the unmount cleanup: clicking it is what
// takes it off screen, and that is the one hover in the rail guaranteed to end
// without a mouseleave.
const ClearButton = ({ onClearTools }) => {
  const setToolHint = useWorkspaceStore((s) => s.setToolHint);
  const clearToolHint = useWorkspaceStore((s) => s.clearToolHint);

  useEffect(() => () => clearToolHint(CLEAR_HINT.id), [clearToolHint]);

  return (
    <button
      type="button"
      onClick={onClearTools}
      aria-label="Clear all measurements and shapes"
      aria-describedby="tool-hint-clear"
      onMouseEnter={() => setToolHint(CLEAR_HINT)}
      onMouseLeave={() => clearToolHint(CLEAR_HINT.id)}
      onFocus={() => setToolHint(CLEAR_HINT)}
      onBlur={() => clearToolHint(CLEAR_HINT.id)}
      className="group relative shrink-0 grid place-items-center w-9 h-9
                 border border-transparent rounded-md cursor-pointer
                 text-fg-2 hover:bg-crit/12 hover:text-crit transition-colors"
    >
      <Trash2 className="w-[17px] h-[17px] shrink-0" aria-hidden="true" />
      <span id="tool-hint-clear" className="sr-only">{CLEAR_HINT.detail}</span>
    </button>
  );
};

const ToolRail = ({
  activeTool, hasArea, hasToolData,
  onSelect, onRotate, onClearTools,
}) => {
  const setToolHint = useWorkspaceStore((s) => s.setToolHint);

  // The rail itself goes when the last plan closes. Its buttons each give up
  // their own hint on the way out; this is the backstop for a rail that is not
  // on screen at all.
  useEffect(() => () => setToolHint(null), [setToolHint]);

  return (
    <div
      role="toolbar"
      aria-label="Tools"
      aria-orientation="vertical"
      className="flex w-12 shrink-0 flex-col bg-panel-2 border-l border-line select-none"
    >
      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col items-center gap-0.5 py-1.5">
        {TOOL_GROUPS.map((group, gi) => (
          <Fragment key={group.id}>
            {gi > 0 && <span className="w-6 h-px bg-line my-1.5 shrink-0" />}
            <div
              role="group"
              aria-label={group.title}
              className="flex flex-col items-center gap-0.5"
            >
              {group.tools.map((tool) => (
                <ToolButton
                  key={tool.id}
                  tool={tool}
                  active={activeTool === tool.id}
                  disabled={!!tool.needsArea && !hasArea}
                  onSelect={onSelect}
                  onRotate={onRotate}
                />
              ))}
            </div>
          </Fragment>
        ))}
      </div>

      {/* Pinned to the foot, so clearing sits in the same place however long the
          tool list grows — and the whole strip goes when there is nothing to
          clear, rather than leaving its rule across an empty row. */}
      {hasToolData && (
        <div className="shrink-0 flex flex-col items-center gap-0.5 border-t border-line py-1.5">
          <ClearButton onClearTools={onClearTools} />
        </div>
      )}
    </div>
  );
};

export default ToolRail;
