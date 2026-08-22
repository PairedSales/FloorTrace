import * as undoManager from './undoManager';
import { newTraceId } from './ids';
import {
  DEFAULT_TRACE_TYPE,
  assignTypeColors,
  autoTraceName,
  normalizeTraceType,
  traceTypeColor,
} from '../utils/traceTypes';
import { classifyTraces } from '../utils/traceClassification';
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

// Minted in `ids.js`, which imports nothing: this module sits in a cycle with
// appStore and undoManager, and appStore mints a default trace id at module
// load — so whoever entered the cycle first decided whether the minter existed
// yet. Re-exported here because this is where callers expect to find it.
export { newTraceId } from './ids';

// A trace's stored wall-face pair is read repeatedly — every flip of the
// exterior/interior switch — so what lands on the trace is a copy. Sharing the
// arrays would let a later vertex drag edit the face it came from, and the
// switch back would return geometry that had quietly moved.
const clonePoints = (points) => (points ?? []).map((p) => ({ x: p.x, y: p.y }));
const cloneFaceHoles = (holes) => (holes ?? []).map((h) => (Array.isArray(h)
  ? clonePoints(h)
  : { ...h, ring: clonePoints(h.ring) }));

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
        typeSource: 'auto',
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
              // Pins the type against a later classification, the same way
              // `nameSource` pins the name against a later type change.
              typeSource: 'user',
              typeEvidence: null,
              name: t.nameSource === 'user' ? t.name : autoTraceName(nextType, others),
            }
            : t))
        ),
        isDirty: true,
      });
    },

    /**
     * Type each outline from the level names the scan read off the plan, so a
     * basement stops being reported as living area. Never touches a type the
     * user picked, and renames on the same rule a manual type change does.
     *
     * Callers own the undo snapshot: this is part of the trace that produced
     * the outlines, not an edit of its own. Returns what it changed, because a
     * reclassification moves square footage between the reported subtotals and
     * nothing else on screen announces that.
     */
    classifyTraceTypes: () => {
      const state = get();
      const labels = state.areaLabels || [];
      const traces = state.perimeterTraces || [];
      // No labels is not evidence of anything — a plan that was never scanned,
      // or one whose level names went unread, must leave every type standing.
      if (!labels.length || !traces.length) return [];

      const verdicts = new Map(classifyTraces(traces, labels).map((v) => [v.id, v]));
      const next = traces.slice();
      const changes = [];

      for (let i = 0; i < next.length; i += 1) {
        const trace = next[i];
        if (trace.typeSource === 'user') continue;
        const verdict = verdicts.get(trace.id);
        // A detected type must not outlive the label it was read from: a crop
        // or a re-scan that no longer sees the word puts the outline back.
        const type = verdict
          ? normalizeTraceType(verdict.type)
          : (trace.typeSource === 'detected' ? DEFAULT_TRACE_TYPE : null);
        if (!type || type === normalizeTraceType(trace.type)) continue;

        const others = next.filter((_, j) => j !== i);
        const name = trace.nameSource === 'user' ? trace.name : autoTraceName(type, others);
        next[i] = {
          ...trace,
          type,
          typeSource: verdict ? 'detected' : 'auto',
          typeEvidence: verdict
            ? { keyword: verdict.keyword, text: verdict.text, from: verdict.from }
            : null,
          name,
        };
        changes.push({ id: trace.id, name, type, from: normalizeTraceType(trace.type) });
      }

      if (!changes.length) return [];
      set({ perimeterTraces: assignTypeColors(next), isDirty: true });
      return changes;
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
        ? { vertices: floor, holes: [], quality: null, wallFaces: null }
        : {
          vertices: floor.vertices,
          holes: floor.holes ?? [],
          quality: floor.quality ?? null,
          // The detector's inner/outer pair for this floor, so the wall-face
          // switch has something to switch to on every trace it created.
          wallFaces: floor.wallFaces ?? null,
        }));

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
          typeSource: 'auto',
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
     * Switch every outline to the exterior or interior wall face.
     *
     * The switch is one setting for the whole canvas, so it reaches every trace
     * carrying the detector's pair — not just the active one, and not just the
     * floors of the most recent detection run. Re-deriving it from
     * `tracedBoundaries` could only ever move the last run's outlines, which is
     * why a plan traced in two passes used to switch half of itself.
     *
     * Returns how many outlines carry the requested face, so a caller can tell
     * "nothing to switch" from "switched". Callers own the undo snapshot.
     */
    setWallFaceMode: (interior) => {
      const key = interior ? 'inner' : 'outer';
      const traces = get().perimeterTraces || [];
      let carried = 0;

      const updated = traces.map((t) => {
        const face = t.wallFaces?.[key];
        if (!face?.vertices?.length) return t;
        carried += 1;
        const vertices = clonePoints(face.vertices);
        return {
          ...t,
          vertices,
          // The same merge a re-trace does: the detector's voids are replaced,
          // a void the user punched outlives the switch and is re-checked
          // against the outline that just moved under it.
          holes: markStaleHoles(mergeHoles(t.holes, cloneFaceHoles(face.holes)), vertices),
          closed: true,
        };
      });

      if (carried) {
        set({
          perimeterTraces: updated,
          traceInteractionMode: 'idle',
          perimeterVertices: null,
          isDirty: true,
        });
      }
      return carried;
    },

    /**
     * Drop every trace's wall-face pair. The pair describes ink a crop or an
     * erase has since changed, so the switch must not be able to re-apply it —
     * the same reason `tracedBoundaries` is dropped on the same edit. The
     * outlines themselves stay; only the alternative face is forgotten.
     */
    clearWallFaces: () => {
      const traces = get().perimeterTraces || [];
      if (!traces.some((t) => t.wallFaces)) return;
      set({
        perimeterTraces: traces.map((t) => (t.wallFaces ? { ...t, wallFaces: null } : t)),
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
            typeSource: 'auto',
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
