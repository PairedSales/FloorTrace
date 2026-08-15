import { useSyncExternalStore } from 'react';
import * as undoManager from '../store/undoManager';

// Two subscriptions returning booleans, not one returning {canUndo, canRedo}:
// a fresh object per getSnapshot has a new identity every render, which React
// reads as a changed store and loops forever. Primitives are stable by value.
export default function useUndoHistory() {
  const canUndo = useSyncExternalStore(undoManager.subscribe, undoManager.canUndo);
  const canRedo = useSyncExternalStore(undoManager.subscribe, undoManager.canRedo);
  return { canUndo, canRedo };
}
