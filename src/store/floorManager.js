import * as undoManager from './undoManager';

/**
 * Perimeter Trace Manager Slice — refactored to manage multiple perimeter traces
 * on a single, globally calibrated canvas using trace-centric terminology.
 *
 * Each perimeter trace represents an independent polygon on the canvas.
 * Legacy floor properties are removed from active Zustand state. Compatibility
 * translation is encapsulated inside the serialization layer.
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

const ordinalSuffix = (num) =>
  num === 1 ? 'st' : num === 2 ? 'nd' : num === 3 ? 'rd' : 'th';

/**
 * Mint a trace id. A bare `Date.now()` is not unique: two traces created in the
 * same millisecond shared an id, and `deletePerimeterTrace` filters by id, so
 * deleting one deleted both. The counter is what guarantees uniqueness — unlike
 * trace *names*, ids are never user-visible, so it surviving loadProject is
 * harmless; the timestamp is only there to keep ids readable.
 */
let traceIdCounter = 0;
export const newTraceId = () => `trace-${Date.now()}-${(traceIdCounter += 1)}`;

const FLOOR_NAME = /^(\d+)(?:st|nd|rd|th) Floor$/;

/**
 * Generate a sequential trace name. Derived from the traces on hand rather
 * than a module counter: a counter survives loadProject/restoreFromSaved, so
 * reopening a project started naming at "7th Floor".
 */
function generateTraceName(traces) {
  const highest = (traces || []).reduce((max, t) => {
    const match = FLOOR_NAME.exec(t.name || '');
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  const num = Math.max(highest, (traces || []).length) + 1;
  return `${num}${ordinalSuffix(num)} Floor`;
}

export function createFloorSlice(set, get) {
  return {
    /**
     * Add a new empty perimeter trace and select it.
     */
    addPerimeterTrace: () => {
      undoManager.save();
      const state = get();

      const newId = newTraceId();
      const newName = generateTraceName(state.perimeterTraces);
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
    switchPerimeterTrace: (targetTraceId) => {
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
    deletePerimeterTrace: (traceId) => {
      const state = get();

      const currentTraces = state.perimeterTraces || [];
      const traceIndex = currentTraces.findIndex((t) => t.id === traceId);
      if (traceIndex === -1) return;
      undoManager.save();

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
    renamePerimeterTrace: (traceId, newName) => {
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
     * Replace all traces with auto-detected floor polygons (one per floor,
     * already in page reading order). When the count matches the existing
     * traces, identity (ids/names/colors) is kept so re-applying — e.g. the
     * interior/exterior wall toggle — preserves user renames. Callers are
     * responsible for the undo snapshot.
     */
    applyDetectedTraces: (floors) => {
      if (!floors?.length) return;
      const state = get();
      const current = state.perimeterTraces || [];
      const normalized = floors.map((floor) => (Array.isArray(floor)
        ? { vertices: floor, holes: [], quality: null }
        : { vertices: floor.vertices, holes: floor.holes ?? [], quality: floor.quality ?? null }));

      let traces;
      if (current.length === normalized.length) {
        // Identity is kept, and visibility is part of identity: re-tracing must
        // not un-hide a trace the user hid.
        traces = current.map((t, i) => ({
          ...t,
          ...normalized[i],
          closed: true,
        }));
      } else {
        traces = normalized.map((floor, i) => ({
          id: newTraceId(),
          name: `${i + 1}${ordinalSuffix(i + 1)} Floor`,
          ...floor,
          closed: true,
          visible: true,
          locked: false,
          color: TRACE_COLORS[i % TRACE_COLORS.length],
        }));
      }

      const activeStillExists = traces.some((t) => t.id === state.activeTraceId);
      set({
        perimeterTraces: traces,
        activeTraceId: activeStillExists ? state.activeTraceId : traces[0].id,
        traceInteractionMode: 'idle',
        perimeterVertices: null,
        isDirty: true,
      });
    },

    /**
     * Reset floor manager/trace slice to initial state.
     */
    resetPerimeterTraces: () => {
      const defaultTraceId = newTraceId();
      set({
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
