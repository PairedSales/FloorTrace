import { Menu, Redo2, Share, Undo2 } from 'lucide-react';
import useUndoHistory from '../../hooks/useUndoHistory';
import * as undoManager from '../../store/undoManager';
import FloorTraceLogo from '../../assets/logo.svg';

/**
 * Four things earn the top of a phone screen, and the choice is not the desktop
 * menu bar shrunk.
 *
 * Undo and redo are here rather than in a menu because on touch the commonest
 * mistake is a stray fingertip — a corner nudged while panning, a stroke
 * started on the wrong wall. On the desktop that costs a Ctrl+Z; behind a
 * menu it costs three taps, and a correction that expensive stops being made.
 *
 * Export is here because it is the end of the job and the only reason the app
 * was opened. Everything else lives behind the menu button.
 */
const MobileTopBar = ({ image, subject, isProcessing, hasArea, onMenu, onExport }) => {
  const { canUndo, canRedo } = useUndoHistory();

  return (
    <header
      className="shrink-0 bg-panel border-b border-line-soft select-none pt-safe px-safe"
    >
      <div className="flex items-center gap-1 h-12 px-1">
        <button
          type="button"
          onClick={onMenu}
          aria-label="Menu"
          className="tap-target rounded-lg text-fg-2 active:bg-sunken active:text-fg"
        >
          <Menu className="w-[22px] h-[22px]" aria-hidden="true" />
        </button>

        {/* The subject line, once there is one. A workfile exhibit is filed
            under the property it measures, so the app says which one is open
            rather than repeating its own name back at the user. */}
        <div className="flex-1 min-w-0 px-1">
          {subject ? (
            <p className="text-[14px] font-semibold text-fg truncate leading-tight">{subject}</p>
          ) : (
            <span className="flex items-center gap-1.5 text-[14px] font-semibold text-fg">
              <img src={FloorTraceLogo} alt="" className="w-4 h-4" draggable="false" />
              FloorTrace
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={undoManager.undo}
          disabled={!canUndo}
          aria-label="Undo"
          className="tap-target rounded-lg text-fg-2 active:bg-sunken active:text-fg
                     disabled:opacity-30"
        >
          <Undo2 className="w-5 h-5" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={undoManager.redo}
          disabled={!canRedo}
          aria-label="Redo"
          className="tap-target rounded-lg text-fg-2 active:bg-sunken active:text-fg
                     disabled:opacity-30"
        >
          <Redo2 className="w-5 h-5" aria-hidden="true" />
        </button>

        <button
          type="button"
          onClick={onExport}
          disabled={!image || isProcessing}
          aria-label="Export for your workfile"
          className={`tap-target px-3 gap-1.5 rounded-lg text-[13px] font-semibold
                      disabled:opacity-30
                      ${hasArea
                        ? 'bg-accent text-accent-ink active:brightness-110'
                        : 'text-fg-2 active:bg-sunken active:text-fg'}`}
        >
          <Share className="w-[18px] h-[18px]" aria-hidden="true" />
          Export
        </button>
      </div>
    </header>
  );
};

export default MobileTopBar;
