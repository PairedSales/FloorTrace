import { useState, useRef, useEffect, useCallback } from 'react';
import {
  FolderOpen, Share, ScanSearch, ScanText, Maximize, Undo2, Redo2,
  PanelLeftClose, PanelLeftOpen, ChevronDown,
} from 'lucide-react';
import FloorTraceMark from './FloorTraceMark';
import { MenuItem, Sep, Popover } from './menuSurface';
import { MOD, ALT } from '../utils/keySymbols';
import { THEME_LABEL } from '../hooks/useTheme';
import { planStage } from '../utils/planStage';
import useUndoHistory from '../hooks/useUndoHistory';
import useWorkspaceStore from '../store/workspaceStore';
import * as undoManager from '../store/undoManager';

/**
 * The whole top band: identity, menus and commands, in one component that owns
 * its own height, surface and rule.
 *
 * It was two — `MenuBar` rendering the left group and `CommandBar` the right,
 * both deliberately bare so `App.jsx` could own the band they shared. That
 * split cost more than the seam it avoided. Fourteen props were passed to both,
 * and the copies had already drifted into defects: `MenuBar` was never handed
 * `isProcessing`, so the Trace menu could start a second scan over a running
 * one that the button beside it was disabled to prevent, and the seven-outline
 * cap existed on the button and not on the menu item. One component cannot
 * disagree with itself.
 *
 * ## Four groups, three rules
 *
 *   [ mark · File · View ] │ [ Open · Undo · Redo ] │ [ the three verbs ] ⋯ │ [ view ]
 *
 * **Only the middle group carries words**, and it is the job in order: read the
 * dimensions, find the outline, export the result. That is the whole hierarchy
 * statement — the labelled things are the pipeline, and everything else in the
 * row is an icon because everything else is a utility. The row used to print
 * five verbs of equal weight (Read dimensions, Select room, Find outline, Paint
 * outline, Add outline) at 576 px, of which four were also in the Trace menu
 * and one was also in the tool rail.
 *
 * ## What left, and where it went
 *
 * The rule applied was: **the rail owns modes, this row owns commands, and the
 * corrections for a stage hang off that stage's own verb.**
 *
 *  - *Paint outline* and *Place corners* are modal tools. They keep their rail
 *    buttons and their digits, and appear here only inside the outline caret —
 *    which is the point of the caret: when the automatic trace disappoints you,
 *    the rescue is under the button that just disappointed you, not on the far
 *    side of the window.
 *  - *Select room to scale from* moved to the caret on Read dimensions **and**
 *    to the dock's Scale card. You discover the scale is wrong by reading the
 *    dock, and a bad room implies a scale that can be 58–90% out — which, since
 *    area goes as scale squared, is the most consequential correction the app
 *    has. It does not belong behind a menu title.
 *  - *Add another outline* is in the outline caret and on the dock's Outlines
 *    card, both gated at `MAX_TRACES`. The menu item used to offer an eighth.
 *  - *Theme* is a session preference and is in View, where it is named in full.
 *    An icon that changed with the setting sat at the same weight as Fit.
 *  - The **Trace menu is gone**. Its seven items are the two carets, which is
 *    what pays for them: three titles at 138 px bought two carets at 56 px and
 *    a row that fits at the 820 px desktop minimum for the first time — it
 *    overflowed by ~353 px before, so Export and every view control were behind
 *    a horizontal scroll on any window under ~1250 px.
 *
 * ## The primary moves, and it is never Export
 *
 * Exactly one control carries the filled accent, and it is the stage the plan
 * is actually at (`planStage`): Read dimensions until there is a scale, then
 * Find outline until there is an outline, then **nothing**. Export earns the
 * outlined `ready` treatment when there is an area and never the fill — a
 * filled accent over a `fair` trace is a wrong answer that looks green, in the
 * part of the shell read first.
 *
 * Two invariants hold that together and are easy to break:
 *
 *  - **A disabled control is never the primary.** Filled accent at 40% opacity
 *    is 1.76:1, and the old row hard-wired the fill onto Find outline, so first
 *    paint showed an unreadable primary over an empty canvas.
 *  - **The primary may not change any control's width.** `.toolbar-btn-stage`
 *    carries the weight permanently and the border box permanently; `-primary`
 *    and `-ready` only recolour. Otherwise the row reflows as the stage
 *    advances, which is the same defect as a button moving under the cursor.
 *
 * The row also no longer swaps a slot mid-gesture. Painting used to replace
 * *Find outline* with *Trace my outline* — while the status bar, which is the
 * context bar and owns every running mode, printed a button with that exact
 * string 30 px below it. One of the two had to go and it was not the one
 * holding the Cancel and the brush size.
 */
// One open dropdown at a time across the band, titles and carets alike. It is
// also what `keyboardGuard` reads: with a menu open, `1` used to enter draw
// mode behind it and `O` to toggle the dock the open View menu was describing.
const useOneOpenMenu = () => {
  const [openId, setOpenId] = useState(null);
  const hoverMode = useRef(false);
  const setMenuOpen = useWorkspaceStore((s) => s.setMenuOpen);

  const close = useCallback(() => { setOpenId(null); hoverMode.current = false; }, []);
  const open = useCallback((id, viaHover = false) => {
    // Hover only switches between titles once a menu is already open.
    if (viaHover && !hoverMode.current) return;
    hoverMode.current = true;
    setOpenId(id);
  }, []);

  useEffect(() => { setMenuOpen(!!openId); }, [openId, setMenuOpen]);
  useEffect(() => () => setMenuOpen(false), [setMenuOpen]);

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

  return { openId, open, close };
};

const Rule = () => <div className="w-px h-5 bg-line mx-1.5 shrink-0" aria-hidden="true" />;

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
        className={`inline-flex h-8 items-center px-2.5 rounded-md text-[12.5px] transition-colors cursor-pointer
          ${open ? 'bg-sunken text-fg' : 'text-fg-2 hover:bg-sunken hover:text-fg'}`}
      >
        {label}
      </button>
      <Popover open={open} labelledBy={`menu-${id}`}>{children}</Popover>
    </div>
  );
};

/**
 * A stage verb and the other ways to do it. One tab stop each half, because
 * they are two commands: the main half runs the default, the caret half opens
 * the list — and a keyboard user who never opens the list never has to know
 * there are two.
 *
 * The caret's open state is `sunken`, not `accent`. This row has exactly one
 * accent meaning now — "this is the step you are on" — and a tinted caret would
 * be a second.
 */
const SplitButton = ({
  id, icon, label, title, primary, disabled, onClick,
  openId, onOpen, onClose, menuLabel, children,
}) => {
  const Icon = icon;
  const open = openId === id;
  return (
    <div className="relative flex items-center shrink-0">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        title={title}
        aria-current={primary ? 'step' : undefined}
        className={`toolbar-btn toolbar-btn-stage rounded-r-none pr-2 border-r-0
                    ${primary ? 'toolbar-btn-primary' : ''}`}
      >
        <Icon className="w-[15px] h-[15px]" aria-hidden="true" />
        <span>{label}</span>
      </button>
      {/* Both halves take the fill together, so the primary reads as one object
          rather than a filled button with a ghost caret glued to it. Only the
          hairline between them changes tone. */}
      <button
        type="button"
        id={`caret-${id}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={menuLabel}
        onClick={() => (open ? onClose() : onOpen(id))}
        onMouseDown={(e) => e.stopPropagation()}
        className={`toolbar-btn toolbar-btn-stage rounded-l-none px-1 border-l
                    ${primary
                      ? 'toolbar-btn-primary border-l-accent-ink/25'
                      : `border-l-line-soft ${open ? 'bg-sunken text-fg' : ''}`}`}
      >
        <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
      </button>
      <Popover open={open} labelledBy={`caret-${id}`}>{children}</Popover>
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
      className="toolbar-btn px-2"
      title={title ?? label}
      aria-label={label}
      {...rest}
    >
      <Icon className="w-4 h-4" aria-hidden="true" />
    </button>
  );
};

const TopBar = ({
  image,
  isProcessing,
  hasArea,
  calibrated,
  perimeterTraces,
  drawModeActive,
  ocrFailed,
  lastTraceOutcome,
  alternativeCount = 0,
  onUseAlternative,
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
  onNextPlan,
  onPrevPlan,
  onCloseActivePlan,
  onCloseAllPlans,
  onHelpOpen,
  // scale stage
  onFindRoomSize,
  onSelectRoom,
  canSelectRoom,
  onScaleTool,
  // outline stage
  onTracePerimeter,
  onPaintOutline,
  onPlaceCorners,
  onAddOutline,
  // view
  onFitToWindow,
  dockOpen,
  onDockToggle,
  showSideLengths,
  onShowSideLengthsChange,
  autoSnapEnabled,
  onAutoSnapChange,
  // preferences
  saveOnExit,
  onSaveOnExitChange,
  enhancedOcr,
  onEnhancedOcrChange,
  theme,
  onCycleTheme,
}) => {
  const { openId, open, close } = useOneOpenMenu();
  const { canUndo, canRedo } = useUndoHistory();
  // Read here rather than threaded from App: it is window state, not a
  // workflow decision, and the dock reads the same two fields directly.
  const showWork = useWorkspaceStore((s) => s.showWork);
  const setShowWork = useWorkspaceStore((s) => s.setShowWork);

  // Only the two fields that decide weight; the dock's StageSpine feeds the
  // same function the rest and prints all four stages from it. `ocrFailed` and
  // `lastTraceOutcome` are what let the primary stop pointing at the action
  // that has just failed — re-pressing "Read dimensions" after an empty scan
  // hits the memoised result and fails identically.
  const { primary, canAddOutline } = planStage({
    image, calibrated, perimeterTraces, ocrFailed, lastTraceOutcome,
  });

  const busy = !image || isProcessing;
  // The primary is an instruction, and an instruction you cannot follow is
  // worse than none — so it never lands on a control that is disabled.
  const scalePrimary = (primary === 'scale' || primary === 'scale-manual') && !busy;
  const outlinePrimary = (primary === 'outline' || primary === 'outline-paint')
    && !busy && !drawModeActive;
  const DockIcon = dockOpen ? PanelLeftClose : PanelLeftOpen;

  return (
    <header className="flex items-center h-10 px-2 bg-panel-2 border-b border-line select-none shrink-0">
      {/* The word costs ~73 px of a row shared with every verb and it is the one
          thing in it that does nothing. Below 1280 the mark carries the identity
          alone and the commands get the width. */}
      <span className="flex items-center gap-2 pr-1.5 xl:pr-2.5 shrink-0 text-[12.5px] font-semibold text-fg">
        {/* The mark alone is the button, not the word beside it — the word stays
            plain text so this stays out of the row's "only three labelled verbs"
            contract. `onCloseAllPlans` already confirms per plan when there is
            work to lose and empties the last one in place, which is exactly
            "start fresh" for one plan or several. */}
        <button
          type="button"
          onClick={onCloseAllPlans}
          disabled={isProcessing}
          aria-label="Start fresh — close every open plan"
          title="Start fresh — close every open plan"
          className="rounded text-fg-3 hover:text-fg disabled:opacity-40 disabled:pointer-events-none"
        >
          <FloorTraceMark className="w-[15px] h-[15px]" />
        </button>
        <span className="hidden xl:inline">FloorTrace</span>
      </span>

      {/* Every dropdown in this band closes on a window `mousedown`; the
          swallow that keeps opening one from closing it again lives on the
          triggers and on the panels themselves, never on a wrapper. On a
          wrapper it also swallowed the plain commands beside them, and
          `useKeyboardShortcuts` reads mouse buttons 3/4 off that same event. */}
      <div className="flex items-center self-stretch gap-0.5 shrink-0">
        {/* Export sits above the project file and says what it is for. Almost
            every trace is made for one appraisal and never reopened, so the
            image of the finished measurement is the document — the `.floorplan`
            is the copy you keep only if you mean to come back to it. */}
        <Title id="file" label="File" openId={openId} onOpen={open} onClose={close}>
          {/* First, because it is what someone opens this menu for when they do
              not yet know the names of anything else in it. */}
          <MenuItem label="Shortcuts & tips" onSelect={onHelpOpen} close={close} />
          <Sep />
          <MenuItem label="Open plan or project…" keys={`${MOD}+O`} onSelect={onFileOpen} close={close} />
          <MenuItem label="Paste plan from clipboard" keys={`${MOD}+V`} onSelect={onPasteImage} close={close} />
          <Sep />
          <MenuItem label="Export for workfile…" keys={`${MOD}+E`} disabled={busy} onSelect={onExport} close={close} />
          <MenuItem label="Copy measurement image" keys={`${MOD}+${ALT}+C`} disabled={busy} onSelect={onCopyExhibit} close={close} />
          <Sep />
          <MenuItem label="Save editable project" keys={`${MOD}+S`} disabled={!image} onSelect={() => onSaveProject(false)} close={close} />
          <MenuItem label="Save editable project as…" keys={`${MOD}+Shift+S`} disabled={!image} onSelect={onSaveProjectAs} close={close} />
          <MenuItem label="Save all plans" disabled={planCount < 2} onSelect={onSaveAllProjects} close={close} />
          <Sep />
          <MenuItem label="New plan" keys={`${MOD}+${ALT}+N`} disabled={!canOpenPlan} onSelect={onNewPlan} close={close} />
          <MenuItem label="Next plan" keys={`${MOD}+${ALT}+→`} disabled={planCount < 2} onSelect={onNextPlan} close={close} />
          <MenuItem label="Previous plan" keys={`${MOD}+${ALT}+←`} disabled={planCount < 2} onSelect={onPrevPlan} close={close} />
          <Sep />
          {/* Closing lives here rather than on the logo. Clicking a wordmark to
              wipe the project was a destructive action on the least expected
              target, warned about only in a tooltip. Two commands, not one:
              closing the plan you are looking at is a different act from
              closing every plan. */}
          <MenuItem label="Close plan" danger disabled={!image} onSelect={onCloseActivePlan} close={close} />
          <MenuItem label="Close all plans" danger disabled={planCount < 2} onSelect={onCloseAllPlans} close={close} />
          <Sep />
          {/* Session-wide preferences rather than anything done to a file, so
              they sit past the close commands where nothing lands on them by
              accident. */}
          <MenuItem
            label="Save work on exit"
            checked={saveOnExit}
            onSelect={() => onSaveOnExitChange(!saveOnExit)}
            close={close}
          />
          <MenuItem
            label="Enhanced dimension reading"
            checked={enhancedOcr}
            onSelect={() => onEnhancedOcrChange(!enhancedOcr)}
            close={close}
          />
        </Title>

        <Title id="view" label="View" openId={openId} onOpen={open} onClose={close}>
          <MenuItem label="Fit plan to window" keys="F" disabled={!image} onSelect={onFitToWindow} close={close} />
          <MenuItem
            label={`${dockOpen ? 'Hide' : 'Show'} measurement panel`}
            keys="O"
            onSelect={onDockToggle}
            close={close}
          />
          <Sep />
          <MenuItem
            label="Show side lengths"
            keys="L"
            checked={showSideLengths}
            onSelect={() => onShowSideLengthsChange(!showSideLengths)}
            close={close}
          />
          <MenuItem
            label="Snap to walls"
            checked={autoSnapEnabled}
            onSelect={() => onAutoSnapChange(!autoSnapEnabled)}
            close={close}
          />
          <MenuItem
            label="Show the area calculation"
            checked={showWork}
            onSelect={() => setShowWork(!showWork)}
            close={close}
          />
          <Sep />
          <MenuItem
            label={`Theme: ${THEME_LABEL[theme] ?? 'System'}`}
            onSelect={onCycleTheme}
            close={close}
          />
        </Title>
      </div>

      <Rule />

      <div className="flex items-center gap-0.5 flex-1 min-w-0 overflow-x-auto">
        {/* Icon-only, with the label carried by the empty plan itself: a plan
            you have not opened yet is the whole screen, and it now offers the
            button. Once one is open this is a rare command with three other
            routes (Ctrl+O, the File menu, and dropping a file on the canvas). */}
        <IconButton
          icon={FolderOpen}
          label="Open a plan or project"
          title="Open a plan or project (Ctrl+O)"
          onClick={onFileOpen}
          disabled={isProcessing}
        />

        <IconButton icon={Undo2} label="Undo" title="Undo (Ctrl+Z)" onClick={undoManager.undo} disabled={!canUndo} />
        <IconButton icon={Redo2} label="Redo" title="Redo (Ctrl+Shift+Z)" onClick={undoManager.redo} disabled={!canRedo} />

        <Rule />

        {/* ── the job, in order ── */}
        <div className="flex items-center gap-0.5 shrink-0">
          <SplitButton
            id="scale"
            icon={ScanText}
            label="Read dimensions"
            title="Read the printed dimension labels on this plan"
            primary={scalePrimary}
            disabled={busy}
            onClick={onFindRoomSize}
            openId={openId}
            onOpen={open}
            onClose={close}
            menuLabel="More ways to set the scale"
          >
            <MenuItem label="Read dimensions" disabled={busy} onSelect={onFindRoomSize} close={close} />
            {/* The way out when the automatic choice is wrong. It puts the
                labels already read back on screen as pills without reading them
                again — there is nothing to pick from until a scan has found
                something, which is what the disabled state says. */}
            <MenuItem
              label="Select room to scale from"
              disabled={!canSelectRoom || isProcessing}
              onSelect={onSelectRoom}
              close={close}
            />
            <Sep />
            <MenuItem label="Set the scale by hand" keys="4" disabled={busy} onSelect={onScaleTool} close={close} />
          </SplitButton>

          <SplitButton
            id="outline"
            icon={ScanSearch}
            label="Find outline"
            title="Find the exterior outline automatically"
            primary={outlinePrimary}
            disabled={busy || drawModeActive}
            onClick={onTracePerimeter}
            openId={openId}
            onOpen={open}
            onClose={close}
            menuLabel="More ways to make an outline"
          >
            <MenuItem label="Find outline" disabled={busy || drawModeActive} onSelect={onTracePerimeter} close={close} />
            {/* The search's own runner-up, which it scored and until now threw
                away. When two candidates sit within SCORE_EPSILON of each other
                and the wrong one won, this is the whole correction — so it sits
                directly under the verb that got it wrong. Hidden rather than
                disabled when there is none: an option that is never available
                on a clean trace is noise on every clean trace. */}
            {alternativeCount > 0 && (
              <MenuItem
                label={alternativeCount > 1
                  ? `Try the next-best outline (${alternativeCount} left)`
                  : 'Try the next-best outline'}
                disabled={busy || drawModeActive}
                onSelect={onUseAlternative}
                close={close}
              />
            )}
            <MenuItem label="Paint outline" keys="1" disabled={busy} onSelect={onPaintOutline} close={close} />
            <MenuItem label="Place corners" keys="2" disabled={busy} onSelect={onPlaceCorners} close={close} />
            <Sep />
            <MenuItem
              label="Add another outline"
              disabled={!canAddOutline}
              onSelect={onAddOutline}
              close={close}
            />
          </SplitButton>

          {/* The last step of the job, and the only one most sessions ever need
              to reach twice. It stays put and stays enabled from the moment a
              plan is open — it earns emphasis once there is an area to export,
              rather than appearing at that moment and moving everything beside
              it. Outlined and never filled: see the note at the top. */}
          <button
            type="button"
            onClick={onExport}
            disabled={busy}
            className={`toolbar-btn toolbar-btn-stage ${hasArea ? 'toolbar-btn-ready' : ''}`}
            title="Export an image of the plan and its measurements (Ctrl+E)"
          >
            <Share className="w-[15px] h-[15px]" aria-hidden="true" />
            <span>Export</span>
          </button>
        </div>

        <div className="flex-1 min-w-[12px]" />

        <Rule />

        {/* The view end, ordered by widening scope: one action on the plan, then
            the one piece of chrome this row still switches. The tool-rail toggle
            stood here until the rail became one width — a rail that says what
            its icons are when you point at one has nothing left to switch — and
            the theme followed it into View, where it is named in full. */}
        <IconButton
          icon={Maximize}
          label="Fit the plan to the window"
          title="Fit the plan to the window (F)"
          onClick={onFitToWindow}
          disabled={!image}
        />
        <IconButton
          icon={DockIcon}
          label={`${dockOpen ? 'Hide' : 'Show'} the measurement panel`}
          title={`${dockOpen ? 'Hide' : 'Show'} the measurement panel (O)`}
          onClick={onDockToggle}
          aria-pressed={dockOpen}
        />
      </div>
    </header>
  );
};

export default TopBar;
