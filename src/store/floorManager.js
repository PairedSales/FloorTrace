import * as undoManager from './undoManager';
import {
  DEFAULT_TRACE_TYPE,
  assignTypeColors,
  autoTraceName,
  normalizeTraceType,
  traceTypeColor,
} from '../utils/traceTypes';
// From areaCalculator, not appStore: appStore already imports createFloorSlice
// from here, so sourcing it there made a cycle that only worked by hoisting.
import { mergeHoles } from '../utils/areaCalculator';
import { markStaleHoles } from '../utils/geometryValidation';

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

/**
 * Mint a trace id. A bare `Date.now()` is not unique: two traces created in the
 * same millisecond shared an id, and `deletePerimeterTrace` filters by id, so
 * deleting one deleted both. The counter is what guarantees uniqueness — unlike
 * trace *names*, ids are never user-visible, so it surviving loadProject is
 * harmless; the timestamp is only there to keep ids readable.
 */
let traceIdCounter = 0;
export const newTraceId = () => `trace-${Date.now()}-${(traceIdCounter += 1)}`;

// Naming lives in traceTypes.js, which owns the taxonomy the names come from.
const generateTraceName = (traces) => autoTraceName(DEFAULT_TRACE_TYPE, traces);

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

      const newTrace = {
        id: newId,
        name: newName,
        vertices: [],
        closed: false,
        visible: true,
        locked: false,
        type: DEFAULT_TRACE_TYPE,
        colorSource: 'type',
        nameSource: 'auto',
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
        // `nameSource` pins the name against a later type change: once the user
        // has typed one, changing the type must not take it back.
        t.id === traceId ? { ...t, name: newName, nameSource: 'user' } : t
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
      // An auto name follows the type; a name the user typed does not.
      const others = traces.filter((t) => t.id !== traceId);
      set({
        perimeterTraces: assignTypeColors(
          traces.map((t) => (t.id === traceId
            ? {
              ...t,
              type: nextType,
              name: t.nameSource === 'user' ? t.name : autoTraceName(nextType, others),
            }
            : t))
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
          // Spreading `normalized[i]` would replace the holes wholesale, and a
          // void the user punched is not the detector's to discard.
          // Re-checked against the outline that just moved: a user void kept
          // across the re-trace can land outside it, and is marked not dropped.
          holes: markStaleHoles(mergeHoles(t.holes, normalized[i].holes), normalized[i].vertices),
          closed: true,
        }));
      } else {
        traces = normalized.map((floor, i) => ({
          id: newTraceId(),
          name: `${i + 1}${ordinalSuffix(i + 1)} Floor`,
          ...floor,
          // No identity to carry across a floor-count change, so the voids ride
          // along by position — the common case is a floor gained or lost below
          // the one that was punched.
          holes: markStaleHoles(mergeHoles(current[i]?.holes, floor.holes), floor.vertices),
          closed: true,
          visible: true,
          locked: false,
          type: DEFAULT_TRACE_TYPE,
          colorSource: 'type',
          nameSource: 'auto',
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
            type: DEFAULT_TRACE_TYPE,
            colorSource: 'type',
            nameSource: 'auto',
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
