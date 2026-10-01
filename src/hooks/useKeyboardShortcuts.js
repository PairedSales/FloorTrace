import { useEffect } from 'react';
import useAppStore from '../store/appStore';
import useWorkspaceStore from '../store/workspaceStore';
import * as undoManager from '../store/undoManager';
import { isTypingInField, shortcutsBlocked } from '../utils/keyboardGuard';
import { MAX_OPEN_DOCUMENTS } from '../store/documentManager';

// Trace switching covers the whole trace list, which traceManager caps at seven
// colours — so it stops at 7.
const TRACE_DIGIT_COUNT = 7;

// Plan switching stops at the number of plans that can be open, the same way
// trace switching stops at the colours traceManager hands out. One constant
// each, so neither drifts from what it is counting.
const PLAN_DIGIT_COUNT = MAX_OPEN_DOCUMENTS;

/**
 * useKeyboardShortcuts
 *
 * Registers and cleans up all window-level input event listeners:
 *  - keydown: Ctrl+V (paste), Ctrl+O (file open), Ctrl+Z/Y (undo/redo),
 *             Ctrl+E (export dialog), Ctrl+Alt+C (copy the exhibit image),
 *             O (results panel), L (toggle side lengths),
 *             R / Shift+R (rotate the canvas either way), F (fit to window),
 *             Alt/Shift+1…7 (switch perimeter trace)
 *  - mousedown: side buttons 3/4 for undo/redo
 *  - contextmenu: suppressed unless text is selected
 *
 * Pure side-effect hook — no return value.
 *
 * @param {object} config
 * @param {() => void} config.onPaste        - triggered by Ctrl+V
 * @param {() => void} config.onFileOpen     - triggered by Ctrl+O
 * @param {(isSaveAs: boolean) => void} config.onSaveProject - triggered by Ctrl+S / Ctrl+Shift+S
 */
export function useKeyboardShortcuts({
  onNewPlan,
  onStepPlan,
  onSelectPlan,
  onPaste,
  onFileOpen,
  onSaveProject,
  onExport,
  onCopyExhibit,
  onRotateCanvas,
  onFitToWindow,
}) {
  // ── keydown ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Don't hijack shortcuts while typing — text fields need native Ctrl+V/Z/A etc.
      // Ctrl+S still saves the project (harmless mid-edit, blocks the browser dialog).
      if (isTypingInField(e.target)) {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
          e.preventDefault();
          onSaveProject(e.shiftKey);
        }
        return;
      }

      if (shortcutsBlocked(e.target)) return;

      // Unmodified keys
      if (!e.ctrlKey && !e.metaKey) {
        if (e.key.toLowerCase() === 'o') {
          e.preventDefault();
          // Show or hide the results panel.
          const w = useWorkspaceStore.getState();
          w.setPanelOpen(!w.panelOpen);
          return;
        }
        if (e.key.toLowerCase() === 'l') {
          e.preventDefault();
          const s = useAppStore.getState();
          s.setShowSideLengths(!s.showSideLengths);
          return;
        }
        if (e.key.toLowerCase() === 'r') {
          e.preventDefault();
          // Counter-clockwise is Shift+R: Ctrl+R is the browser's reload on
          // every platform and taking it stranded the user on a wedged page.
          onRotateCanvas?.(e.shiftKey ? 'counterclockwise' : 'clockwise');
          return;
        }
        if (e.key.toLowerCase() === 'f') {
          e.preventDefault();
          onFitToWindow?.();
          return;
        }

        // The physical key, not e.key: Shift+1 arrives as '!' and Alt+1 as '¡'
        // on macOS, so e.key cannot tell which digit was actually pressed.
        const digit = /^Digit[1-9]$/.test(e.code || '') ? e.code.slice(5) : null;
        if (digit) {
          e.preventDefault();
          // Outline switching. Firefox on Windows/Linux eats Alt+1–8 for tab
          // switching, so Shift is bound as an alias. A bare digit does nothing.
          if (e.altKey || e.shiftKey) {
            const index = Number(digit) - 1;
            if (index >= TRACE_DIGIT_COUNT) return;
            const s = useAppStore.getState();
            const trace = s.perimeterTraces?.[index];
            if (trace) s.switchPerimeterTrace(trace.id);
            return;
          }
          return;
        }
      }

      // ── plan switching ──────────────────────────────────────────────────
      // Ctrl+Alt, because every obvious chord is owned by the browser and not
      // preventable from a page: Ctrl+T, Ctrl+W, Ctrl+Shift+T, Ctrl+Tab,
      // Ctrl+PageUp/Down and Ctrl+1–9 all belong to the tab strip above us.
      // Taking one and having it half-work is worse than not offering it.
      // Ctrl+Alt+W is avoided too — macOS Safari and Chrome take it.
      //
      // `Alt/Shift+1–7` stays on outlines. The two levels are different things
      // and must not share a key space.
      if ((e.ctrlKey || e.metaKey) && e.altKey) {
        const planDigit = /^Digit[1-9]$/.test(e.code || '') ? Number(e.code.slice(5)) : null;
        if (planDigit) {
          e.preventDefault();
          if (planDigit <= PLAN_DIGIT_COUNT) onSelectPlan?.(planDigit - 1);
          return;
        }
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          onStepPlan?.(1);
          return;
        }
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          onStepPlan?.(-1);
          return;
        }
        if (e.key.toLowerCase() === 'n') {
          e.preventDefault();
          onNewPlan?.();
          return;
        }
      }

      if (e.ctrlKey || e.metaKey) {
        const key = e.key.toLowerCase();

        switch (key) {
          case 'v':
            e.preventDefault();
            onPaste();
            break;
          case 'o':
            e.preventDefault();
            onFileOpen();
            break;
          case 's':
            e.preventDefault();
            onSaveProject(e.shiftKey); // Shift key held down -> Save As
            break;
          case 'e':
            e.preventDefault();
            onExport?.();
            break;
          case 'c':
            // Alt is what distinguishes it: plain Ctrl+C has to keep copying
            // the selection. Ctrl+Shift+C, the obvious pairing, is the element
            // inspector in every Chromium browser and in Firefox.
            if (e.altKey) {
              e.preventDefault();
              onCopyExhibit?.();
            }
            break;
          case 'z':
            e.preventDefault();
            if (e.shiftKey) {
              undoManager.redo();
            } else {
              undoManager.undo();
            }
            break;
          case 'y':
            e.preventDefault();
            undoManager.redo();
            break;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onPaste, onFileOpen, onSaveProject, onExport, onCopyExhibit,
    onRotateCanvas, onFitToWindow, onNewPlan, onStepPlan, onSelectPlan]);

  // ── mousedown: side buttons for undo/redo ─────────────────────────────────
  useEffect(() => {
    const handleMouseDown = (e) => {
      if (e.button === 3) {
        e.preventDefault();
        undoManager.undo();
      } else if (e.button === 4) {
        e.preventDefault();
        undoManager.redo();
      }
    };

    window.addEventListener('mousedown', handleMouseDown);
    return () => window.removeEventListener('mousedown', handleMouseDown);
  }, []);

  // ── contextmenu: suppress unless text is selected ─────────────────────────
  useEffect(() => {
    const handleContextMenu = (e) => {
      const selection = window.getSelection();
      const hasTextSelected = selection && selection.toString().length > 0;
      if (!hasTextSelected) {
        e.preventDefault();
      }
    };

    window.addEventListener('contextmenu', handleContextMenu);
    return () => window.removeEventListener('contextmenu', handleContextMenu);
  }, []);
}
