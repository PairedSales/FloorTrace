import { useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import useAppStore from '../store/appStore';
import * as undoManager from '../store/undoManager';
import { isTypingInField, shortcutsBlocked } from '../utils/keyboardGuard';

// Trace switching covers the whole trace list, which floorManager caps at seven
// colours — so it stops at 7 even as the tool row below grows past it.
const TRACE_DIGIT_COUNT = 7;

/**
 * useKeyboardShortcuts
 *
 * Registers and cleans up all window-level input event listeners:
 *  - keydown: Ctrl+V (paste), Ctrl+O (file open), Ctrl+Z/Y (undo/redo),
 *             [ / ] (eraser brush size), O (toggle options), L (toggle side lengths),
 *             R / Shift+R (rotate the canvas either way), F (fit to window),
 *             1…n (select a tool), Alt/Shift+1…7 (switch perimeter trace)
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
export function useKeyboardShortcuts({
  onPaste,
  onFileOpen,
  onSaveProject,
  activeBrush,
  onRotateCanvas,
  onFitToWindow,
  hasArea,
  onLineToolToggle,
  onDrawAreaToggle,
  onAngleToolToggle,
  onOutlineByVertex,
  onCropToolToggle,
  onEraserToolToggle,
  onDrawExterior,
}) {
  // The digit → tool mapping is fixed, never renumbered by what the panel is
  // currently showing: a mapping that moves with app state is worse than one
  // that occasionally says why it did nothing. Append rows to extend it.
  const toolDigits = useMemo(() => [
    { digit: '1', label: 'Line', toggle: onLineToolToggle, available: hasArea, unavailable: 'Line needs a traced area first.' },
    { digit: '2', label: 'Area', toggle: onDrawAreaToggle, available: hasArea, unavailable: 'Area needs a traced area first.' },
    { digit: '3', label: 'Angle', toggle: onAngleToolToggle, available: hasArea, unavailable: 'Angle needs a traced area first.' },
    { digit: '4', label: 'Outline', toggle: onOutlineByVertex, available: true },
    { digit: '5', label: 'Crop', toggle: onCropToolToggle, available: true },
    { digit: '6', label: 'Eraser', toggle: onEraserToolToggle, available: true },
    { digit: '7', label: 'Draw Exterior', toggle: onDrawExterior, available: true },
  ], [
    hasArea,
    onLineToolToggle,
    onDrawAreaToggle,
    onAngleToolToggle,
    onOutlineByVertex,
    onCropToolToggle,
    onEraserToolToggle,
    onDrawExterior,
  ]);

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

      // Escape drops the warning highlight. Deliberately does not consume the
      // event: anything else listening for Escape must still see it. Sits after
      // the guard so an open help modal swallows the key instead.
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
          // Firefox on Windows/Linux eats Alt+1–8 for tab switching, so Shift
          // is bound as an alias for the same trace switch.
          if (e.altKey || e.shiftKey) {
            const index = Number(digit) - 1;
            if (index >= TRACE_DIGIT_COUNT) return;
            const s = useAppStore.getState();
            const trace = s.perimeterTraces?.[index];
            if (trace) s.switchPerimeterTrace(trace.id);
            return;
          }
          if (!useAppStore.getState().image) return;
          const tool = toolDigits.find((t) => t.digit === digit);
          if (!tool) return;
          if (!tool.available) {
            if (tool.unavailable) toast.info(tool.unavailable);
            return;
          }
          tool.toggle?.();
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
  }, [onPaste, onFileOpen, onSaveProject, activeBrush, onRotateCanvas, onFitToWindow, toolDigits]);

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
