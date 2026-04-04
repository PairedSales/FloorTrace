import useAppStore from './appStore';

const MAX_UNDO = 100;

let undoStack = [];
let redoStack = [];
let savedRedoStackForCancel = null; // Saved redo stack before last save, for cancelLastSave

/**
 * Save the current state as an undo point.
 * Call this at the start of a user action, BEFORE making changes.
 * No-op if no image is loaded.
 */
export function save() {
  savedRedoStackForCancel = null; // Reset any stale cancel target first
  const state = useAppStore.getState();
  if (!state.image) return;
  if (undoStack.length >= MAX_UNDO) undoStack.shift();
  savedRedoStackForCancel = redoStack;
  undoStack.push(state.createSnapshot());
  redoStack = [];
}

/**
 * Cancel the most recent save(), restoring the redo stack that was cleared.
 * Only call this when you know save() was just called and nothing changed.
 */
export function cancelLastSave() {
  if (savedRedoStackForCancel !== null && undoStack.length > 0) {
    undoStack.pop();
    redoStack = savedRedoStackForCancel;
    savedRedoStackForCancel = null;
  }
}

/**
 * Undo: restore the previous state.
 * @returns {boolean} true if undo was performed
 */
export function undo() {
  if (undoStack.length === 0) return false;
  redoStack.push(useAppStore.getState().createSnapshot());
  useAppStore.getState().applySnapshot(undoStack.pop());
  return true;
}

/**
 * Redo: restore the next state from the redo stack.
 * @returns {boolean} true if redo was performed
 */
export function redo() {
  if (redoStack.length === 0) return false;
  if (undoStack.length >= MAX_UNDO) undoStack.shift();
  undoStack.push(useAppStore.getState().createSnapshot());
  useAppStore.getState().applySnapshot(redoStack.pop());
  return true;
}

/**
 * Clear all undo/redo history.
 * Call this when loading a new image or restarting.
 */
export function clear() {
  undoStack = [];
  redoStack = [];
  savedRedoStackForCancel = null;
}
