import { useState, useRef, useEffect, useCallback } from 'react';
import { Sun, Moon, MonitorSmartphone } from 'lucide-react';
import FloorTraceLogo from '../assets/logo.svg';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent);
const mod = isMac ? '⌘' : 'Ctrl';

const THEME_ICON = { system: MonitorSmartphone, light: Sun, dark: Moon };
const THEME_LABEL = { system: 'System', light: 'Light', dark: 'Dark' };

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
 * Restart lives here as "Close project" rather than on the logo. Clicking a
 * wordmark to wipe the project was a destructive action on the least expected
 * target, warned about only in a tooltip.
 */
const MenuBar = ({
  image,
  onFileOpen,
  onPasteImage,
  onSaveProject,
  onSaveProjectAs,
  onRestart,
  onHelpOpen,
  onFitToWindow,
  onTracePerimeter,
  onDrawExterior,
  onOutlineByVertex,
  onFindRoomSize,
  onAddFloor,
  showSideLengths,
  onShowSideLengthsChange,
  autoSnapEnabled,
  onAutoSnapChange,
  saveOnExit,
  onSaveOnExitChange,
  enhancedOcr,
  onEnhancedOcrChange,
  theme,
  onCycleTheme,
  dockOpen,
  onDockToggle,
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

  const ThemeIcon = THEME_ICON[theme] ?? MonitorSmartphone;

  return (
    <header
      className="flex items-center gap-0.5 h-[30px] px-2 bg-panel border-b border-line-soft select-none shrink-0"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <span className="flex items-center gap-2 pr-2.5 mr-1 text-[12.5px] font-semibold text-fg">
        <img src={FloorTraceLogo} alt="" className="w-[15px] h-[15px]" draggable="false" />
        FloorTrace
      </span>

      <Menu id="file" label="File" open={openId === 'file'} onOpen={open} onClose={close}>
        <MenuItem label="Open plan or project…" keys={`${mod}+O`} onSelect={onFileOpen} close={close} />
        <MenuItem label="Paste plan from clipboard" keys={`${mod}+V`} onSelect={onPasteImage} close={close} />
        <Sep />
        <MenuItem label="Save project" keys={`${mod}+S`} disabled={!image} onSelect={() => onSaveProject(false)} close={close} />
        <MenuItem label="Save project as…" keys={`${mod}+Shift+S`} disabled={!image} onSelect={onSaveProjectAs} close={close} />
        <Sep />
        <MenuItem label="Close project" danger disabled={!image} onSelect={onRestart} close={close} />
      </Menu>

      <Menu id="view" label="View" open={openId === 'view'} onOpen={open} onClose={close}>
        <MenuItem label="Fit plan to window" keys="F" disabled={!image} onSelect={onFitToWindow} close={close} />
        <MenuItem
          label={`${dockOpen ? 'Hide' : 'Show'} measurement panel`}
          onSelect={onDockToggle}
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
        <Sep />
        <MenuItem label="Find outline automatically" disabled={!image} onSelect={onTracePerimeter} close={close} />
        <MenuItem label="Paint the outline" keys="7" disabled={!image} onSelect={onDrawExterior} close={close} />
        <MenuItem label="Place corners by hand" keys="4" disabled={!image} onSelect={onOutlineByVertex} close={close} />
        <Sep />
        <MenuItem label="Add another level" disabled={!image} onSelect={onAddFloor} close={close} />
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

      <div className="flex-1" />

      <button
        type="button"
        onClick={onCycleTheme}
        title={`Theme: ${THEME_LABEL[theme]} — click to change`}
        className="inline-flex items-center gap-1.5 h-[22px] px-2.5 rounded-full border border-line
                   bg-panel-2 text-[11.5px] text-fg-2 hover:text-fg hover:border-accent/50
                   transition-colors cursor-pointer"
      >
        <ThemeIcon className="w-3.5 h-3.5" aria-hidden="true" />
        {THEME_LABEL[theme]}
      </button>
    </header>
  );
};

export default MenuBar;
