import { useEffect } from 'react';
import useAppStore from '../store/appStore';
import * as undoManager from '../store/undoManager';

/**
 * useKeyboardShortcuts
 *
 * Registers and cleans up all window-level input event listeners:
 *  - keydown: Ctrl+V (paste), Ctrl+O (file open), Ctrl+Z/Y (undo/redo),
 *             [ / ] (eraser brush size), O (toggle options), L (toggle side lengths),
 *             R / Shift+R (rotate the canvas either way)
 *  - mousedown: side buttons 3/4 for undo/redo
 *  - contextmenu: suppressed unless text is selected
 *
 * Pure side-effect hook — no return value.
 *
 * @param {object} config
 * @param {() => void} config.onPaste        - triggered by Ctrl+V
 * @param {() => void} config.onFileOpen     - triggered by Ctrl+O
 * @param {(isSaveAs: boolean) => void} config.onSaveProject - triggered by Ctrl+S / Ctrl+Shift+S
 * @param {{field, setSize, min, max, step}|null} config.activeBrush - whichever
 *   brush tool is currently on; `[` and `]` resize it. There is more than one
 *   brush now, so the binding describes "the active brush" rather than naming
 *   the eraser. `field` is the store key rather than the value: key repeat
 *   delivers faster than React re-renders, and a captured value makes every
 *   press in one frame resolve to the same new size.
 */
export function useKeyboardShortcuts({ onPaste, onFileOpen, onSaveProject, activeBrush, onRotateCanvas }) {
  // ── keydown ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Don't hijack shortcuts while typing — text fields need native Ctrl+V/Z/A etc.
      // Ctrl+S still saves the project (harmless mid-edit, blocks the browser dialog).
      const isEditable = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable;
      if (isEditable) {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
          e.preventDefault();
          onSaveProject(e.shiftKey);
        }
        return;
      }

      // Escape drops the warning highlight. Deliberately does not consume the
      // event: anything else listening for Escape must still see it.
      if (e.key === 'Escape') useAppStore.getState().setFocusedWarning(null);

      // Brush size shortcuts (no modifier keys required)
      if (!e.ctrlKey && !e.metaKey) {
        if ((e.key === '[' || e.key === ']') && activeBrush) {
          e.preventDefault();
          const { field, setSize, min = 4, max = 200, step = 4 } = activeBrush;
          const size = useAppStore.getState()[field];
          const next = e.key === '[' ? size - step : size + step;
          setSize(Math.max(min, Math.min(max, next)));
          return;
        }
        if (e.key.toLowerCase() === 'o') {
          e.preventDefault();
          const s = useAppStore.getState();
          s.setShowPanelOptions(!s.showPanelOptions);
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
  }, [onPaste, onFileOpen, onSaveProject, activeBrush, onRotateCanvas]);

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
