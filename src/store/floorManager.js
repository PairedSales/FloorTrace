import useAppStore from './appStore';
import * as undoManager from './undoManager';
import { calculateArea } from '../utils/areaCalculator';

/**
 * Floor Manager Slice — refactored to manage multiple perimeter traces
 * on a single, globally calibrated canvas.
 *
 * Each perimeter trace represents an independent polygon on the canvas.
 * Legacy methods are preserved for toolbar and app state compatibility,
 * but mapped to perimeter trace actions.
 */

const TRACE_COLORS = [
  '#BD93F9', // Dracula Purple
  '#8BE9FD', // Dracula Cyan
  '#50FA7B', // Dracula Green
  '#FF79C6', // Dracula Pink
  '#FFB86C', // Dracula Orange
  '#F1FA8C', // Dracula Yellow
  '#FF5555', // Dracula Red
];

let nextTraceNumber = 2;

/**
 * Generate a sequential floor/trace name.
 */
function generateTraceName() {
  const num = nextTraceNumber++;
  const suffix = num === 1 ? 'st' : num === 2 ? 'nd' : num === 3 ? 'rd' : 'th';
  return `${num}${suffix} Floor`;
}

// Fields persisted inside project files per trace session:
// Kept for structure, but serialization uses a single canonical canvas.
const FLOOR_STATE_FIELDS = [
  'image',
  'roomOverlay',
  'roomDimensions',
  'calibration',
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
  'perimeterTraces',
  'activeTraceId',
  'tracedBoundaries',
  'debugDetection',
  'detectionDebugData',
  'eraserToolActive',
  'eraserBrushSize',
  'cropToolActive',
  'zoomScale',
  'stageX',
  'stageY',
];

export function createFloorSlice(set, get) {
  return {
    // We maintain a dummy floors structure for project serialization schema compatibility.
    // There is always exactly one floor session recorded in the project file,
    // which holds all the traces.
    floors: [
      {
        id: 'floor-1',
        name: '1st Floor',
        state: null, // active
      },
    ],
    activeFloorId: 'floor-1',

    /**
     * Add a new empty perimeter trace and select it.
     */
    addFloor: () => {
      undoManager.save();
      const state = get();

      const newId = `trace-${Date.now()}`;
      const newName = generateTraceName();
      const colorIndex = state.perimeterTraces.length % TRACE_COLORS.length;
      const newColor = TRACE_COLORS[colorIndex];

      const newTrace = {
        id: newId,
        name: newName,
        vertices: [],
        closed: false,
        visible: true,
        locked: false,
        color: newColor,
      };

      set({
        perimeterTraces: [...state.perimeterTraces, newTrace],
        activeTraceId: newId,
        traceInteractionMode: 'drawing',
        perimeterVertices: [], // start drawing immediately
        isDirty: true,
      });
    },

    /**
     * Switch / select a perimeter trace.
     * Selection change does not save an undo snapshot.
     */
    switchFloor: (targetTraceId) => {
      const state = get();
      if (targetTraceId === state.activeTraceId) return;

      set({
        activeTraceId: targetTraceId,
        traceInteractionMode: 'idle',
        perimeterVertices: null, // cancel drawing mode on switch
      });
    },

    /**
     * Delete a perimeter trace.
     * Deterministically shifts selection to neighboring trace if active trace is deleted.
     */
    closeFloor: (traceId) => {
      undoManager.save();
      const state = get();

      const currentTraces = state.perimeterTraces || [];
      const traceIndex = currentTraces.findIndex((t) => t.id === traceId);
      if (traceIndex === -1) return;

      const remainingTraces = currentTraces.filter((t) => t.id !== traceId);
      let nextActiveId = state.activeTraceId;

      if (state.activeTraceId === traceId) {
        if (remainingTraces.length > 0) {
          const newIndex = Math.max(0, traceIndex - 1);
          nextActiveId = remainingTraces[newIndex].id;
        } else {
          nextActiveId = null;
        }
      }

      set({
        perimeterTraces: remainingTraces,
        activeTraceId: nextActiveId,
        traceInteractionMode: nextActiveId ? 'idle' : 'idle',
        perimeterVertices: null,
        isDirty: true,
      });
    },

    /**
     * Rename a perimeter trace.
     */
    renameFloor: (traceId, newName) => {
      const state = get();
      const updated = (state.perimeterTraces || []).map((t) =>
        t.id === traceId ? { ...t, name: newName } : t
      );
      set({ perimeterTraces: updated, isDirty: true });
    },

    /**
     * Toggle visibility of a perimeter trace.
     * Visibility is treated as document state (saves undo snapshot).
     */
    togglePerimeterTraceVisibility: (traceId) => {
      undoManager.save();
      const state = get();
      const updated = (state.perimeterTraces || []).map((t) =>
        t.id === traceId ? { ...t, visible: !t.visible } : t
      );
      set({
        perimeterTraces: updated,
        isDirty: true,
      });
    },

    /**
     * Get area for a specific trace.
     */
    getFloorArea: (traceId) => {
      const state = get();
      const trace = (state.perimeterTraces || []).find((t) => t.id === traceId);
      const feetPerPixel = state.calibration?.feetPerPixel || 1.0;
      return trace ? calculateArea(trace.vertices, feetPerPixel) : 0;
    },

    /**
     * Reset floor manager to initial state.
     */
    resetFloors: () => {
      nextTraceNumber = 2;
      const defaultTraceId = `trace-${Date.now()}`;
      set({
        floors: [{ id: 'floor-1', name: '1st Floor', state: null }],
        activeFloorId: 'floor-1',
        perimeterTraces: [
          {
            id: defaultTraceId,
            name: '1st Floor',
            vertices: [],
            closed: false,
            visible: true,
            locked: false,
            color: '#BD93F9',
          }
        ],
        activeTraceId: defaultTraceId,
        traceInteractionMode: 'idle',
        perimeterVertices: null,
      });
    },
  };
}
