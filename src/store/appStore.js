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
  processingMessage: '',
  detectedDimensions: [],
  showSideLengths: true,
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
  eraserToolActive: false,
  eraserBrushSize: 20,
  cropToolActive: false,
};

/**
 * The subset of field names that are persisted in undo/redo snapshots.
 * `isProcessing` and `processingMessage` are excluded as transient UI state.
 * `image` is included so that crop and erase tool changes can be undone/redone.
 */
const SNAPSHOT_FIELDS = Object.keys(WORKING_STATE_DEFAULTS).filter(
  (k) => k !== 'isProcessing' && k !== 'processingMessage'
);

/**
 * Fields that are lightweight (no image). Snapshots store the image reference
 * separately so it is only deep-cloned when it actually changes between undo
 * points, dramatically reducing memory usage.
 */
const SNAPSHOT_FIELDS_NO_IMAGE = SNAPSHOT_FIELDS.filter((k) => k !== 'image');

/**
 * The subset of field names written to localStorage on autosave.
 * Same as SNAPSHOT_FIELDS but also includes `image`.
 */
const AUTOSAVE_FIELDS = Object.keys(WORKING_STATE_DEFAULTS).filter(
  (k) => k !== 'isProcessing' && k !== 'processingMessage'
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

const useAppStore = create((set, get) => ({
  // ── working state ──────────────────────────────────────────────────────────
  ...WORKING_STATE_DEFAULTS,

  // ── UI-only state (not in undo/autosave) ───────────────────────────────────
  notification: { show: false, message: '' },
  showPanelOptions: false,
  showHelpModal: false,

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
  setIsProcessing: (v, msg = '') => set({ isProcessing: v, processingMessage: v ? msg : '' }),
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
  setEraserToolActive: (v) => set({ eraserToolActive: v }),
  setEraserBrushSize: (v) => set({ eraserBrushSize: v }),
  setCropToolActive: (v) => set({ cropToolActive: v }),
  setNotification: (v) => set({ notification: v }),
  setShowPanelOptions: (v) => set({ showPanelOptions: v }),
  setShowHelpModal: (v) => set({ showHelpModal: v }),
  setHasRestoredState: (v) => set({ _hasRestoredState: v }),

  // ── snapshots ──────────────────────────────────────────────────────────────

  /**
   * Return a snapshot of the current undo-able state.
   *
   * Two-layer memory strategy:
   *  1. Reference-equality short-circuit (here): if the image string reference
   *     hasn't changed since the last snapshot, we skip the full clone and reuse
   *     the same reference. This covers the common case of non-image edits.
   *  2. Content-hash intern pool (undoManager.js): after this snapshot is
   *     handed to undoManager, `internSnapshot()` replaces `image` with a pool
   *     key so that N snapshots pointing to the same image string share exactly
   *     ONE copy in the heap, regardless of reference identity.
   */
  createSnapshot: (prevImage) => {
    const state = get();
    const lightweight = cloneSnapshot(pickFields(state, SNAPSHOT_FIELDS_NO_IMAGE));
    // Fast path: reuse the same string reference when image hasn't changed.
    // undoManager's intern pool will deduplicate across reference boundaries.
    if (state.image === prevImage) {
      lightweight.image = prevImage;
    } else {
      lightweight.image = state.image;
    }
    return lightweight;
  },

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

  // ── reset ──────────────────────────────────────────────────────────────────

  /** Reset all working state except `image` to defaults. */
  resetOverlays: () => {
    const defaults = { ...WORKING_STATE_DEFAULTS };
    delete defaults.image; // preserve current image
    set(defaults);
  },

  /** Full restart: clear image and all working state. */
  restart: () => {
    set({ ...WORKING_STATE_DEFAULTS });
  },

  // ── bulk restore (used by autosave restore) ────────────────────────────────

  restoreFromSaved: (saved) => {
    const patch = {};
    for (const k of AUTOSAVE_FIELDS) {
      if (k in saved) {
        patch[k] = saved[k];
      }
    }
    // Also set isProcessing/processingMessage to false/empty when restoring
    patch.isProcessing = false;
    patch.processingMessage = '';
    set(patch);
  },
}));

export { AUTOSAVE_FIELDS };
export default useAppStore;
