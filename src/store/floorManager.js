import useAppStore from './appStore';
import * as undoManager from './undoManager';

/**
 * Floor Manager — manages multiple floor sessions.
 *
 * Each floor is a self-contained session with its own geometry, overlays,
 * dimensions, area, measurement lines, custom shapes, etc.
 *
 * The active floor's state lives in the main Zustand store (appStore).
 * When the user switches floors, the current floor's state is serialized
 * into this manager and the target floor's state is restored into appStore.
 */

// Fields that are saved/restored per floor session.
// Excludes transient UI state (isProcessing, processingMessage, notifications, etc.)
const FLOOR_STATE_FIELDS = [
  'image',
  'roomOverlay',
  'perimeterOverlay',
  'roomDimensions',
  'area',
  'scale',
  'mode',
  'detectedDimensions',
  'showSideLengths',
  'useInteriorWalls',
  'autoSnapEnabled',
  'manualEntryMode',
  'ocrFailed',
  'unit',
  'lineToolActive',
  'measurementLines',
  'currentMeasurementLine',
  'drawAreaActive',
  'customShapes',
  'currentCustomShape',
  'perimeterVertices',
  'tracedBoundaries',
  'debugDetection',
  'detectionDebugData',
  'eraserToolActive',
  'eraserBrushSize',
  'cropToolActive',
];

const MAX_FLOORS = 4;
let nextFloorNumber = 2; // "1st Floor" is floor 1

/**
 * Generate the next sequential floor name using ordinal abbreviations.
 */
function generateFloorName() {
  const num = nextFloorNumber++;
  const suffix = num === 1 ? 'st' : num === 2 ? 'nd' : num === 3 ? 'rd' : 'th';
  return `${num}${suffix} Floor`;
}

/**
 * Capture the current appStore working state for a floor snapshot.
 */
function captureFloorState() {
  const state = useAppStore.getState();
  const snapshot = {};
  for (const key of FLOOR_STATE_FIELDS) {
    snapshot[key] = state[key];
  }
  return snapshot;
}

/**
 * Restore a floor snapshot into the appStore.
 */
function restoreFloorState(snapshot) {
  const patch = {};
  for (const key of FLOOR_STATE_FIELDS) {
    patch[key] = snapshot[key];
  }
  // Clear transient processing state when switching floors
  patch.isProcessing = false;
  patch.processingMessage = '';
  useAppStore.setState(patch);
}

/**
 * Create an empty floor state snapshot (new blank session).
 */
function createEmptyFloorState() {
  return {
    image: null,
    roomOverlay: null,
    perimeterOverlay: null,
    roomDimensions: { width: '', height: '' },
    area: 0,
    scale: 1,
    mode: 'normal',
    detectedDimensions: [],
    showSideLengths: true,
    useInteriorWalls: false,
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
}

// ── Floor Zustand slice (added to appStore) ──────────────────────────────────

/**
 * Create the floor management slice for appStore.
 * This is merged into the main store via a separate `set/get` scope.
 */
export function createFloorSlice(set, get) {
  return {
    // Array of floor objects: { id, name, state }
    // `state` is null for the active floor (its state lives in appStore directly)
    floors: [
      {
        id: 'floor-1',
        name: '1st Floor',
        state: null, // active — state is the current appStore state
      },
    ],
    activeFloorId: 'floor-1',

    /**
     * Add a new empty floor and switch to it.
     */
    addFloor: () => {
      const state = get();
      if (state.floors.length >= MAX_FLOORS) return; // enforce max
      const currentFloorId = state.activeFloorId;

      // Save current floor's state
      const currentSnapshot = captureFloorState();
      const updatedFloors = state.floors.map((f) =>
        f.id === currentFloorId ? { ...f, state: currentSnapshot } : f
      );

      // Create new floor
      const newId = `floor-${Date.now()}`;
      const newName = generateFloorName();
      const newFloor = { id: newId, name: newName, state: null };

      // Clear undo history for the new floor
      undoManager.clear();

      // Restore empty state into appStore
      const emptyState = createEmptyFloorState();
      const patch = { ...emptyState };
      patch.isProcessing = false;
      patch.processingMessage = '';
      patch.floors = [...updatedFloors, newFloor];
      patch.activeFloorId = newId;

      set(patch);
    },

    /**
     * Switch to a different floor tab.
     */
    switchFloor: (targetFloorId) => {
      const state = get();
      if (targetFloorId === state.activeFloorId) return;

      const targetFloor = state.floors.find((f) => f.id === targetFloorId);
      if (!targetFloor) return;

      // Save current floor's state
      const currentSnapshot = captureFloorState();
      const updatedFloors = state.floors.map((f) => {
        if (f.id === state.activeFloorId) return { ...f, state: currentSnapshot };
        if (f.id === targetFloorId) return { ...f, state: null }; // will become active
        return f;
      });

      // Clear undo history (each floor has independent undo — for simplicity, we clear on switch)
      undoManager.clear();

      // Restore target floor's state
      const targetState = targetFloor.state || createEmptyFloorState();
      const patch = { ...targetState };
      patch.isProcessing = false;
      patch.processingMessage = '';
      patch.floors = updatedFloors;
      patch.activeFloorId = targetFloorId;

      set(patch);
    },

    /**
     * Close a floor tab. Cannot close the last remaining tab.
     */
    closeFloor: (floorId) => {
      const state = get();
      if (state.floors.length <= 1) return; // can't close last tab

      const floorToClose = state.floors.find((f) => f.id === floorId);
      if (!floorToClose) return;

      // Check if closing has unsaved work (image loaded = work exists)
      const hasWork = floorId === state.activeFloorId
        ? !!state.image
        : !!floorToClose.state?.image;

      if (hasWork) {
        const confirmed = window.confirm(
          `Close "${floorToClose.name}"? Any unsaved work will be lost.`
        );
        if (!confirmed) return;
      }

      const remainingFloors = state.floors.filter((f) => f.id !== floorId);

      if (floorId === state.activeFloorId) {
        // Closing the active tab — switch to the nearest neighbor
        const closedIndex = state.floors.findIndex((f) => f.id === floorId);
        const nextIndex = Math.min(closedIndex, remainingFloors.length - 1);
        const nextFloor = remainingFloors[nextIndex];

        // Mark the new active floor
        const updatedFloors = remainingFloors.map((f) =>
          f.id === nextFloor.id ? { ...f, state: null } : f
        );

        undoManager.clear();

        const nextState = nextFloor.state || createEmptyFloorState();
        const patch = { ...nextState };
        patch.isProcessing = false;
        patch.processingMessage = '';
        patch.floors = updatedFloors;
        patch.activeFloorId = nextFloor.id;

        set(patch);
      } else {
        // Closing an inactive tab — just remove it
        set({ floors: remainingFloors });
      }
    },

    /**
     * Rename a floor tab.
     */
    renameFloor: (floorId, newName) => {
      const state = get();
      const updatedFloors = state.floors.map((f) =>
        f.id === floorId ? { ...f, name: newName } : f
      );
      set({ floors: updatedFloors });
    },

    /**
     * Get area for a specific floor (for showing in tab badge).
     */
    getFloorArea: (floorId) => {
      const state = get();
      if (floorId === state.activeFloorId) return state.area;
      const floor = state.floors.find((f) => f.id === floorId);
      return floor?.state?.area || 0;
    },

    /**
     * Reset floor manager to initial state (single "First Floor" tab).
     */
    resetFloors: () => {
      nextFloorNumber = 2;
      undoManager.clear();
      set({
        floors: [{ id: 'floor-1', name: '1st Floor', state: null }],
        activeFloorId: 'floor-1',
      });
    },
  };
}
