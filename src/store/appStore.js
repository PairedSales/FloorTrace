import { create } from 'zustand';
import { createFloorSlice } from './floorManager';
import { calculateArea } from '../utils/areaCalculator';

/**
 * Default values for all working state fields (the state that participates in
 * undo/redo and autosave). Defining them in one place avoids the duplication
 * that previously existed across applySnapshot, resetOverlays, and autosave.
 */
const DEFAULT_TRACE_ID = 'trace-default';
const WORKING_STATE_DEFAULTS = {
  image: null,
  roomOverlay: null,
  perimeterTraces: [
    {
      id: DEFAULT_TRACE_ID,
      name: '1st Floor',
      vertices: [],
      closed: false,
      visible: true,
      locked: false,
      color: '#BD93F9',
    }
  ],
  traceInteractionMode: 'idle',
  activeTraceId: DEFAULT_TRACE_ID,
  roomDimensions: { width: '', height: '' },
  calibration: {
    calibrated: false,
    feetPerPixel: 1.0, // feet per pixel
    source: null,
    calibratedRoomId: null,
    createdAt: null,
  },
  mode: 'normal',
  isProcessing: false,
  processingMessage: '',
  detectedDimensions: [],
  showSideLengths: true,
  useInteriorWalls: false,
  autoSnapEnabled: true,
  manualEntryMode: false,
  ocrFailed: false,
  unit: 'decimal',
  lineToolActive: false,
  angleToolActive: false,
  angleToolState: null,
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
  // Viewport transforms (stage scale/zoom, position, rotation)
  zoomScale: null,      // null means needs fitToWindow
  stageX: 0,
  stageY: 0,
  canvasRotation: 0,    // global rotation alignment
  viewportSyncToken: null,
  // Project tracking states
  isDirty: false,
  projectId: null,
};

/**
 * The subset of field names that are persisted in undo/redo snapshots.
 * Transient UI state, project metadata, and camera transforms are excluded
 * to prevent undo stack bloat.
 */
const EXCLUDED_SNAPSHOT_FIELDS = [
  'isProcessing',
  'processingMessage',
  'zoomScale',
  'stageX',
  'stageY',
  'canvasRotation',
  'viewportSyncToken',
  'isDirty',
  'projectId',
  'traceInteractionMode',
  'activeTraceId',
];
const SNAPSHOT_FIELDS = Object.keys(WORKING_STATE_DEFAULTS).filter(
  (k) => !EXCLUDED_SNAPSHOT_FIELDS.includes(k)
);

/**
 * Fields that are lightweight (no image). Snapshots store the image reference
 * separately so it is only deep-cloned when it actually changes between undo
 * points, dramatically reducing memory usage.
 */
const SNAPSHOT_FIELDS_NO_IMAGE = SNAPSHOT_FIELDS.filter((k) => k !== 'image');

/**
 * The subset of field names written to localStorage on autosave.
 * Excludes transient UI state and changes tracking status.
 */
const EXCLUDED_AUTOSAVE_FIELDS = [
  'isProcessing',
  'processingMessage',
  'isDirty',
  'traceInteractionMode',
];
const AUTOSAVE_FIELDS = Object.keys(WORKING_STATE_DEFAULTS).filter(
  (k) => !EXCLUDED_AUTOSAVE_FIELDS.includes(k)
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
  notifications: [],
  showPanelOptions: false,
  showHelpModal: false,

  // ── flag for autosave gating ───────────────────────────────────────────────
  _hasRestoredState: false,

  // ── floor management ───────────────────────────────────────────────────────
  ...createFloorSlice(set, get),

  // ── setters (thin wrappers so call-sites remain terse) ─────────────────────
  setImage: (v) => set({ image: v }),
  setRoomOverlay: (v) => set({ roomOverlay: v }),
  setPerimeterOverlay: (v) => {
    const state = get();
    const activeId = state.activeTraceId;
    const currentTraces = state.perimeterTraces || [];

    if (!activeId) {
      // Create a default first trace if none exists
      const newId = `trace-${Date.now()}`;
      const newTrace = {
        id: newId,
        name: '1st Floor',
        vertices: v?.vertices || [],
        closed: true,
        visible: true,
        locked: false,
        color: '#BD93F9',
      };
      set({
        perimeterTraces: [newTrace],
        activeTraceId: newId,
        isDirty: true,
      });
      return;
    }

    const updatedTraces = currentTraces.map((t) => {
      if (t.id === activeId) {
        return {
          ...t,
          vertices: v?.vertices || [],
          closed: true,
        };
      }
      return t;
    });

    set({
      perimeterTraces: updatedTraces,
      isDirty: true,
    });
  },
  setRoomDimensions: (v) => set({ roomDimensions: v }),
  setArea: (v) => {}, // Deprecated canonical setter, no-op since area is derived
  setMode: (v) => set({ mode: v }),
  applyRoomCalibration: (feetPerPixel, roomId = null, mutationSource = 'room-calibration') => {
    if (mutationSource !== 'room-calibration') {
      throw new Error(
        "Only explicit room calibration may modify calibration scale"
      );
    }
    if (typeof feetPerPixel !== 'number' || isNaN(feetPerPixel) || !isFinite(feetPerPixel) || feetPerPixel <= 0) {
      throw new Error("Invalid calibration scale");
    }
    set({
      calibration: {
        calibrated: true,
        feetPerPixel,
        source: 'room-calibration',
        calibratedRoomId: roomId,
        createdAt: Date.now(),
      },
      isDirty: true,
    });
  },
  setIsProcessing: (v, msg = '') => set({ isProcessing: v, processingMessage: v ? msg : '' }),
  setDetectedDimensions: (v) => set({ detectedDimensions: v }),
  setShowSideLengths: (v) => set({ showSideLengths: v }),
  setUseInteriorWalls: (v) => set({ useInteriorWalls: v }),
  setAutoSnapEnabled: (v) => set({ autoSnapEnabled: v }),
  setManualEntryMode: (v) => set({ manualEntryMode: v }),
  setOcrFailed: (v) => set({ ocrFailed: v }),
  setUnit: (v) => set({ unit: v }),
  setLineToolActive: (v) => set({ lineToolActive: v }),
  setAngleToolActive: (v) => set({ angleToolActive: v }),
  setAngleToolState: (v) => set({ angleToolState: v }),
  setMeasurementLines: (v) => set({ measurementLines: v }),
  setCurrentMeasurementLine: (v) => set({ currentMeasurementLine: v }),
  setDrawAreaActive: (v) => set({ drawAreaActive: v }),
  setCustomShapes: (v) => set({ customShapes: v }),
  setCurrentCustomShape: (v) => set({ currentCustomShape: v }),
  setPerimeterVertices: (v) => set((state) => {
    const patch = { perimeterVertices: v };
    if (v !== null) {
      patch.traceInteractionMode = 'drawing';
    } else if (state.traceInteractionMode === 'drawing') {
      patch.traceInteractionMode = 'idle';
    }
    return patch;
  }),
  setTracedBoundaries: (v) => set({ tracedBoundaries: v }),
  setDebugDetection: (v) => set({ debugDetection: v }),
  setDetectionDebugData: (v) => set({ detectionDebugData: v }),
  setEraserToolActive: (v) => set({ eraserToolActive: v }),
  setEraserBrushSize: (v) => set({ eraserBrushSize: v }),
  setCropToolActive: (v) => set({ cropToolActive: v }),
  setZoomScale: (v) => set({ zoomScale: v }),
  setStagePosition: (pos) => set({ stageX: pos.x, stageY: pos.y }),
  setViewportTransform: (scale, pos, token) => set({ zoomScale: scale, stageX: pos.x, stageY: pos.y, viewportSyncToken: token }),
  setCanvasRotation: (v) => set({ canvasRotation: v }),
  setIsDirty: (v) => set({ isDirty: v }),
  setProjectId: (v) => set({ projectId: v }),
  loadProject: (projectState) => set({
    ...WORKING_STATE_DEFAULTS,
    ...projectState,
    traceInteractionMode: 'idle',
    perimeterVertices: null,
    isProcessing: false,
    processingMessage: '',
  }),
  addNotification: (v) => set((state) => ({ notifications: [...state.notifications, v] })),
  removeNotification: (id) => set((state) => ({ notifications: state.notifications.filter(n => n.id !== id) })),
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

  /** Full restart: clear image and all working state, reset to single floor. */
  restart: () => {
    get().resetFloors();
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

// ── Memoized selectors ────────────────────────────────────────────────────────

let lastActiveTraceId = null;
let lastVertices = null;
let lastOverlayResult = null;

/** Selector to get the active perimeter overlay (compatibility adapter) */
export const selectPerimeterOverlay = (state) => {
  const traces = state.perimeterTraces || [];
  const active = traces.find(t => t.id === state.activeTraceId);
  if (!active) {
    lastActiveTraceId = null;
    lastVertices = null;
    lastOverlayResult = null;
    return null;
  }
  if (state.activeTraceId === lastActiveTraceId && active.vertices === lastVertices) {
    return lastOverlayResult;
  }
  lastActiveTraceId = state.activeTraceId;
  lastVertices = active.vertices;
  lastOverlayResult = { vertices: active.vertices };
  return lastOverlayResult;
};

let lastFeetPerPixel = null;
let lastTraces = [];
let lastCombinedArea = 0;

/** Selector to get the combined total area of all visible traces */
export const selectCombinedArea = (state) => {
  const traces = state.perimeterTraces || [];
  const feetPerPixel = state.calibration?.feetPerPixel || 1.0;

  // Quick check for changes in feetPerPixel or trace object reference
  let changed = feetPerPixel !== lastFeetPerPixel || traces.length !== lastTraces.length;
  if (!changed) {
    for (let i = 0; i < traces.length; i++) {
      if (traces[i] !== lastTraces[i]) {
        changed = true;
        break;
      }
    }
  }

  if (!changed) {
    return lastCombinedArea;
  }

  const areaValue = traces
    .filter(t => t.visible && t.vertices && t.vertices.length >= 3)
    .reduce((sum, t) => sum + calculateArea(t.vertices, feetPerPixel), 0);

  lastFeetPerPixel = feetPerPixel;
  lastTraces = traces;
  lastCombinedArea = areaValue;
  return areaValue;
};

export { AUTOSAVE_FIELDS };
export default useAppStore;
