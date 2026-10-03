import {
  Undo2, Redo2, CircleHelp, Menu as MenuIcon, Check, RefreshCw, AlertTriangle, CloudOff,
} from 'lucide-react';
import FloorTraceMark from './FloorTraceMark';
import PlanTabs from './PlanTabs';
import { Menu, MenuItem, MenuSep } from './Menu';
import { MOD, ALT } from '../utils/keySymbols';
import useUndoHistory from '../hooks/useUndoHistory';
import useAppStore from '../store/appStore';
import * as undoManager from '../store/undoManager';

/**
 * The frame around the work: whose app this is, which plan is open, and the
 * handful of things that are about the whole window rather than about the plan.
 *
 *   [ ▣ FloorTrace ]  [ plan ][ plan ][ + Add plan ]   ✓ Autosaved  ↶ Undo  ↷ Redo  Help  Menu
 *
 * ## What it no longer is
 *
 * A menu bar. The band used to open with File, View and Help — some
 * twenty-five commands filed by which *kind* of command they were, the way a
 * word processor files them. Nobody arrives thinking "this is a View
 * command"; they arrive wanting to fit the plan on screen, and had to guess
 * which drawer it was in. Each of those commands now lives where it is used:
 *
 *  - fitting and zooming, on the plan (`ViewControls`);
 *  - turning, cropping and cleaning the plan, in the action bar's Edit plan;
 *  - saving the image, at the foot of the results it saves;
 *  - help, behind a button that says Help.
 *
 * What is left is one **Menu**: opening, saving, the three switches for how
 * the plan is shown, Settings, and closing. One place to look for anything
 * that is not on screen.
 *
 * ## No button here is filled
 *
 * The filled button is "Save image", and it is at the foot of the results
 * panel — under the figure it saves, and filled only when nothing is left to
 * check. A filled accent in the part of the window read first, over a
 * doubtful trace, is a wrong answer that looks finished.
 *
 * ## Autosave, said out loud
 *
 * The work exists only in this browser, so whether it is being kept is stated
 * rather than assumed. At rest it is one quiet word. When the answer is *no* —
 * autosave switched off, or the browser refusing the write — it becomes a
 * warning that stays put, because that is a risk rather than a fact.
 *
 * The mark is not a button: closing lives in the Menu, where it says what it
 * does.
 *
 * ## Every button here has a word on it
 *
 * Undo and Redo were two arrows. An arrow curling left is a convention, and a
 * convention is something a reader either already has or does not; the people
 * this app is for are not all people who have it. So they are labelled, like
 * Help and Menu beside them.
 */

const DRAFT = {
  saved: {
    Icon: Check, label: 'Autosaved', ok: true,
    title: 'Your work is saved in this browser as you go. Save an image, or a project file, to keep it anywhere else.',
  },
  pending: {
    Icon: RefreshCw, label: 'Saving…', ok: true, spin: true,
    title: 'Saving your latest changes in this browser.',
  },
  error: {
    Icon: AlertTriangle, label: 'Not saved', ok: false, chip: 'chip-crit',
    title: 'This browser would not store your work. Save an image, or a project file, before you close the tab.',
  },
  off: {
    Icon: CloudOff, label: 'Autosave is off', ok: false, chip: 'chip-warn',
    title: 'Autosave is turned off in Settings, so nothing is kept. Save an image, or a project file, before you close the tab.',
  },
};

const DraftState = () => {
  const draftState = useAppStore((s) => s.draftState);
  const draft = DRAFT[draftState] ?? DRAFT.off;
  const { Icon } = draft;

  if (!draft.ok) {
    return (
      <span className={`chip ${draft.chip} mr-1.5`} title={draft.title}>
        <Icon className="w-3.5 h-3.5" aria-hidden="true" />
        {draft.label}
      </span>
    );
  }
  return (
    // A fixed minimum, so "Saving…" turning into "Autosaved" does not nudge
    // the buttons beside it on every edit.
    <span
      className="inline-flex items-center justify-end gap-1.5 min-w-[104px] mr-1.5 text-[15px] text-fg-3 whitespace-nowrap"
      title={draft.title}
    >
      <Icon
        className={`w-3.5 h-3.5 ${draft.spin ? 'animate-spin' : 'text-ok'}`}
        aria-hidden="true"
      />
      {draft.label}
    </span>
  );
};

const Rule = () => <span className="w-px h-[26px] mx-1.5 bg-line shrink-0" aria-hidden="true" />;

const AppHeader = ({
  image,
  isProcessing,
  planCount = 1,
  // plans
  onSelectPlan,
  onClosePlan,
  onNewPlan,
  // opening and saving
  onFileOpen,
  onPasteImage,
  onExport,
  onCopyExhibit,
  onSaveProject,
  onSaveProjectAs,
  onSaveAllProjects,
  onCloseActivePlan,
  onCloseAllPlans,
  // the window
  onOpenSettings,
  onHelpOpen,
  panelOpen,
  onPanelToggle,
  showSideLengths,
  onShowSideLengthsChange,
  autoSnapEnabled,
  onAutoSnapChange,
}) => {
  const { canUndo, canRedo } = useUndoHistory();

  return (
    <header className="flex items-center gap-2.5 h-[60px] px-4 bg-panel-2 border-b border-line select-none shrink-0">
      <span className="flex items-center gap-2.5 pr-2.5 shrink-0 text-[19px] font-bold text-fg">
        <FloorTraceMark className="w-[22px] h-[22px] text-accent" />
        <span>FloorTrace</span>
      </span>

      <PlanTabs
        onSelect={onSelectPlan}
        onClose={onClosePlan}
        onNew={onNewPlan}
        isProcessing={isProcessing}
      />

      <div className="flex items-center gap-0.5 shrink-0">
        {image && (
          <>
            <DraftState />
            <button
              type="button"
              onClick={undoManager.undo}
              disabled={!canUndo}
              className="menu-trigger"
              title={`Undo (${MOD}+Z)`}
            >
              <Undo2 className="w-[18px] h-[18px]" aria-hidden="true" />
              Undo
            </button>
            <button
              type="button"
              onClick={undoManager.redo}
              disabled={!canRedo}
              className="menu-trigger"
              title={`Redo (${MOD}+Shift+Z)`}
            >
              <Redo2 className="w-[18px] h-[18px]" aria-hidden="true" />
              Redo
            </button>
            <Rule />
          </>
        )}

        <button
          type="button"
          onClick={() => onHelpOpen('guide')}
          className="menu-trigger"
          title="How to use FloorTrace, and the keyboard shortcuts"
        >
          <CircleHelp className="w-[18px] h-[18px]" aria-hidden="true" />
          Help
        </button>

        <Menu id="main" label="Menu" icon={MenuIcon} caret={false} align="right" width="w-[340px]">
          <MenuItem label="Open a floor plan…" keys={`${MOD}+O`} disabled={isProcessing} onSelect={onFileOpen} />
          <MenuItem label="Paste a floor plan" keys={`${MOD}+V`} disabled={isProcessing} onSelect={onPasteImage} />

          {/* Everything about the plan in front of you is listed only once
              there is one. On the start screen this menu used to open as eight
              greyed-out rows around the two that worked. */}
          {image && (
            <>
              <MenuSep />
              {/* The image of the finished measurement is what almost every
                  plan is opened for, so it sits above the project file. */}
              <MenuItem label="Save image…" keys={`${MOD}+E`} disabled={isProcessing} onSelect={onExport} />
              <MenuItem label="Copy image" keys={`${MOD}+${ALT}+C`} disabled={isProcessing} onSelect={onCopyExhibit} />
              <MenuItem
                label="Save project file"
                keys={`${MOD}+S`}
                title="A file you can open in FloorTrace later and keep working on"
                onSelect={() => onSaveProject(false)}
              />
              <MenuItem label="Save project file as…" keys={`${MOD}+Shift+S`} onSelect={onSaveProjectAs} />
            </>
          )}
          {/* The several-plan commands are listed only when there are several
              plans, where they mean something different from the ones above. */}
          {planCount > 1 && <MenuItem label="Save all plans" onSelect={onSaveAllProjects} />}

          {image && (
            <>
              <MenuSep />
              <MenuItem
                label="Wall lengths on the plan"
                keys="L"
                checked={showSideLengths}
                onSelect={() => onShowSideLengthsChange(!showSideLengths)}
              />
              <MenuItem
                label="Snap corners to walls"
                checked={autoSnapEnabled}
                onSelect={() => onAutoSnapChange(!autoSnapEnabled)}
              />
              <MenuItem label="Results panel" keys="O" checked={panelOpen} onSelect={onPanelToggle} />
            </>
          )}

          <MenuSep />
          <MenuItem label="Settings…" onSelect={onOpenSettings} />

          {(image || planCount > 1) && (
            <>
              <MenuSep />
              <MenuItem label="Close this plan" danger onSelect={onCloseActivePlan} />
              {planCount > 1 && <MenuItem label="Close all plans" danger onSelect={onCloseAllPlans} />}
            </>
          )}
        </Menu>
      </div>
    </header>
  );
};

export default AppHeader;
