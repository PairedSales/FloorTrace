import { useEffect } from 'react';
import useAppStore from '../store/appStore';
import * as undoManager from '../store/undoManager';

/**
 * useKeyboardShortcuts
 *
 * Registers and cleans up all window-level input event listeners:
 *  - keydown: Ctrl+V (paste), Ctrl+O (file open), Ctrl+Z/Y (undo/redo),
 *             [ / ] (eraser brush size), O (toggle options), L (toggle side lengths)
 *  - mousedown: side buttons 3/4 for undo/redo
 *  - contextmenu: suppressed unless text is selected
 *
 * Pure side-effect hook — no return value.
 *
 * @param {object} config
 * @param {() => void} config.onPaste        - triggered by Ctrl+V
 * @param {() => void} config.onFileOpen     - triggered by Ctrl+O
 * @param {boolean}    config.eraserToolActive
 * @param {number}     config.eraserBrushSize
 * @param {(size: number) => void} config.setEraserBrushSize
 */
export function useKeyboardShortcuts({ onPaste, onFileOpen, eraserToolActive, eraserBrushSize, setEraserBrushSize }) {
  // ── keydown ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Eraser brush size shortcuts (no modifier keys required)
      if (!e.ctrlKey && !e.metaKey) {
        if (e.key === '[' && eraserToolActive) {
          e.preventDefault();
          setEraserBrushSize(Math.max(4, eraserBrushSize - 4));
          return;
        }
        if (e.key === ']' && eraserToolActive) {
          e.preventDefault();
          setEraserBrushSize(Math.min(200, eraserBrushSize + 4));
          return;
        }
        if (e.key.toLowerCase() === 'o') {
          if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA' && !e.target.isContentEditable) {
            e.preventDefault();
            const s = useAppStore.getState();
            s.setShowPanelOptions(!s.showPanelOptions);
            return;
          }
        }
        if (e.key.toLowerCase() === 'l') {
          if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA' && !e.target.isContentEditable) {
            e.preventDefault();
            const s = useAppStore.getState();
            s.setShowSideLengths(!s.showSideLengths);
            return;
          }
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
  }, [onPaste, onFileOpen, eraserToolActive, eraserBrushSize, setEraserBrushSize]);

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
