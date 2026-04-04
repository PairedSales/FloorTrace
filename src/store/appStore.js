import { create } from 'zustand';

/**
 * Default values for all working state fields (the state that participates in
 * undo/redo and autosave). Defining them in one place avoids the duplication
 * that previously existed across applySnapshot, resetOverlays, and autosave.
 */
const WORKING_STATE_DEFAULTS = {
  image: null,
  roomOverlay: null,
  perimeterOverlay: null,
  roomDimensions: { width: '', height: '' },
  area: 0,
  scale: 1,
  mode: 'normal',
  isProcessing: false,
  detectedDimensions: [],
  showSideLengths: false,
  useInteriorWalls: true,
  autoSnapEnabled: true,
  manualEntryMode: false,
  ocrFailed: false,
  unit: 'decimal',
  lineToolActive: false,
  measurementLines: [],
  currentMeasurementLine: null,
  drawAreaActive: false,
  customShapes: [],
  currentCustomShape: null,
  perimeterVertices: null,
  tracedBoundaries: null,
  debugDetection: false,
  detectionDebugData: null,
};

/**
 * The subset of field names that are persisted in undo/redo snapshots.
 * `image` and `isProcessing` are excluded (image never changes mid-session;
 * isProcessing is transient).
 */
const SNAPSHOT_FIELDS = Object.keys(WORKING_STATE_DEFAULTS).filter(
  (k) => k !== 'image' && k !== 'isProcessing'
);

/**
 * The subset of field names written to localStorage on autosave.
 * Same as SNAPSHOT_FIELDS but also includes `image`.
 */
const AUTOSAVE_FIELDS = Object.keys(WORKING_STATE_DEFAULTS).filter(
  (k) => k !== 'isProcessing'
);

// ──── helpers ────────────────────────────────────────────────────────────────

const cloneSnapshot = (value) => {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
};

const pickFields = (state, fields) => {
  const obj = {};
  for (const k of fields) {
    obj[k] = state[k];
  }
  return obj;
};

// ──── store ──────────────────────────────────────────────────────────────────

const MAX_UNDO = 100;

const useAppStore = create((set, get) => ({
  // ── working state ──────────────────────────────────────────────────────────
  ...WORKING_STATE_DEFAULTS,

  // ── UI-only state (not in undo/autosave) ───────────────────────────────────
  notification: { show: false, message: '' },
  showPanelOptions: false,
  showHelpModal: false,

  // ── undo / redo stacks ─────────────────────────────────────────────────────
  _undoStack: [],
  _redoStack: [],

  // ── flag for autosave gating ───────────────────────────────────────────────
  _hasRestoredState: false,

  // ── setters (thin wrappers so call-sites remain terse) ─────────────────────
  setImage: (v) => set({ image: v }),
  setRoomOverlay: (v) => set({ roomOverlay: v }),
  setPerimeterOverlay: (v) => set({ perimeterOverlay: v }),
  setRoomDimensions: (v) => set({ roomDimensions: v }),
  setArea: (v) => set({ area: v }),
  setMode: (v) => set({ mode: v }),
  setScale: (v) => set({ scale: v }),
  setIsProcessing: (v) => set({ isProcessing: v }),
  setDetectedDimensions: (v) => set({ detectedDimensions: v }),
  setShowSideLengths: (v) => set({ showSideLengths: v }),
  setUseInteriorWalls: (v) => set({ useInteriorWalls: v }),
  setAutoSnapEnabled: (v) => set({ autoSnapEnabled: v }),
  setManualEntryMode: (v) => set({ manualEntryMode: v }),
  setOcrFailed: (v) => set({ ocrFailed: v }),
  setUnit: (v) => set({ unit: v }),
  setLineToolActive: (v) => set({ lineToolActive: v }),
  setMeasurementLines: (v) => set({ measurementLines: v }),
  setCurrentMeasurementLine: (v) => set({ currentMeasurementLine: v }),
  setDrawAreaActive: (v) => set({ drawAreaActive: v }),
  setCustomShapes: (v) => set({ customShapes: v }),
  setCurrentCustomShape: (v) => set({ currentCustomShape: v }),
  setPerimeterVertices: (v) => set({ perimeterVertices: v }),
  setTracedBoundaries: (v) => set({ tracedBoundaries: v }),
  setDebugDetection: (v) => set({ debugDetection: v }),
  setDetectionDebugData: (v) => set({ detectionDebugData: v }),
  setNotification: (v) => set({ notification: v }),
  setShowPanelOptions: (v) => set({ showPanelOptions: v }),
  setShowHelpModal: (v) => set({ showHelpModal: v }),
  setHasRestoredState: (v) => set({ _hasRestoredState: v }),

  // ── snapshots ──────────────────────────────────────────────────────────────

  /** Return a deep clone of the current undo-able state. */
  createSnapshot: () => cloneSnapshot(pickFields(get(), SNAPSHOT_FIELDS)),

  /** Return the current autosave-ready state (includes image). */
  getAutosaveState: () => pickFields(get(), AUTOSAVE_FIELDS),

  /** Apply a snapshot produced by createSnapshot (used by undo/redo). */
  applySnapshot: (snapshot) => {
    const patch = {};
    for (const k of SNAPSHOT_FIELDS) {
      patch[k] = snapshot[k] ?? WORKING_STATE_DEFAULTS[k];
    }
    set(patch);
  },

  // ── undo / redo ────────────────────────────────────────────────────────────

  pushUndoState: () => {
    const state = get();
    if (!state.image) return;
    const snap = cloneSnapshot(pickFields(state, SNAPSHOT_FIELDS));
    const stack = [...state._undoStack, snap];
    if (stack.length > MAX_UNDO) stack.shift();
    set({ _undoStack: stack, _redoStack: [] });
  },

  handleUndo: () => {
    const state = get();
    if (state._undoStack.length === 0) return false;
    const undoStack = [...state._undoStack];
    const previous = undoStack.pop();
    const redoStack = [...state._redoStack, cloneSnapshot(pickFields(state, SNAPSHOT_FIELDS))];

    const patch = {};
    for (const k of SNAPSHOT_FIELDS) {
      patch[k] = previous[k] ?? WORKING_STATE_DEFAULTS[k];
    }
    set({ ...patch, _undoStack: undoStack, _redoStack: redoStack });
    return true;
  },

  handleRedo: () => {
    const state = get();
    if (state._redoStack.length === 0) return false;
    const redoStack = [...state._redoStack];
    const next = redoStack.pop();
    const undoStack = [...state._undoStack, cloneSnapshot(pickFields(state, SNAPSHOT_FIELDS))];

    const patch = {};
    for (const k of SNAPSHOT_FIELDS) {
      patch[k] = next[k] ?? WORKING_STATE_DEFAULTS[k];
    }
    set({ ...patch, _undoStack: undoStack, _redoStack: redoStack });
    return true;
  },

  clearHistory: () => set({ _undoStack: [], _redoStack: [] }),

  // ── reset ──────────────────────────────────────────────────────────────────

  /** Reset all working state except `image` to defaults, and clear undo history. */
  resetOverlays: () => {
    const defaults = { ...WORKING_STATE_DEFAULTS };
    delete defaults.image; // preserve current image
    set({ ...defaults, _undoStack: [], _redoStack: [] });
  },

  /** Full restart: clear image and all working state. */
  restart: () => {
    set({ ...WORKING_STATE_DEFAULTS, _undoStack: [], _redoStack: [] });
  },

  // ── bulk restore (used by autosave restore) ────────────────────────────────

  restoreFromSaved: (saved) => {
    const patch = {};
    for (const k of AUTOSAVE_FIELDS) {
      if (k in saved) {
        patch[k] = saved[k];
      }
    }
    // Also set isProcessing to false when restoring
    patch.isProcessing = false;
    set(patch);
  },
}));

export { AUTOSAVE_FIELDS };
export default useAppStore;
