import { useEffect, useCallback, useRef } from 'react';
import {
  FolderOpen, Share, Undo2, Redo2, PanelLeftClose, PanelLeftOpen,
} from 'lucide-react';
import FloorTraceMark from './FloorTraceMark';
import { MenuItem, Sep, Popover } from './menuSurface';
import { MOD, ALT } from '../utils/keySymbols';
import { openTracingTutorial } from '../utils/tracingTutorial';
import useUndoHistory from '../hooks/useUndoHistory';
import useWorkspaceStore from '../store/workspaceStore';
import * as undoManager from '../store/undoManager';

/**
 * The whole top band: the name, the menus, and the handful of commands that
 * apply to the plan as a whole.
 *
 *   [ mark FloorTrace · File · View · Help ] │ [ Open · Undo · Redo ] ⋯ [ Panel · Export ]
 *
 * ## What this band no longer does
 *
 * It used to lead with two split buttons, *Read dimensions ▾* and *Find
 * outline ▾*, one of them always filled to say "this is your step". But opening
 * a plan already reads its dimensions, sets the scale and traces the outline —
 * all of it, automatically — so the buttons presented the app's internal
 * pipeline as a job the user had to operate, in the words of that pipeline.
 * And in the only case the highlight mattered, after something failed, it
 * pointed at re-running the step that had just failed. Everything under those
 * carets now lives where the user reads the result it corrects: the outline's
 * fixes on the panel's Outline card, the scale's on its Scale card, and the
 * modal tools on the rail.
 *
 * Preferences moved too. "Save work on exit" and "Enhanced dimension reading"
 * were checkmarks at the foot of File with no word of explanation, and units
 * and the theme were cycling rows in View. They are in Settings now, each with
 * a sentence saying what it does.
 *
 * ## Export
 *
 * The last step of the job, at the far right where the eye ends up, and there
 * from the moment a plan is open. It earns the outlined `ready` treatment once
 * there is an area and never a fill: a filled accent over a doubtful trace is a
 * wrong answer that looks green, in the part of the shell read first. The
 * panel's Export button is the one that fills, and only when nothing is left
 * to check.
 *
 * ## Empty
 *
 * Before a plan is open the band is the name, the menus and Open — the welcome
 * screen is the whole page, and a row of disabled buttons over it said nothing
 * but "not yet".
 */

// One open dropdown at a time, across this band and the tool rail's overflow.
// The id lives in the workspace store rather than here because the rail is a
// different component: with a local id, opening File left the rail's menu open.
// It is also what `keyboardGuard` reads — with a menu open, `1` used to enter
// draw mode behind it and `O` to toggle the dock the open View menu described.
const useOneOpenMenu = () => {
  const openId = useWorkspaceStore((s) => s.menuOpen);
  const setMenuOpen = useWorkspaceStore((s) => s.setMenuOpen);
  const hoverMode = useRef(false);
  const ours = typeof openId === 'string' && openId.startsWith('top:') ? openId.slice(4) : null;

  const close = useCallback(() => {
    hoverMode.current = false;
    if (String(useWorkspaceStore.getState().menuOpen ?? '').startsWith('top:')) setMenuOpen(null);
  }, [setMenuOpen]);
  const open = useCallback((id, viaHover = false) => {
    // Hover only switches between titles once a menu is already open.
    if (viaHover && !hoverMode.current) return;
    hoverMode.current = true;
    setMenuOpen(`top:${id}`);
  }, [setMenuOpen]);

  useEffect(() => { if (!ours) hoverMode.current = false; }, [ours]);
  useEffect(() => close, [close]);

  useEffect(() => {
    if (!ours) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [ours, close]);

  return { openId: ours, open, close };
};

const Rule = () => <div className="w-px h-6 bg-line mx-2 shrink-0" aria-hidden="true" />;

const Title = ({ id, label, openId, onOpen, onClose, children }) => {
  const open = openId === id;
  return (
    <div className="relative h-full flex items-center">
      <button
        type="button"
        id={`menu-${id}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? onClose() : onOpen(id))}
        onMouseDown={(e) => e.stopPropagation()}
        onMouseEnter={() => { if (!open) onOpen(id, true); }}
        className={`inline-flex h-[34px] items-center px-3 rounded-md text-[13.5px] transition-colors cursor-pointer
          ${open ? 'bg-sunken text-fg' : 'text-fg-2 hover:bg-sunken hover:text-fg'}`}
      >
        {label}
      </button>
      <Popover open={open} labelledBy={`menu-${id}`}>{children}</Popover>
    </div>
  );
};

const IconButton = ({ icon, label, title, onClick, disabled, ...rest }) => {
  const Icon = icon;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="toolbar-btn px-2.5"
      title={title ?? label}
      aria-label={label}
      {...rest}
    >
      <Icon className="w-[18px] h-[18px]" aria-hidden="true" />
    </button>
  );
};

const TopBar = ({
  image,
  isProcessing,
  hasArea,
  planCount = 1,
  canOpenPlan = true,
  // file
  onFileOpen,
  onPasteImage,
  onExport,
  onCopyExhibit,
  onSaveProject,
  onSaveProjectAs,
  onSaveAllProjects,
  onNewPlan,
  onCloseActivePlan,
  onCloseAllPlans,
  onOpenSettings,
  // help
  onHelpOpen,
  // view
  onFitToWindow,
  onZoomIn,
  onZoomOut,
  onRotate,
  dockOpen,
  onDockToggle,
  showSideLengths,
  onShowSideLengthsChange,
  autoSnapEnabled,
  onAutoSnapChange,
}) => {
  const { openId, open, close } = useOneOpenMenu();
  const { canUndo, canRedo } = useUndoHistory();

  const busy = !image || isProcessing;
  const DockIcon = dockOpen ? PanelLeftClose : PanelLeftOpen;

  return (
    <header className="flex items-center h-12 px-2.5 bg-panel-2 border-b border-line select-none shrink-0">
      {/* The name, and only the name. The mark used to be a button that closed
          every open plan — a destructive command on the one target people
          click to "go home", guarded only by a dialog. Closing lives in File. */}
      <span className="flex items-center gap-2 pl-1 pr-3 shrink-0 text-[15px] font-semibold text-fg">
        <FloorTraceMark className="w-[18px] h-[18px] text-fg-2" />
        <span>FloorTrace</span>
      </span>

      {/* Every dropdown in this band closes on a window `mousedown`; the
          swallow that keeps opening one from closing it again lives on the
          triggers and on the panels themselves, never on a wrapper. On a
          wrapper it also swallowed the plain commands beside them, and
          `useKeyboardShortcuts` reads mouse buttons 3/4 off that same event. */}
      <div className="flex items-center self-stretch gap-0.5 shrink-0">
        <Title id="file" label="File" openId={openId} onOpen={open} onClose={close}>
          <MenuItem label="Open floor plan…" keys={`${MOD}+O`} onSelect={onFileOpen} close={close} />
          <MenuItem label="Paste floor plan" keys={`${MOD}+V`} onSelect={onPasteImage} close={close} />
          <Sep />
          {/* The image of the finished measurement is the document almost every
              trace is made for, so it sits above the project file. */}
          <MenuItem label="Export image…" keys={`${MOD}+E`} disabled={busy} onSelect={onExport} close={close} />
          <MenuItem label="Copy image" keys={`${MOD}+${ALT}+C`} disabled={busy} onSelect={onCopyExhibit} close={close} />
          <Sep />
          <MenuItem label="Save project file" keys={`${MOD}+S`} disabled={!image} onSelect={() => onSaveProject(false)} close={close} />
          <MenuItem label="Save project file as…" keys={`${MOD}+Shift+S`} disabled={!image} onSelect={onSaveProjectAs} close={close} />
          {planCount > 1 && (
            <MenuItem label="Save all plans" onSelect={onSaveAllProjects} close={close} />
          )}
          <Sep />
          <MenuItem label="New plan tab" keys={`${MOD}+${ALT}+N`} disabled={!canOpenPlan} onSelect={onNewPlan} close={close} />
          {/* Two commands, not one: closing the plan you are looking at is a
              different act from closing every plan. The second is only listed
              when there is more than one, where it means something different. */}
          <MenuItem label="Close plan" danger disabled={!image} onSelect={onCloseActivePlan} close={close} />
          {planCount > 1 && (
            <MenuItem label="Close all plans" danger onSelect={onCloseAllPlans} close={close} />
          )}
          <Sep />
          <MenuItem label="Settings…" onSelect={onOpenSettings} close={close} />
        </Title>

        <Title id="view" label="View" openId={openId} onOpen={open} onClose={close}>
          <MenuItem label="Fit plan to window" keys="F" disabled={!image} onSelect={onFitToWindow} close={close} />
          <MenuItem label="Zoom in" disabled={!image} onSelect={onZoomIn} close={close} />
          <MenuItem label="Zoom out" disabled={!image} onSelect={onZoomOut} close={close} />
          <Sep />
          <MenuItem label="Rotate right 45°" keys="R" disabled={!image} onSelect={() => onRotate('clockwise')} close={close} />
          <MenuItem label="Rotate left 45°" keys="Shift+R" disabled={!image} onSelect={() => onRotate('counterclockwise')} close={close} />
          <Sep />
          <MenuItem
            label="Measurement panel"
            keys="O"
            checked={dockOpen}
            onSelect={onDockToggle}
            close={close}
          />
          <MenuItem
            label="Wall lengths on the plan"
            keys="L"
            checked={showSideLengths}
            onSelect={() => onShowSideLengthsChange(!showSideLengths)}
            close={close}
          />
          <MenuItem
            label="Snap corners to walls"
            checked={autoSnapEnabled}
            onSelect={() => onAutoSnapChange(!autoSnapEnabled)}
            close={close}
          />
        </Title>

        <Title id="help" label="Help" openId={openId} onOpen={open} onClose={close}>
          <MenuItem label="How to use FloorTrace…" onSelect={() => onHelpOpen('guide')} close={close} />
          <MenuItem label="Keyboard shortcuts…" onSelect={() => onHelpOpen('shortcuts')} close={close} />
          <Sep />
          {/* Behind its own rule: everything above stays in the app, and this
              leaves it — a walkthrough of the tracer, built from the real
              pipeline against the same drawing the welcome screen offers. */}
          <MenuItem
            label="How automatic tracing works"
            external
            onSelect={openTracingTutorial}
            close={close}
          />
        </Title>
      </div>

      <Rule />

      <div className="flex items-center gap-1 flex-1 min-w-0">
        {/* Labelled: it is the first thing anyone needs, and the one command
            here that is not self-explanatory as a picture. */}
        <button
          type="button"
          onClick={onFileOpen}
          disabled={isProcessing}
          className="toolbar-btn"
          title={`Open a floor plan — an image, a PDF or a project file (${MOD}+O)`}
        >
          <FolderOpen className="w-[18px] h-[18px]" aria-hidden="true" />
          <span>Open</span>
        </button>

        {image && (
          <>
            <IconButton icon={Undo2} label="Undo" title={`Undo (${MOD}+Z)`} onClick={undoManager.undo} disabled={!canUndo} />
            <IconButton icon={Redo2} label="Redo" title={`Redo (${MOD}+Shift+Z)`} onClick={undoManager.redo} disabled={!canRedo} />
          </>
        )}

        <div className="flex-1 min-w-[12px]" />

        {image && (
          <>
            <IconButton
              icon={DockIcon}
              label={`${dockOpen ? 'Hide' : 'Show'} the measurement panel`}
              title={`${dockOpen ? 'Hide' : 'Show'} the measurement panel (O)`}
              onClick={onDockToggle}
              aria-pressed={dockOpen}
            />
            <Rule />
            {/* Outlined and never filled: see the note at the top. */}
            <button
              type="button"
              onClick={onExport}
              disabled={busy}
              className={`toolbar-btn toolbar-btn-stage ${hasArea ? 'toolbar-btn-ready' : ''}`}
              title={`Export an image of the plan and its measurements (${MOD}+E)`}
            >
              <Share className="w-[17px] h-[17px]" aria-hidden="true" />
              <span>Export</span>
            </button>
          </>
        )}
      </div>
    </header>
  );
};

export default TopBar;
