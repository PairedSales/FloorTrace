import useAppStore from './appStore';
import { internKey } from '../utils/hash';

/**
 * Maximum number of undo steps kept across both stacks combined.
 * 50 is generous for typical usage while halving worst-case memory vs 100.
 *
 * "Combined" is exact rather than aspirational, and worth knowing why: `undo()`
 * and `redo()` move one entry between the stacks and create none, and `save()`
 * clears `redoStack` outright — so total mass only ever falls after a `save()`
 * trims at the cap. `setHistoryState` was the one path that could break the
 * invariant, because it installs whatever a `.floorplan` carried.
 */
const MAX_UNDO = 50;

// ──────────────────────────────────────────────────────────────────────────────
// Image intern pool
//
// Problem: data URLs for floor-plan images can be 200 KB – 2 MB each. Storing
// one per undo snapshot (even with the same string content) wastes heap fast.
//
// Solution: every unique image is stored exactly ONCE in `imagePool`, keyed by
// a fast hash of the first 8 KB of the data URL. Snapshots carry only the hash
// key (`__imageRef`). resolveSnapshot() swaps the key back for the real URL
// before the store applies the snapshot, so the rest of the app is unchanged.
// ──────────────────────────────────────────────────────────────────────────────

/** @type {Map<string, string>} intern key → full data URL */
const imagePool = new Map();

/**
 * Intern a data URL into the pool and return its key.
 * If two equal images arrive they resolve to the same key → single copy stored.
 *
 * The key must be an identity, not a bucket: it is what undo resolves back into
 * `image`, so two images sharing a hash would restore the wrong drawing with no
 * sign anything went wrong. `internKey` verifies the occupant before reusing a
 * slot — the equal-image case still shares one copy, so interning is intact.
 */
function internImage(dataUrl) {
  const key = internKey(dataUrl, (k) => imagePool.get(k));
  if (key !== null && !imagePool.has(key)) imagePool.set(key, dataUrl);
  return key;
}

/**
 * Scan both stacks and remove pool entries that are no longer referenced.
 * Called after any stack mutation that can shrink the set of live images.
 */
function pruneImagePool() {
  const liveKeys = new Set();
  for (const snap of undoStack) if (snap.__imageRef) liveKeys.add(snap.__imageRef);
  for (const snap of redoStack) if (snap.__imageRef) liveKeys.add(snap.__imageRef);
  for (const key of imagePool.keys()) {
    if (!liveKeys.has(key)) imagePool.delete(key);
  }
}

/**
 * Convert an app-store snapshot into an intern-pool snapshot.
 * Replaces `image` (the full data URL) with `__imageRef` (the pool key).
 */
function internSnapshot(snapshot) {
  const { image, ...rest } = snapshot;
  return { ...rest, __imageRef: internImage(image) };
}

/**
 * Reverse of internSnapshot — inflate `__imageRef` back to the real data URL
 * so applySnapshot receives the shape it expects.
 */
function resolveSnapshot(internedSnap) {
  const { __imageRef, ...rest } = internedSnap;
  return { ...rest, image: imagePool.get(__imageRef) ?? null };
}

// ──────────────────────────────────────────────────────────────────────────────

let undoStack = [];
let redoStack = [];
let savedRedoStackForCancel = null;

// The stacks are module state, so a button has no way to observe them; every
// site below that mutates either stack must emit or the buttons lie.
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn());

export const subscribe = (fn) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
export const canUndo = () => undoStack.length > 0;
export const canRedo = () => redoStack.length > 0;

/**
 * Return the image reference from the most recent snapshot, or null.
 * Used by createSnapshot to decide whether the image needs deep-cloning.
 * We resolve the __imageRef from the pool to get the actual data URL.
 */
const lastSnapshotImage = () => {
  if (undoStack.length === 0) return null;
  const last = undoStack[undoStack.length - 1];
  return last.__imageRef ? (imagePool.get(last.__imageRef) ?? null) : null;
};

/**
 * Save the current state as an undo point.
 * Call this at the start of a user action, BEFORE making changes.
 * No-op if no image is loaded.
 */
export function save() {
  savedRedoStackForCancel = null;
  const state = useAppStore.getState();
  if (!state.image) return;
  if (undoStack.length >= MAX_UNDO) {
    undoStack.shift();
    pruneImagePool(); // reclaim any image that is no longer referenced
  }
  savedRedoStackForCancel = redoStack;
  undoStack.push(internSnapshot(state.createSnapshot(lastSnapshotImage())));
  redoStack = [];
  emit();
  
  // Set project state as dirty
  state.setIsDirty(true);
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
    pruneImagePool();
    emit();
  }
}

/**
 * Undo: restore the previous state.
 * @returns {boolean} true if undo was performed
 */
export function undo() {
  if (undoStack.length === 0) return false;
  redoStack.push(internSnapshot(useAppStore.getState().createSnapshot(lastSnapshotImage())));
  useAppStore.getState().applySnapshot(resolveSnapshot(undoStack.pop()));
  pruneImagePool();
  useAppStore.getState().setIsDirty(true);
  emit();
  return true;
}

/**
 * Redo: restore the next state from the redo stack.
 * @returns {boolean} true if redo was performed
 */
export function redo() {
  if (redoStack.length === 0) return false;
  if (undoStack.length >= MAX_UNDO) {
    undoStack.shift();
    pruneImagePool();
  }
  undoStack.push(internSnapshot(useAppStore.getState().createSnapshot(lastSnapshotImage())));
  useAppStore.getState().applySnapshot(resolveSnapshot(redoStack.pop()));
  pruneImagePool();
  useAppStore.getState().setIsDirty(true);
  emit();
  return true;
}

/**
 * Clear all undo/redo history and free all interned images.
 * Call this when loading a new image or restarting.
 */
export function clear() {
  undoStack = [];
  redoStack = [];
  savedRedoStackForCancel = null;
  imagePool.clear();
  emit();
}

/**
 * Set this plan's history aside, whole, so another plan can take the stacks.
 *
 * Carries `savedRedoStackForCancel`, which `getHistoryState` does not, and that
 * omission would be silent: `save()` and `cancelLastSave()` are used as a pair
 * around actions that may turn out to be no-ops — a vertex drag that does not
 * move, a dimension field focused and blurred unchanged. A pair straddling a
 * plan switch would find the slot nulled on return and leave a spurious undo
 * point behind, with no error and nothing to see.
 *
 * The stacks are handed over by reference and then dropped here, so nothing is
 * copied and nothing stays shared.
 */
export function parkHistory() {
  const parked = {
    undoStack,
    redoStack,
    imagePool: new Map(imagePool),
    savedRedoStackForCancel,
  };
  undoStack = [];
  redoStack = [];
  savedRedoStackForCancel = null;
  imagePool.clear();
  emit();
  return parked;
}

/**
 * Take a parked history back. The inverse of `parkHistory`; a plan that has
 * never been parked adopts an empty history rather than keeping whatever the
 * previous plan left behind.
 */
export function adoptHistory(parked) {
  undoStack = parked?.undoStack ?? [];
  redoStack = parked?.redoStack ?? [];
  savedRedoStackForCancel = parked?.savedRedoStackForCancel ?? null;
  imagePool.clear();
  if (parked?.imagePool) {
    for (const [k, v] of parked.imagePool) imagePool.set(k, v);
  }
  emit();
}

/**
 * Forget that the last `save()` can be cancelled, without touching the stacks.
 *
 * `cancelLastSave` pops the undo stack, so it must only ever be reachable by
 * the code that called `save()` moments earlier. Across a plan switch that
 * pairing is broken — the save belongs to one plan and the cancel would land on
 * whichever plan is live — so the switch gives up the option rather than
 * carrying it.
 */
export function cancelPendingSave() {
  savedRedoStackForCancel = null;
}

/**
 * Gather the current undo history state for serialization.
 */
export function getHistoryState() {
  return {
    undoStack: [...undoStack],
    redoStack: [...redoStack],
    imagePool: Array.from(imagePool.entries()),
  };
}

/**
 * Restore the undo history state from deserialization.
 */
export function setHistoryState(history) {
  savedRedoStackForCancel = null;
  if (!history) {
    clear();
    return;
  }
  // Copies, not the caller's arrays. `getHistoryState()` hands out `[...stack]`,
  // but `deserializeSketch` hands over arrays parsed straight from the file and
  // its caller still holds them; installed by reference, the module's stacks and
  // the caller's are one object and a later `save()` mutates both — silently.
  //
  // Capped on the way in because this is the only path that can carry more than
  // the app ever creates: a `.floorplan` written by a future build, or one
  // hand-edited, arrives at whatever depth it likes and would then sit above
  // the ceiling for the rest of the session, holding every image it references
  // in the pool. Newest entries are the ones kept — the far end of each stack
  // is what `pop()` reaches first — and `undoStack` is served first because an
  // undo the user can still take is worth more than a redo they have not.
  const importedUndo = [...(history.undoStack || [])];
  const importedRedo = [...(history.redoStack || [])];
  undoStack = importedUndo.slice(Math.max(0, importedUndo.length - MAX_UNDO));
  const redoRoom = Math.max(0, MAX_UNDO - undoStack.length);
  redoStack = importedRedo.slice(Math.max(0, importedRedo.length - redoRoom));
  imagePool.clear();
  if (history.imagePool) {
    for (const [k, v] of history.imagePool) {
      imagePool.set(k, v);
    }
  }
  emit();
}
