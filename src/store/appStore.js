import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { createFloorSlice } from './floorManager';
import { newTraceId } from './ids';
import { createDocumentSlice } from './documentManager';
import { calculateArea, holeKey, mergeHoles } from '../utils/areaCalculator';
import { containmentRatio, markStaleHoles } from '../utils/geometryValidation';
import {
  DEFAULT_TRACE_TYPE,
  normalizeTraceType,
  normalizeTraces,
  traceTypeColor,
} from '../utils/traceTypes';

/**
 * Default values for all working state fields (the state that participates in
 * undo/redo and autosave). Defining them in one place avoids the duplication
 * that previously existed across applySnapshot, resetOverlays, and autosave.
 */
// A function, not a literal: handing out the same nested objects on every
// reset and undo fallback aliased one project's calibration into the next.
//
// The default trace's id is minted per call for the same class of reason, one
// level up. It used to be the constant `'trace-default'`, so every plan that
// had never had a trace added shared it — and trace ids are what
// `focusedWarning`, the double-counting report and an exhibit's outline ids all
// key on. With one plan that is invisible; with two it is a collision.
const workingStateDefaults = () => {
  const defaultTraceId = newTraceId();
  return {
  image: null,
  imageMimeType: 'image/png',
  roomOverlay: null,
  perimeterTraces: [
    {
      id: defaultTraceId,
      name: '1st Floor',
      vertices: [],
      closed: false,
      visible: true,
      locked: false,
      type: DEFAULT_TRACE_TYPE,
      typeSource: 'auto',
      colorSource: 'type',
      nameSource: 'auto',
      color: traceTypeColor(DEFAULT_TRACE_TYPE),
    }
  ],
  traceInteractionMode: 'idle',
  activeTraceId: defaultTraceId,
  roomDimensions: { width: '', height: '' },
  calibration: {
    calibrated: false,
    feetPerPixel: { x: 1.0, y: 1.0 }, // feet per pixel for X and Y directions
    source: null,
    calibratedRoomId: null,
    createdAt: null,
    quality: null,
  },
  mode: 'normal',
  isProcessing: false,
  processingMessage: '',
  detectedDimensions: [],
  exteriorLabels: [],
  // Level names the scan read ("BASEMENT", "2ND FLOOR"). Not exteriorLabels:
  // those carve a region out of a footprint, these type the whole outline they
  // sit in and remove nothing.
  areaLabels: [],
  // Every room the detector has placed this session, in original image px.
  // Rooms are known-inside evidence for the boundary stage and the sample set
  // for a robust multi-room scale; a single `roomOverlay` could hold neither.
  rooms: [],
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
  scaleToolActive: false,
  // The lines the scale was asserted from, in original image px. Kept rather
  // than just their result: a hand-set scale must stay inspectable and
  // re-editable, and a second line has to be scored against the first.
  scaleLines: [],
  currentScaleLine: null,
  drawAreaActive: false,
  customShapes: [],
  currentCustomShape: null,
  perimeterVertices: null,
  tracedBoundaries: null,
  eraserToolActive: false,
  eraserBrushSize: 60,
  cropToolActive: false,
  voidToolActive: false,
  // Draw mode: rough brush strokes over the exterior walls, which the tracer
  // then reads as a corridor constraint. Scratch input, not document content —
  // undoable and restored with a draft, but never written to a .floorplan.
  drawModeActive: false,
  drawBrushSize: 48,
  drawStrokes: [],
  // Viewport transforms (stage scale/zoom, position, rotation)
  zoomScale: null,      // null means needs fitToWindow
  stageX: 0,
  stageY: 0,
  canvasRotation: 0,    // global rotation alignment
  viewportSyncToken: null,
  // What this measurement is of — the subject line an exported exhibit carries
  // into a workfile. Document content, not a preference: a page of square
  // footage that does not say which property it belongs to is not filing.
  projectName: '',
  // Project tracking states
  isDirty: false,
  projectId: null,
  };
};

const WORKING_STATE_DEFAULTS = workingStateDefaults();

/**
 * The subset of field names that are persisted in undo/redo snapshots.
 * Transient UI state, project metadata, and camera transforms are excluded
 * to prevent undo stack bloat.
 */
const EXCLUDED_SNAPSHOT_FIELDS = [
  'isProcessing',        // transient spinner
  'processingMessage',   // transient spinner text
  'zoomScale',           // camera — undo shouldn't jump the viewport
  'stageX',              // camera
  'stageY',              // camera
  'canvasRotation',      // camera
  'viewportSyncToken',   // camera sync signal
  'isDirty',             // project tracking, not document content
  'projectId',           // project tracking
  'traceInteractionMode', // transient input mode (drawing/idle)
  'angleToolActive',     // transient tool toggle
  'drawModeActive',      // transient tool toggle
  // drawStrokes IS snapshotted: each brush stroke must be undoable, which is
  // the only correction available while painting.
  // activeTraceId and angleToolState ARE snapshotted: undoing "Add Floor"
  // must restore the previous selection, and protractor edits must be
  // undoable (AngleOverlay syncs itself back from the store).
];
const SNAPSHOT_FIELDS = Object.keys(WORKING_STATE_DEFAULTS).filter(
  (k) => !EXCLUDED_SNAPSHOT_FIELDS.includes(k)
);

/**
 * The names of every working-state field, exported so the three projections
 * below can be checked against their one source rather than by hand. The keys
 * and not the object: handing out `WORKING_STATE_DEFAULTS` itself is how one
 * project's calibration came to be aliased into the next — callers who need
 * values want `workingStateDefaults()`.
 */
export const WORKING_STATE_KEYS = Object.keys(WORKING_STATE_DEFAULTS);

/**
 * Snapshot fields carried by reference instead of deep-cloned. Both are replaced
 * wholesale by their setters and never mutated in place, so N snapshots of an
 * unchanged value share one copy. `tracedBoundaries` is here because it is the
 * heaviest thing in a snapshot — 15.6 KB of a 16.8 KB snapshot on the largest
 * fixture — and cloning it 50 times bought nothing.
 */
const SNAPSHOT_SHARED_FIELDS = ['image', 'tracedBoundaries'];
const SNAPSHOT_CLONED_FIELDS = SNAPSHOT_FIELDS.filter(
  (k) => !SNAPSHOT_SHARED_FIELDS.includes(k)
);

/**
 * The subset of field names written to the autosaved draft.
 * Excludes transient UI state and change tracking. `tracedBoundaries` is NOT
 * excluded: it is what the interior/exterior toggle re-applies, so a restored
 * draft without it has a toggle that silently does nothing — and a `.floorplan`
 * carries it, which would make reopening a project better than restoring a draft.
 */
const EXCLUDED_AUTOSAVE_FIELDS = [
  'isProcessing',
  'processingMessage',
  'isDirty',
  'traceInteractionMode',
  'drawModeActive',
  // A fresh `Math.random()` per `setViewportTransform` call, whose only reader
  // compares it against a ref that is null on mount — so a persisted value can
  // never match anything. Persisting it only guaranteed that every camera
  // update looked like a state change to the autosave subscription.
  'viewportSyncToken',
];
const AUTOSAVE_FIELDS = Object.keys(WORKING_STATE_DEFAULTS).filter(
  (k) => !EXCLUDED_AUTOSAVE_FIELDS.includes(k)
);

/**
 * What a plan carries when it is set aside so another can take the store root.
 *
 * Deliberately NOT `AUTOSAVE_FIELDS`, and the difference is the whole point.
 * A draft is written to disk and read back at startup, when three of these are
 * meaningless — nobody is mid-gesture across a page load. A park is a
 * round trip within one session, where all three are live facts about the plan
 * being set aside:
 *
 *  - `isDirty` says the plan has unsaved work. It is set by nearly every
 *    mutation and cleared in exactly one place, and `checkUnsavedChanges`
 *    reads it. Parking through the autosave projection would silently clear it
 *    on the way back — switching away and back would launder away the fact
 *    that a plan has unsaved changes.
 *  - `drawModeActive` is excluded from autosave as a "transient tool toggle",
 *    but `drawStrokes` is NOT — so parking one without the other returns a plan
 *    with brush strokes on it and no brush in the user's hand.
 *  - `traceInteractionMode` pairs with `perimeterVertices` the same way: the
 *    vertices come back, the fact that the user was placing them does not.
 *
 * Excluded on purpose: `isProcessing` / `processingMessage`, because a plan's
 * in-flight work is abandoned when it is parked, so returning to a spinner
 * would be a lie; and `viewportSyncToken`, which is a fresh random per camera
 * write whose only reader compares it against a ref that is null on mount.
 */
const PARK_ONLY_FIELDS = ['isDirty', 'drawModeActive', 'traceInteractionMode'];
const PARK_FIELDS = [...AUTOSAVE_FIELDS, ...PARK_ONLY_FIELDS];

/**
 * Fields written into a saved `.floorplan`. Derived from the same declaration
 * as the other two projections — hand-maintaining this list is how
 * `exteriorLabels` came to be autosaved but not exported, so reopening a
 * project silently degraded every later trace to geometry-only.
 */
const EXCLUDED_PERSISTENT_FIELDS = [
  'isProcessing', 'processingMessage', 'traceInteractionMode',
  'lineToolActive', 'angleToolActive', 'drawAreaActive', 'eraserToolActive',
  'cropToolActive', 'eraserBrushSize', 'voidToolActive',
  'drawModeActive', 'drawBrushSize', 'drawStrokes',
  'currentMeasurementLine', 'currentCustomShape', 'perimeterVertices',
  // `scaleLines` is deliberately absent: it is document content, the evidence
  // a hand-set scale rests on.
  'scaleToolActive', 'currentScaleLine',
  'canvasRotation',   // written to globalSettings
  'viewportSyncToken',
  'isDirty', 'projectId', // written to metadata
];
export const PERSISTENT_FLOOR_FIELDS = Object.keys(WORKING_STATE_DEFAULTS).filter(
  (k) => !EXCLUDED_PERSISTENT_FIELDS.includes(k)
);

// Who may write the calibration scale. An allowlist rather than one string
// equality so `source` can be real provenance instead of a constant that was
// written everywhere and read nowhere; the guard's purpose — no accidental
// scale writes from unrelated setters — is unchanged.
export const CALIBRATION_SOURCES = new Set(['room-calibration', 'line-calibration']);

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

// Rooms replace, never duplicate: re-measuring a label supersedes the earlier
// reading of it, and a room placed by hand supersedes whatever sat at the same
// origin. Shared by addRoom and addRooms so a batch and a single click cannot
// disagree about what counts as the same room.
const mergeRooms = (existing, incoming) => {
  let kept = existing;
  for (const room of incoming) {
    const key = room.labelId ?? null;
    kept = key
      ? kept.filter((r) => r.labelId !== key)
      : kept.filter((r) => !(
        Math.abs(r.rect.left - room.rect.left) < 4 && Math.abs(r.rect.top - room.rect.top) < 4
      ));
  }
  return [...kept, ...incoming];
};

// ──── store ──────────────────────────────────────────────────────────────────

const useAppStore = create(subscribeWithSelector((set, get) => ({
  // ── working state ──────────────────────────────────────────────────────────
  ...WORKING_STATE_DEFAULTS,

  // ── UI-only state (not in undo/autosave) ───────────────────────────────────
  // Per-plan, despite being UI: both name a place on one drawing. Window-level
  // UI — the dock, the modals, the status flash — lives in workspaceStore.js.
  // Which detection warning the user is inspecting, as {traceId, index} into
  // that trace's `quality.warnings`. Declared here rather than in the working
  // state so it cannot reach a snapshot, a draft or a `.floorplan`: undoing an
  // edit must not restore a highlight. Every reader resolves it against the
  // live traces, so a focus left on a deleted trace simply renders nothing.
  focusedWarning: null,
  // What the autosaved draft is actually doing right now: 'off' | 'pending' |
  // 'saved' | 'error'. Reported rather than assumed — the status bar used to
  // read a hardcoded "Saved", which was the one claim in the shell that was
  // true by coincidence and never checked.
  draftState: 'off',
  // A transient canvas highlight for an error that has a place on the plan —
  // a self-intersection knows which two edges cross. Same anchor shape as
  // `focusedWarning` resolves to, so WarningHighlightLayer renders both.
  errorAnchor: null,

  // ── flag for autosave gating ───────────────────────────────────────────────
  _hasRestoredState: false,

  // ── document identity (which plans exist; metadata only) ───────────────────
  ...createDocumentSlice(set, get),

  // ── floor management ───────────────────────────────────────────────────────
  ...createFloorSlice(set, get),

  // ── setters (thin wrappers so call-sites remain terse) ─────────────────────
  setImage: (v) => set({ image: v }),
  setImageMimeType: (v) => set({ imageMimeType: v }),
  setRoomOverlay: (v) => set({ roomOverlay: v }),
  setPerimeterOverlay: (v) => {
    const state = get();
    const activeId = state.activeTraceId;
    const currentTraces = state.perimeterTraces || [];

    if (!activeId) {
      // Create a default first trace if none exists
      const newId = newTraceId();
      const newTrace = {
        id: newId,
        name: '1st Floor',
        vertices: v?.vertices || [],
        holes: v?.holes ?? [],
        quality: v?.quality ?? null,
        wallFaces: v?.wallFaces ?? null,
        closed: true,
        visible: true,
        locked: false,
        type: DEFAULT_TRACE_TYPE,
        typeSource: 'auto',
        colorSource: 'type',
        nameSource: 'auto',
        color: traceTypeColor(DEFAULT_TRACE_TYPE),
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
        const vertices = v?.vertices || [];
        return {
          ...t,
          vertices,
          // Deliberately the opposite of `quality` below: holes are independent
          // rings a vertex edit did not touch, so an update that omits them
          // keeps them. Defaulting them to [] silently deleted every courtyard
          // on the first corner nudge and added the void back into the area.
          // Supplying them replaces only what the detector found — see mergeHoles.
          // Re-checked against the new outline: a kept user void can end up
          // outside it, and is then marked rather than dropped or subtracted.
          holes: markStaleHoles(
            v ? ('holes' in v ? mergeHoles(t.holes, v.holes) : (t.holes ?? [])) : [],
            vertices,
          ),
          // Editing a trace by hand makes it the user's geometry, so an
          // auto-detection's confidence no longer describes it.
          quality: v && 'quality' in v ? v.quality : null,
          // The opposite rule, and for the same reason as `holes`: the wall-face
          // pair describes the detection, not the vertices, so a corner nudge
          // keeps it and the exterior/interior switch still works afterwards.
          // `setPerimeterOverlay(null)` — how manual and draw modes hand the
          // outline back to the user — is what drops it.
          wallFaces: v ? ('wallFaces' in v ? v.wallFaces : (t.wallFaces ?? null)) : null,
          closed: true,
        };
      }
      return t;
    });

    const patch = {
      perimeterTraces: updatedTraces,
      isDirty: true,
    };

    if (state.perimeterVertices !== null) {
      patch.perimeterVertices = v ? (v.vertices || []) : null;
    }

    set(patch);
  },
  setRoomDimensions: (v) => set({ roomDimensions: v }),
  setMode: (v) => set({ mode: v }),
  applyRoomCalibration: (feetPerPixel, roomId = null, mutationSource = 'room-calibration', quality = null) => {
    if (!CALIBRATION_SOURCES.has(mutationSource)) {
      throw new Error(
        "Only explicit room calibration may modify calibration scale"
      );
    }
    let targetScale;
    if (typeof feetPerPixel === 'number') {
      targetScale = { x: feetPerPixel, y: feetPerPixel };
    } else if (feetPerPixel && typeof feetPerPixel.x === 'number' && typeof feetPerPixel.y === 'number') {
      targetScale = feetPerPixel;
    } else {
      throw new Error("Invalid calibration scale");
    }

    if (
      isNaN(targetScale.x) || !isFinite(targetScale.x) || targetScale.x <= 0 ||
      isNaN(targetScale.y) || !isFinite(targetScale.y) || targetScale.y <= 0
    ) {
      throw new Error("Invalid calibration scale");
    }

    // Whatever the plan was flagged for is now answered.
    get().setActiveDocumentMeta({ needsRescale: false });
    set({
      calibration: {
        calibrated: true,
        feetPerPixel: targetScale,
        source: mutationSource,
        calibratedRoomId: roomId,
        createdAt: Date.now(),
        // How much this scale can be trusted, kept with the scale itself: the
        // area is rendered from it long after the toast that announced it has
        // gone, and "is this number right" must stay answerable.
        quality,
      },
      isDirty: true,
    });
  },
  setIsProcessing: (v, msg = '') => set({ isProcessing: v, processingMessage: v ? msg : '' }),
  setDetectedDimensions: (v) => set({ detectedDimensions: v }),
  setExteriorLabels: (v) => set({ exteriorLabels: v }),
  setAreaLabels: (v) => set({ areaLabels: v }),
  setRooms: (v) => set({ rooms: v }),
  /**
   * Record a detected room. Rooms accumulate: they are the boundary stage's
   * containment evidence and the sample set a robust scale is fitted to, and
   * both need more than the one room the overlay can hold. A repeat detection
   * of the same label replaces the earlier one.
   */
  addRoom: (room) => set((state) => {
    if (!room?.rect) return {};
    return { rooms: mergeRooms(state.rooms, [room]) };
  }),
  /**
   * Record a whole scan's worth of rooms at once. The automatic scale measures
   * every label on the page, and applying those one at a time notified every
   * subscriber once per room and left the tracer briefly reading a half-built
   * evidence set.
   */
  addRooms: (rooms) => set((state) => {
    const incoming = (rooms ?? []).filter((room) => room?.rect);
    if (!incoming.length) return {};
    return { rooms: mergeRooms(state.rooms, incoming) };
  }),
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
  setScaleToolActive: (v) => set({ scaleToolActive: v }),
  setScaleLines: (v) => set({ scaleLines: v }),
  setCurrentScaleLine: (v) => set({ currentScaleLine: v }),
  addScaleLine: (line) => set((state) => (
    line?.start && line?.end ? { scaleLines: [...state.scaleLines, line] } : {}
  )),
  removeScaleLine: (id) => set((state) => ({
    scaleLines: state.scaleLines.filter((l) => l.id !== id),
  })),
  // Clearing the lines must retire the scale they asserted: a calibration
  // whose evidence is gone is the green-but-wrong failure this codebase keeps
  // re-learning. Gated on the source so a room calibration cannot be clobbered.
  clearLineCalibration: () => set((state) => ({
    scaleLines: [],
    currentScaleLine: null,
    calibration: state.calibration?.source === 'line-calibration'
      ? workingStateDefaults().calibration
      : state.calibration,
    isDirty: true,
  })),
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
  setEraserToolActive: (v) => set({ eraserToolActive: v }),
  setEraserBrushSize: (v) => set({ eraserBrushSize: v }),
  setCropToolActive: (v) => set({ cropToolActive: v }),
  setVoidToolActive: (v) => set({ voidToolActive: v }),
  /**
   * Punch a void out of a trace by hand. Tagged `source: 'user'` so a later
   * re-trace keeps it; callers save the undo point before calling.
   */
  addHole: (traceId, ring) => set((state) => {
    if (!ring || ring.length < 3) return {};
    const hole = {
      id: `hole-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      ring,
      source: 'user',
    };
    return {
      perimeterTraces: (state.perimeterTraces || []).map((t) => (
        t.id === traceId ? { ...t, holes: [...(t.holes ?? []), hole] } : t
      )),
      isDirty: true,
    };
  }),
  removeHole: (traceId, holeId) => set((state) => ({
    perimeterTraces: (state.perimeterTraces || []).map((t) => (
      t.id === traceId
        ? { ...t, holes: (t.holes ?? []).filter((h, i) => holeKey(h, i) !== holeId) }
        : t
    )),
    isDirty: true,
  })),
  setDrawModeActive: (v) => set({ drawModeActive: v }),
  setDrawBrushSize: (v) => set({ drawBrushSize: v }),
  setDrawStrokes: (v) => set({ drawStrokes: v }),
  addDrawStroke: (stroke) => set((state) => (
    stroke?.points?.length ? { drawStrokes: [...state.drawStrokes, stroke] } : {}
  )),
  setZoomScale: (v) => set({ zoomScale: v }),
  setStagePosition: (pos) => set({ stageX: pos.x, stageY: pos.y }),
  setViewportTransform: (scale, pos, token) => set({ zoomScale: scale, stageX: pos.x, stageY: pos.y, viewportSyncToken: token }),
  setCanvasRotation: (v) => set({ canvasRotation: v }),
  setIsDirty: (v) => set({ isDirty: v }),
  setProjectId: (v) => set({ projectId: v }),
  loadProject: (projectState) => set({
    ...workingStateDefaults(),
    ...projectState,
    traceInteractionMode: 'idle',
    perimeterVertices: null,
    isProcessing: false,
    processingMessage: '',
  }),
  setFocusedWarning: (v) => set({ focusedWarning: v }),
  setDraftState: (v) => set({ draftState: v }),
  // Dirty like any other document edit: the subject line is what a saved
  // project is filed under, so losing it is losing work.
  setProjectName: (v) => set({ projectName: v, isDirty: true }),
  setErrorAnchor: (v) => set({ errorAnchor: v }),
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
    const lightweight = cloneSnapshot(pickFields(state, SNAPSHOT_CLONED_FIELDS));
    // Fast path: reuse the same string reference when image hasn't changed.
    // undoManager's intern pool will deduplicate across reference boundaries.
    if (state.image === prevImage) {
      lightweight.image = prevImage;
    } else {
      lightweight.image = state.image;
    }
    // Shared, not cloned: setTracedBoundaries always replaces the whole result
    // and every reader (getFloorBoundariesForMode, tracedAreaPx) only reads it,
    // so a snapshot taken before a re-trace still holds the result it was taken
    // with. It stays snapshotted because undo must restore the trace the wall
    // mode toggle re-applies — dropping it let an undone trace come back.
    lightweight.tracedBoundaries = state.tracedBoundaries;
    return lightweight;
  },

  /** Return the current autosave-ready state (includes image). */
  getAutosaveState: () => pickFields(get(), AUTOSAVE_FIELDS),

  /** Apply a snapshot produced by createSnapshot (used by undo/redo). */
  applySnapshot: (snapshot) => {
    const patch = {};
    const defaults = workingStateDefaults();
    for (const k of SNAPSHOT_FIELDS) {
      patch[k] = snapshot[k] ?? defaults[k];
    }
    // A `.floorplan` carries its undo stacks, so undoing into a pre-migration
    // snapshot would otherwise hand back untyped traces.
    patch.perimeterTraces = normalizeTraces(patch.perimeterTraces);
    // Older snapshots predate activeTraceId being captured — never leave the
    // selection dangling on a trace that no longer exists.
    const traces = patch.perimeterTraces || [];
    if (!traces.some((t) => t.id === patch.activeTraceId)) {
      patch.activeTraceId = traces[0]?.id ?? null;
    }
    set(patch);
  },

  // ── reset ──────────────────────────────────────────────────────────────────

  /** Reset all working state except `image` to defaults. */
  resetOverlays: () => {
    const defaults = workingStateDefaults();
    delete defaults.image; // preserve current image
    set(defaults);
  },

  /**
   * Full restart: clear image and all working state, reset to a single floor.
   * The trace reset runs last — applied first, the working-state spread put
   * the stale default trace straight back.
   */
  restart: () => {
    set(workingStateDefaults());
    get().resetPerimeterTraces();
    // The tab is the same tab, so its identity survives — but nothing it knew
    // about the old plan may, or a closed project leaves its filename behind to
    // name the empty one that replaces it.
    get().resetActiveDocumentMeta();
  },

  // ── bulk restore (used by autosave restore) ────────────────────────────────

  /** Everything the active plan needs to be restored exactly as it is now. */
  getParkedState: () => pickFields(get(), PARK_FIELDS),

  /**
   * Take a parked plan onto the store root.
   *
   * Deliberately not `loadProject`, which spreads `workingStateDefaults()`
   * first and then force-sets four fields. That is right for *opening* a plan —
   * a file has no opinion about interaction mode — and wrong for *restoring*
   * one, where the whole point is that nothing was lost. Anything a parked
   * record does not carry is reset to its default, so the two transient fields
   * PARK_FIELDS leaves out come back clean rather than stale.
   */
  adoptParkedState: (parked) => {
    const defaults = workingStateDefaults();
    const patch = {};
    for (const k of PARK_FIELDS) {
      patch[k] = k in parked ? parked[k] : defaults[k];
    }
    patch.isProcessing = false;
    patch.processingMessage = '';
    patch.viewportSyncToken = null;
    // Deliberately NOT `normalizeTraces` here, unlike `applySnapshot` and
    // `restoreFromSaved`. That is a migration for traces coming off disk — a
    // draft or a `.floorplan` written before types existed. A parked record was
    // live state in this session moments ago, so there is nothing to migrate,
    // and normalising rebuilds every trace object: the array identity is what
    // the area memo and every subscribed component compare on, so a switch
    // would re-render and recompute the whole plan for no reason.
    const traces = patch.perimeterTraces || [];
    if (!traces.some((t) => t.id === patch.activeTraceId)) {
      patch.activeTraceId = traces[0]?.id ?? null;
    }
    set(patch);
  },

  restoreFromSaved: (saved) => {
    const patch = {};
    for (const k of AUTOSAVE_FIELDS) {
      if (k in saved) {
        patch[k] = saved[k];
      }
    }
    // A draft written before types carries untyped traces.
    if ('perimeterTraces' in patch) {
      patch.perimeterTraces = normalizeTraces(patch.perimeterTraces);
    }
    // Also set isProcessing/processingMessage to false/empty when restoring
    patch.isProcessing = false;
    patch.processingMessage = '';
    set(patch);
  },
})));

// Feet per pixel of every room measured so far: the sample set a robust
// multi-room scale is taken from. Takes `rooms` rather than the store so a
// component can derive it from its own subscription without a new array
// identity on every unrelated store change.
export const roomScaleSamples = (rooms = []) =>
  rooms.flatMap((r) => (r.feetPerPixel ? [r.feetPerPixel.x, r.feetPerPixel.y] : []));

// The same, minus the room currently under the overlay. A room being measured
// cannot be its own second opinion: it is already in `rooms` by the time the
// scale is set, and comparing it with itself would agree every time.
export const otherRoomScaleSamples = (rooms = [], overlay = null) => {
  if (!overlay) return roomScaleSamples(rooms);
  const left = Math.min(overlay.x1, overlay.x2);
  const right = Math.max(overlay.x1, overlay.x2);
  const top = Math.min(overlay.y1, overlay.y2);
  const bottom = Math.max(overlay.y1, overlay.y2);
  return roomScaleSamples(rooms.filter((r) => {
    if (!r.rect) return true;
    const cx = (r.rect.left + r.rect.right) / 2;
    const cy = (r.rect.top + r.rect.bottom) / 2;
    return !(cx >= left && cx <= right && cy >= top && cy <= bottom);
  }));
};

// ── Memoized selectors ────────────────────────────────────────────────────────

let lastActiveTraceId = null;
let lastVertices = null;
let lastHoles = null;
let lastQuality = null;
let lastOverlayResult = null;

// Carries the whole trace geometry, not just `vertices`: a lossy adapter is how
// an edit round-tripped through here could drop holes on the way back in.
//
// Named for what it reads: the overlay of the *active* trace of the *live*
// store, memoised on module state. Anything that needs the overlay of a state
// it was handed must not come through here — the memo answers for whichever
// state called last.
export const selectActivePerimeterOverlay = (state) => {
  const traces = state.perimeterTraces || [];
  const active = traces.find(t => t.id === state.activeTraceId);
  if (!active) {
    lastActiveTraceId = null;
    lastVertices = null;
    lastHoles = null;
    lastQuality = null;
    lastOverlayResult = null;
    return null;
  }
  if (
    state.activeTraceId === lastActiveTraceId &&
    active.vertices === lastVertices &&
    active.holes === lastHoles &&
    active.quality === lastQuality
  ) {
    return lastOverlayResult;
  }
  lastActiveTraceId = state.activeTraceId;
  lastVertices = active.vertices;
  lastHoles = active.holes;
  lastQuality = active.quality;
  lastOverlayResult = {
    vertices: active.vertices,
    holes: active.holes,
    quality: active.quality,
  };
  return lastOverlayResult;
};

/**
 * Whether the exterior/interior switch has anything to switch. Offered only
 * when an outline can actually take it — a toggle that silently does nothing is
 * worse than one that is not there, and it used to be shown for a hand-drawn
 * outline that had no second face. The `tracedBoundaries` arm keeps it for
 * drafts saved before traces carried the pair themselves.
 */
export const selectCanSwitchWallFace = (state) =>
  (state.perimeterTraces || []).some((t) => t.wallFaces?.outer || t.wallFaces?.inner)
  || Boolean(state.tracedBoundaries);

let lastFeetPerPixel = null;
let lastTraces = [];
let lastAreaByType = null;

/**
 * Area of the visible traces, split by type. The memo is a correctness
 * requirement, not an optimisation: this returns an object, and zustand's
 * default `Object.is` would re-render every consumer on every unrelated `set()`
 * without a stable reference.
 */
// Nesting is what double counting looks like here. `nonGla.js` normally carves
// a garage out of the footprint, and a user who then traces it gets it in the
// garage subtotal and out of GLA — correct. When the carve fails the garage is
// still inside the GLA outline, so tracing it adds the same floor twice: once
// in GLA and once in its own subtotal. Reported, never silently corrected —
// which of the two is wrong is the user's call, not the app's.
const NESTED_ENOUGH = 0.9;

const findDoubleCounted = (traces) => {
  const live = traces.filter((t) => t.visible && t.vertices?.length >= 3);
  const found = [];
  for (const inner of live) {
    const innerType = normalizeTraceType(inner.type);
    if (innerType === DEFAULT_TRACE_TYPE) continue;
    for (const outer of live) {
      if (outer === inner) continue;
      if (normalizeTraceType(outer.type) !== DEFAULT_TRACE_TYPE) continue;
      if (containmentRatio(inner.vertices, outer.vertices) >= NESTED_ENOUGH) {
        found.push({ innerId: inner.id, innerName: inner.name, outerName: outer.name });
        break;
      }
    }
  }
  return found;
};

/**
 * Area of the visible traces, split by type — computed, not memoised.
 *
 * Takes any working state, not necessarily the live one, and returns a fresh
 * object every call. That is exactly what a caller wants when it is not a React
 * subscription: the exhibit builder is handed a state and must describe *that*
 * state, and a module-level memo keyed on nothing but the last call is the
 * wrong tool for it — with more than one plan around, alternating callers would
 * thrash the memo, and the exhibit could be handed the other plan's numbers.
 *
 * `selectActiveAreaByType` below is the memoised view of the live store, for
 * components. This is the arithmetic underneath it.
 */
export const computeAreaByType = (state) => {
  const traces = state.perimeterTraces || [];
  const feetPerPixel = state.calibration?.feetPerPixel || { x: 1.0, y: 1.0 };

  const byType = {};
  const counts = {};
  let total = 0;
  // Hiding a trace drops it from its own subtotal and from the total, which is
  // what hiding a trace has always meant here.
  for (const t of traces) {
    if (!t.visible || !t.vertices || t.vertices.length < 3) continue;
    const type = normalizeTraceType(t.type);
    const value = calculateArea(t.vertices, feetPerPixel, t.holes);
    byType[type] = (byType[type] ?? 0) + value;
    counts[type] = (counts[type] ?? 0) + 1;
    total += value;
  }

  return {
    byType,
    counts,
    gla: byType[DEFAULT_TRACE_TYPE] ?? 0,
    total,
    doubleCounted: findDoubleCounted(traces),
  };
};

export const selectActiveAreaByType = (state) => {
  const traces = state.perimeterTraces || [];
  const feetPerPixel = state.calibration?.feetPerPixel || { x: 1.0, y: 1.0 };

  // Quick check for changes in feetPerPixel properties or trace object reference
  let changed = !lastAreaByType || !lastFeetPerPixel ||
                feetPerPixel.x !== lastFeetPerPixel.x ||
                feetPerPixel.y !== lastFeetPerPixel.y ||
                traces.length !== lastTraces.length;
  if (!changed) {
    for (let i = 0; i < traces.length; i++) {
      if (traces[i] !== lastTraces[i]) {
        changed = true;
        break;
      }
    }
  }

  if (!changed) {
    return lastAreaByType;
  }

  lastFeetPerPixel = { ...feetPerPixel };
  lastTraces = traces.slice();
  lastAreaByType = computeAreaByType(state);
  return lastAreaByType;
};

/** Selector to get the combined total area of all visible traces */
export const selectCombinedArea = (state) => selectActiveAreaByType(state).total;

export { AUTOSAVE_FIELDS, PARK_FIELDS, PARK_ONLY_FIELDS, SNAPSHOT_FIELDS, EXCLUDED_SNAPSHOT_FIELDS, EXCLUDED_AUTOSAVE_FIELDS, EXCLUDED_PERSISTENT_FIELDS };
export default useAppStore;
