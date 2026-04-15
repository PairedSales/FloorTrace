import useAppStore from './appStore';

/**
 * Maximum number of undo steps kept across both stacks combined.
 * 50 is generous for typical usage while halving worst-case memory vs 100.
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

/** @type {Map<string, string>} hash → full data URL */
const imagePool = new Map();

/**
 * Fast, non-cryptographic hash of a string (FNV-1a, 32-bit).
 * We sample the first 8 KB + the total length so very large images that
 * differ only in later bytes are still distinguishable in practice.
 */
function hashDataUrl(dataUrl) {
  const sample = dataUrl.slice(0, 8192) + '|' + dataUrl.length;
  let h = 0x811c9dc5;
  for (let i = 0; i < sample.length; i++) {
    h ^= sample.charCodeAt(i);
    h = (Math.imul(h, 0x01000193) >>> 0);
  }
  return h.toString(16);
}

/**
 * Intern a data URL into the pool and return its hash key.
 * If two equal images arrive they resolve to the same key → single copy stored.
 */
function internImage(dataUrl) {
  if (!dataUrl) return null;
  const key = hashDataUrl(dataUrl);
  if (!imagePool.has(key)) {
    imagePool.set(key, dataUrl);
  }
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
}
