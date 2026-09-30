import { Fragment, useCallback, useEffect, useMemo } from 'react';
import { Trash2, Ellipsis, RotateCw, RotateCcw } from 'lucide-react';
import { TOOL_GROUPS } from './toolCatalog';
import useWorkspaceStore from '../store/workspaceStore';

/**
 * The tool rail: a labelled column down the right of the plan.
 *
 * **Every button says what it is.** The rail used to be twelve bare icons that
 * explained themselves only in the status bar, and only while hovered. That is
 * a fine instrument panel for someone who already knows it and a wall of
 * puzzles for everyone else — and this app is for appraisers, not for people
 * who learn icon sets. Each button now carries a one-word label under its icon,
 * a tooltip, and (while hovered or focused) its full description in the status
 * bar, which is also where a disabled tool says why.
 *
 * **Fewer buttons.** The tools almost nobody reaches for — measuring an angle,
 * deleting corners in bulk, turning the plan — sit behind a "More" button at
 * the foot of the rail (`overflow` in `TOOL_GROUPS`). When one of them is the
 * running tool, the More button wears its icon and label, so the rail never
 * hides which mode you are in. Rotation is two explicit items there, left and
 * right, where it used to be one button with a right-click secret.
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
 *    Clear is exactly that: it removes the last measurement, which removes the
 *    button. Each button clears its own hint on unmount, by id, so a late
 *    cleanup cannot wipe the hint the next button just set.
 *  - **Its text can change while the pointer rests on it.** The disabled reason
 *    is replaced by the tool's description the moment an outline lands, and
 *    nothing would re-write it — the status bar would keep saying a tool needs
 *    an outline while the outline sits on the canvas.
 */

const MORE_MENU_ID = 'tools-more';

// The hint plumbing every rail button shares: write on hover/focus, give it
// back on leave/blur and on unmount, and re-state it if its text changes while
// this button owns it.
const useRailHint = (hint) => {
  const setToolHint = useWorkspaceStore((s) => s.setToolHint);
  const clearToolHint = useWorkspaceStore((s) => s.clearToolHint);

  useEffect(() => {
    if (useWorkspaceStore.getState().toolHint?.id === hint.id) setToolHint(hint);
  }, [hint, setToolHint]);

  useEffect(() => () => clearToolHint(hint.id), [clearToolHint, hint.id]);

  return {
    onMouseEnter: () => setToolHint(hint),
    onMouseLeave: () => clearToolHint(hint.id),
    onFocus: () => setToolHint(hint),
    onBlur: () => clearToolHint(hint.id),
  };
};

const railButtonClass = (active, tone = 'accent') => `
  group relative shrink-0 flex flex-col items-center justify-center gap-1
  w-[64px] h-[54px] px-1 border rounded-md transition-colors cursor-pointer
  aria-disabled:opacity-40 aria-disabled:cursor-default
  ${active
    ? 'bg-accent text-accent-ink border-accent'
    : `border-transparent text-fg-2 ${tone === 'crit'
      ? 'hover:bg-crit/12 hover:text-crit'
      : 'hover:bg-sunken hover:text-fg'}
       aria-disabled:hover:bg-transparent aria-disabled:hover:text-fg-2`}`;

const RailLabel = ({ children }) => (
  <span className="max-w-full truncate text-[11.5px] leading-tight font-medium">{children}</span>
);

const ToolButton = ({ tool, active, disabled, onSelect }) => {
  const Icon = tool.icon;
  // Disabled, the reason it is disabled is the only description worth having.
  const detail = disabled ? tool.needsArea : tool.hint;
  const describedBy = detail ? `tool-hint-${tool.id}` : undefined;

  const hint = useMemo(
    () => ({ id: tool.id, name: tool.label, detail, digit: tool.digit }),
    [tool.id, tool.label, tool.digit, detail],
  );
  const hover = useRailHint(hint);

  return (
    <button
      type="button"
      aria-disabled={disabled || undefined}
      aria-pressed={active}
      aria-label={tool.label}
      aria-describedby={describedBy}
      aria-keyshortcuts={tool.digit ?? undefined}
      title={detail}
      onClick={() => { if (!disabled) onSelect(tool.id); }}
      {...hover}
      className={railButtonClass(active)}
    >
      <Icon className="w-5 h-5 shrink-0" aria-hidden="true" />
      <RailLabel>{tool.short}</RailLabel>

      {/* The same sentence the status bar prints, for a reader that is not
          looking at the status bar. `aria-label` above still supplies the name,
          so this is a description and never doubles it. */}
      {detail && <span id={describedBy} className="sr-only">{detail}</span>}
    </button>
  );
};

const OVERFLOW = TOOL_GROUPS.find((g) => g.overflow);
const MAIN_GROUPS = TOOL_GROUPS.filter((g) => !g.overflow);

const MORE_HINT = {
  id: 'more',
  name: 'More tools',
  detail: 'Measure an angle, remove corners, or turn the plan',
};

// One row of the overflow menu. Wider than a rail button, so it can say what
// the tool is for — or, disabled, why not — under its name.
const MoreItem = ({ icon, label, detail, keys, active, disabled, onSelect }) => {
  const Icon = icon;
  return (
  <button
    type="button"
    role="menuitem"
    aria-disabled={disabled || undefined}
    aria-pressed={active ?? undefined}
    onClick={() => { if (!disabled) onSelect(); }}
    className={`flex w-full items-start gap-3 px-3 py-2 rounded text-left transition-colors
      aria-disabled:opacity-45 aria-disabled:cursor-default cursor-pointer
      ${active ? 'bg-accent/12 text-fg' : 'text-fg-2 hover:bg-accent/12 hover:text-fg'}
      aria-disabled:hover:bg-transparent`}
  >
    <Icon className="w-[18px] h-[18px] mt-0.5 shrink-0" aria-hidden="true" />
    <span className="min-w-0 flex-1">
      <span className="flex items-baseline justify-between gap-3">
        <span className="text-[13.5px] font-medium">{label}</span>
        {keys && <span className="text-[12px] text-fg-dim">{keys}</span>}
      </span>
      {detail && <span className="block text-[12.5px] leading-snug text-fg-3 mt-0.5">{detail}</span>}
    </span>
  </button>
  );
};

const MoreMenu = ({ activeTool, hasArea, onSelect, onRotate }) => {
  const menuOpen = useWorkspaceStore((s) => s.menuOpen);
  const setMenuOpen = useWorkspaceStore((s) => s.setMenuOpen);
  const open = menuOpen === MORE_MENU_ID;
  const close = useCallback(() => {
    if (useWorkspaceStore.getState().menuOpen === MORE_MENU_ID) setMenuOpen(null);
  }, [setMenuOpen]);
  const hover = useRailHint(MORE_HINT);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  // Gives the flag back if the rail goes while its menu is open.
  useEffect(() => close, [close]);

  // A running overflow tool is shown on the button, so the rail still says
  // which mode you are in while its tool is out of sight.
  const running = OVERFLOW.tools.find((t) => t.id === activeTool && t.id !== 'rotate');
  const Icon = running?.icon ?? Ellipsis;

  const pick = (fn) => { close(); fn(); };

  return (
    <div className="relative">
      <button
        type="button"
        id="tools-more"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={running ? `More tools — ${running.label} is on` : 'More tools'}
        title={MORE_HINT.detail}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => setMenuOpen(open ? null : MORE_MENU_ID)}
        {...hover}
        className={`${railButtonClass(!!running)} ${open && !running ? 'bg-sunken text-fg' : ''}`}
      >
        <Icon className="w-5 h-5 shrink-0" aria-hidden="true" />
        <RailLabel>{running?.short ?? 'More'}</RailLabel>
      </button>

      {open && (
        <div
          role="menu"
          aria-labelledby="tools-more"
          onMouseDown={(e) => e.stopPropagation()}
          className="absolute right-[calc(100%+8px)] bottom-0 z-[60] w-[300px] p-1
                     bg-panel-2 border border-line rounded-md shadow-xl animate-fade-in"
        >
          {OVERFLOW.tools.map((tool) => {
            if (tool.id === 'rotate') {
              return (
                <Fragment key={tool.id}>
                  <MoreItem icon={RotateCw} label="Rotate right" detail="Turn the plan 45° clockwise"
                    keys="R" onSelect={() => pick(() => onRotate('clockwise'))} />
                  <MoreItem icon={RotateCcw} label="Rotate left" detail="Turn the plan 45° the other way"
                    keys="Shift+R" onSelect={() => pick(() => onRotate('counterclockwise'))} />
                </Fragment>
              );
            }
            const disabled = !!tool.needsArea && !hasArea;
            return (
              <MoreItem
                key={tool.id}
                icon={tool.icon}
                label={tool.label}
                detail={disabled ? tool.needsArea : tool.hint}
                keys={tool.digit}
                active={activeTool === tool.id}
                disabled={disabled}
                onSelect={() => pick(() => onSelect(tool.id))}
              />
            );
          })}
        </div>
      )}
    </div>
  );
};

const CLEAR_HINT = {
  id: 'clear',
  name: 'Clear',
  detail: 'Remove every measurement and shape you drew on this plan',
};

// Its own component so it can own the unmount cleanup: clicking it is what
// takes it off screen, and that is the one hover in the rail guaranteed to end
// without a mouseleave.
const ClearButton = ({ onClearTools }) => {
  const hover = useRailHint(CLEAR_HINT);
  return (
    <button
      type="button"
      onClick={onClearTools}
      aria-label="Clear all measurements and shapes"
      aria-describedby="tool-hint-clear"
      title={CLEAR_HINT.detail}
      {...hover}
      className={railButtonClass(false, 'crit')}
    >
      <Trash2 className="w-5 h-5 shrink-0" aria-hidden="true" />
      <RailLabel>Clear</RailLabel>
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
      className="flex w-[76px] shrink-0 flex-col bg-panel-2 border-l border-line select-none"
    >
      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col items-center gap-0.5 py-2">
        {MAIN_GROUPS.map((group, gi) => (
          <Fragment key={group.id}>
            {gi > 0 && <span className="w-9 h-px bg-line my-1.5 shrink-0" />}
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
                />
              ))}
            </div>
          </Fragment>
        ))}
      </div>

      {/* Outside the scrolling list, so the overflow menu is never clipped by
          it, and pinned to the foot so it sits in the same place however tall
          the window is. Clear goes when there is nothing to clear. */}
      <div className="shrink-0 flex flex-col items-center gap-0.5 border-t border-line py-2">
        <MoreMenu activeTool={activeTool} hasArea={hasArea} onSelect={onSelect} onRotate={onRotate} />
        {hasToolData && <ClearButton onClearTools={onClearTools} />}
      </div>
    </div>
  );
};

export default ToolRail;
