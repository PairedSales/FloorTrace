import * as undoManager from './undoManager';
import {
  DEFAULT_TRACE_TYPE,
  assignTypeColors,
  normalizeTraceType,
  traceTypeColor,
} from '../utils/traceTypes';

/**
 * Perimeter Trace Manager Slice — refactored to manage multiple perimeter traces
 * on a single, globally calibrated canvas using trace-centric terminology.
 *
 * Each perimeter trace represents an independent polygon on the canvas.
 * Legacy floor properties are removed from active Zustand state. Compatibility
 * translation is encapsulated inside the serialization layer.
 */

const ordinalSuffix = (num) =>
  num === 1 ? 'st' : num === 2 ? 'nd' : num === 3 ? 'rd' : 'th';

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

      const newId = `trace-${Date.now()}`;
      const newName = generateTraceName(state.perimeterTraces);

      const newTrace = {
        id: newId,
        name: newName,
        vertices: [],
        closed: false,
        visible: true,
        locked: false,
        type: DEFAULT_TRACE_TYPE,
        colorSource: 'type',
        color: traceTypeColor(DEFAULT_TRACE_TYPE),
      };

      set({
        perimeterTraces: assignTypeColors([...state.perimeterTraces, newTrace]),
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
        // Re-shaded so the lightness steps close up behind the deleted trace.
        perimeterTraces: assignTypeColors(remainingTraces),
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
     * Set a perimeter trace's area type. The type moves area between the
     * reported subtotals, so it is document content and saves an undo snapshot.
     */
    setPerimeterTraceType: (traceId, type) => {
      const state = get();
      const traces = state.perimeterTraces || [];
      if (!traces.some((t) => t.id === traceId)) return;
      undoManager.save();

      const nextType = normalizeTraceType(type);
      set({
        perimeterTraces: assignTypeColors(
          traces.map((t) => (t.id === traceId ? { ...t, type: nextType } : t))
        ),
        isDirty: true,
      });
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
        // Identity is kept, and visibility and type are part of identity:
        // re-tracing must not un-hide a trace the user hid, nor reset a garage
        // the user typed back to GLA.
        traces = current.map((t, i) => ({
          ...t,
          ...normalized[i],
          closed: true,
        }));
      } else {
        const stamp = Date.now();
        traces = normalized.map((floor, i) => ({
          id: `trace-${stamp}-${i}`,
          name: `${i + 1}${ordinalSuffix(i + 1)} Floor`,
          ...floor,
          closed: true,
          visible: true,
          locked: false,
          type: DEFAULT_TRACE_TYPE,
          colorSource: 'type',
          color: traceTypeColor(DEFAULT_TRACE_TYPE),
        }));
      }
      traces = assignTypeColors(traces);

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
      const defaultTraceId = `trace-${Date.now()}`;
      set({
        perimeterTraces: [
          {
            id: defaultTraceId,
            name: '1st Floor',
            vertices: [],
            closed: false,
            visible: true,
            locked: false,
            type: DEFAULT_TRACE_TYPE,
            colorSource: 'type',
            color: traceTypeColor(DEFAULT_TRACE_TYPE),
          }
        ],
        activeTraceId: defaultTraceId,
        traceInteractionMode: 'idle',
        perimeterVertices: null,
      });
    },
  };
}
