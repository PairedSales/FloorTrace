import { useState, useRef, useEffect, useCallback } from 'react';
import FloorTraceLogo from '../assets/logo.svg';
import { THEME_LABEL } from '../hooks/useTheme';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent);
const mod = isMac ? '⌘' : 'Ctrl';
const alt = isMac ? '⌥' : 'Alt';

const MenuItem = ({ label, disabled, danger, keys, onSelect, close }) => (
  <button
    type="button"
    role="menuitem"
    disabled={disabled}
    onClick={() => { close(); onSelect?.(); }}
    className={`flex w-full items-center justify-between gap-6 px-2.5 py-1.5 rounded text-[12.5px]
      text-left transition-colors disabled:opacity-40 disabled:cursor-default
      ${danger ? 'text-crit hover:bg-crit/10' : 'text-fg-2 hover:bg-accent/12 hover:text-fg'}
      disabled:hover:bg-transparent`}
  >
    <span>{label}</span>
    {keys && <span className="font-mono text-[11px] text-fg-dim">{keys}</span>}
  </button>
);

const Menu = ({ id, label, open, onOpen, onClose, children }) => {
  const ref = useRef(null);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? onClose() : onOpen(id))}
        // Hovering another title while a menu is open switches to it, the way
        // a real menu bar behaves.
        onMouseEnter={() => { if (!open) onOpen(id, true); }}
        className={`px-2.5 py-1 rounded text-[12.5px] transition-colors cursor-pointer
          ${open ? 'bg-accent/12 text-accent' : 'text-fg-2 hover:bg-sunken hover:text-fg'}`}
      >
        {label}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 top-[calc(100%+3px)] z-[60] min-w-[262px] p-1
                     bg-panel-2 border border-line rounded-md shadow-xl animate-fade-in"
        >
          {children}
        </div>
      )}
    </div>
  );
};

const Sep = () => <div className="h-px bg-line-soft my-1 mx-1.5" />;

/**
 * Every command gets a discoverable home with its keybinding shown inline —
 * the old UI taught its shortcuts only through 34 native `title` tooltips,
 * which are keyboard-invisible and touch-invisible.
 *
 * Closing lives here rather than on the logo. Clicking a wordmark to wipe the
 * project was a destructive action on the least expected target, warned about
 * only in a tooltip.
 *
 * It is two commands now, not one: closing the plan you are looking at is a
 * different act from closing every plan, and a single "Close project" silently
 * meant the second once more than one could be open.
 *
 * `status` is the status bar, slotted into the empty right of this row instead
 * of running along the foot of the window. The row was three quarters air and
 * the status line was the furthest thing on screen from the plan it describes.
 */
const MenuBar = ({
  image,
  onFileOpen,
  onPasteImage,
  onSaveProject,
  onSaveProjectAs,
  onExport,
  onCopyExhibit,
  onRestart,
  onCloseAllPlans,
  onNewPlan,
  onNextPlan,
  onPrevPlan,
  planCount = 1,
  canOpenPlan = true,
  onHelpOpen,
  onFitToWindow,
  onTracePerimeter,
  onDrawExterior,
  onOutlineByVertex,
  onFindRoomSize,
  onSelectRoom,
  canSelectRoom,
  onAddFloor,
  showSideLengths,
  onShowSideLengthsChange,
  autoSnapEnabled,
  onAutoSnapChange,
  toolLabels,
  onToolLabelsChange,
  saveOnExit,
  onSaveOnExitChange,
  enhancedOcr,
  onEnhancedOcrChange,
  theme,
  onCycleTheme,
  dockOpen,
  onDockToggle,
  status,
}) => {
  const [openId, setOpenId] = useState(null);
  const hoverMode = useRef(false);

  const close = useCallback(() => { setOpenId(null); hoverMode.current = false; }, []);
  const open = useCallback((id, viaHover = false) => {
    // Hover only switches between titles once a menu is already open.
    if (viaHover && !hoverMode.current) return;
    hoverMode.current = true;
    setOpenId(id);
  }, []);

  useEffect(() => {
    if (!openId) return;
    const onDown = () => close();
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [openId, close]);

  return (
    <header className="flex items-center h-[30px] px-2 bg-panel border-b border-line-soft select-none shrink-0">
      <span className="flex items-center gap-2 pr-2.5 mr-1 shrink-0 text-[12.5px] font-semibold text-fg">
        <img src={FloorTraceLogo} alt="" className="w-[15px] h-[15px]" draggable="false" />
        FloorTrace
      </span>

      {/* The swallowed mousedown is scoped to the titles, not the whole row.
          On the row it also swallowed the status bar's buttons, so zooming
          with a menu open left the menu hanging over the canvas. */}
      <div
        className="flex items-center gap-0.5 shrink-0"
        onMouseDown={(e) => e.stopPropagation()}
      >
      {/* Export sits above the project file, and says what it is for. Almost
          every trace is made for one appraisal and never reopened, so the
          image of the finished measurement is the document — the `.floorplan`
          is the copy you keep only if you mean to come back to it. */}
      <Menu id="file" label="File" open={openId === 'file'} onOpen={open} onClose={close}>
        <MenuItem label="Open plan or project…" keys={`${mod}+O`} onSelect={onFileOpen} close={close} />
        <MenuItem label="Paste plan from clipboard" keys={`${mod}+V`} onSelect={onPasteImage} close={close} />
        <Sep />
        <MenuItem label="Export for workfile…" keys={`${mod}+E`} disabled={!image} onSelect={onExport} close={close} />
        <MenuItem label="Copy measurement image" keys={`${mod}+${alt}+C`} disabled={!image} onSelect={onCopyExhibit} close={close} />
        <Sep />
        <MenuItem label="Save editable project" keys={`${mod}+S`} disabled={!image} onSelect={() => onSaveProject(false)} close={close} />
        <MenuItem label="Save editable project as…" keys={`${mod}+Shift+S`} disabled={!image} onSelect={onSaveProjectAs} close={close} />
        <Sep />
        <MenuItem label="New plan" keys={`${mod}+${alt}+N`} disabled={!canOpenPlan} onSelect={onNewPlan} close={close} />
        <MenuItem label="Next plan" keys={`${mod}+${alt}+→`} disabled={planCount < 2} onSelect={onNextPlan} close={close} />
        <MenuItem label="Previous plan" keys={`${mod}+${alt}+←`} disabled={planCount < 2} onSelect={onPrevPlan} close={close} />
        <Sep />
        <MenuItem label="Close this plan" danger disabled={!image} onSelect={onRestart} close={close} />
        <MenuItem label="Close all plans" danger disabled={planCount < 2} onSelect={onCloseAllPlans} close={close} />
      </Menu>

      <Menu id="view" label="View" open={openId === 'view'} onOpen={open} onClose={close}>
        <MenuItem label="Fit plan to window" keys="F" disabled={!image} onSelect={onFitToWindow} close={close} />
        <MenuItem
          label={`${dockOpen ? 'Hide' : 'Show'} measurement panel`}
          onSelect={onDockToggle}
          close={close}
        />
        <MenuItem
          label={`${toolLabels ? '✓ ' : ''}Show tool labels`}
          onSelect={() => onToolLabelsChange(!toolLabels)}
          close={close}
        />
        <Sep />
        <MenuItem
          label={`${showSideLengths ? '✓ ' : ''}Show side lengths`}
          keys="L"
          onSelect={() => onShowSideLengthsChange(!showSideLengths)}
          close={close}
        />
        <MenuItem
          label={`${autoSnapEnabled ? '✓ ' : ''}Snap to walls`}
          onSelect={() => onAutoSnapChange(!autoSnapEnabled)}
          close={close}
        />
        <Sep />
        <MenuItem
          label={`Theme: ${THEME_LABEL[theme]}`}
          onSelect={onCycleTheme}
          close={close}
        />
      </Menu>

      <Menu id="trace" label="Trace" open={openId === 'trace'} onOpen={open} onClose={close}>
        <MenuItem label="Read dimensions" disabled={!image} onSelect={onFindRoomSize} close={close} />
        <MenuItem label="Select room to scale from" disabled={!canSelectRoom} onSelect={onSelectRoom} close={close} />
        <Sep />
        <MenuItem label="Find outline automatically" disabled={!image} onSelect={onTracePerimeter} close={close} />
        <MenuItem label="Paint the outline" keys="1" disabled={!image} onSelect={onDrawExterior} close={close} />
        <MenuItem label="Place corners by hand" keys="2" disabled={!image} onSelect={onOutlineByVertex} close={close} />
        <Sep />
        <MenuItem label="Add another outline" disabled={!image} onSelect={onAddFloor} close={close} />
      </Menu>

      <Menu id="settings" label="Settings" open={openId === 'settings'} onOpen={open} onClose={close}>
        <MenuItem
          label={`${saveOnExit ? '✓ ' : ''}Save work on exit`}
          onSelect={() => onSaveOnExitChange(!saveOnExit)}
          close={close}
        />
        <MenuItem
          label={`${enhancedOcr ? '✓ ' : ''}Enhanced dimension reading`}
          onSelect={() => onEnhancedOcrChange(!enhancedOcr)}
          close={close}
        />
      </Menu>

      <Menu id="help" label="Help" open={openId === 'help'} onOpen={open} onClose={close}>
        <MenuItem label="Shortcuts & tips" onSelect={onHelpOpen} close={close} />
      </Menu>
      </div>

      {status && <span className="w-px h-4 bg-line mx-2 shrink-0" />}
      {status}
    </header>
  );
};

export default MenuBar;
