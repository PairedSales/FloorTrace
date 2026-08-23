import * as undoManager from './undoManager';
import { newTraceId } from './ids';
import {
  DEFAULT_TRACE_TYPE,
  assignTypeColors,
  autoTraceName,
  makeTrace,
  normalizeTraceType,
  ordinalSuffix,
} from '../utils/traceTypes';
import { classifyTraces } from '../utils/traceClassification';
// From areaCalculator, not appStore: appStore already imports createTraceSlice
// from here, so sourcing it there made a cycle that only worked by hoisting.
import { calculateArea, mergeHoles } from '../utils/areaCalculator';
import { markStaleHoles } from '../utils/geometryValidation';
import { RESULT_SCOPED_CODES } from '../utils/boundaryQuality';
import { pointInPolygon } from '../utils/detection/polygon';

// Which existing trace each newly detected floor *is*, decided by where the
// polygons sit rather than by their position in the array.
//
// Identity used to ride the index: `current.map((t, i) => ({...t, ...new[i]}))`
// supplies only geometry, so `type`, `typeSource`, `name` and `nameSource`
// stayed put while the shape under them changed. A user who traced their garage
// as a second outline and typed it Garage, then re-traced a two-storey sheet,
// got a whole storey typed `garage` with `typeSource: 'user'` — which
// `classifyTraces` then explicitly refuses to correct, so the level stayed out
// of GLA permanently.
//
// Position in the list stays the pairing, because it means something: the
// detector emits floors in page reading order, so floor *i* of a re-trace is
// very probably the same building as floor *i* of the last one. What is new is
// that geometry gets a **veto** — an identity is only carried onto a shape that
// is still in the same place.
//
// A veto rather than a replacement, and not an overlap ratio, because a
// re-traced floor is routinely a slightly different polygon in the same spot:
// `containmentRatio` counts vertices, so a floor one pixel smaller has all four
// corners outside its predecessor and scores zero, and box IoU falls apart on
// concentric outlines. "Is the old outline's middle still inside the new one"
// survives both, and is exactly the question being asked.
const centroid = (vertices) => {
  if (!vertices?.length) return null;
  let x = 0; let y = 0;
  for (const p of vertices) { x += p.x; y += p.y; }
  return { x: x / vertices.length, y: y / vertices.length };
};

const sameBuilding = (prev, floor) => {
  const a = centroid(prev?.vertices);
  const b = centroid(floor?.vertices);
  if (!a || !b) return false;
  const prevRing = prev.vertices ?? [];
  const nextRing = floor.vertices ?? [];
  if (prevRing.length < 3 || nextRing.length < 3) return false;
  return pointInPolygon(a, nextRing, []) || pointInPolygon(b, prevRing, []);
};

/**
 * Perimeter Trace Manager Slice — refactored to manage multiple perimeter traces
 * on a single, globally calibrated canvas using trace-centric terminology.
 *
 * Each perimeter trace represents an independent polygon on the canvas.
 * Legacy floor properties are removed from active Zustand state. Compatibility
 * translation is encapsulated inside the serialization layer.
 */

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
const cloneHoles = (holes) => (holes ?? []).map((h) => (Array.isArray(h)
  ? clonePoints(h)
  : { ...h, ring: clonePoints(h.ring) }));

// Naming lives in traceTypes.js, which owns the taxonomy the names come from.
const generateTraceName = (traces) => autoTraceName(DEFAULT_TRACE_TYPE, traces);

/**
 * How far back an outline can be walked. The list rides inside every undo
 * snapshot, every draft and every `.floorplan`, so the cap has to bound it by
 * the plan rather than by the length of the session.
 */
export const MAX_TRACE_ATTEMPTS = 5;

/**
 * What an outline was, at the moment something replaced it.
 *
 * `area` is px², not square feet, and deliberately: a scale corrected later
 * must not falsify a row that was right when it was written — the caller
 * multiplies by the live calibration, the same way every other stored geometry
 * is read.
 *
 * `wallFaces` is absent. It is by far the heaviest thing on a trace (two full
 * face polygons with their own holes), and the pair belongs to the result that
 * produced it — which is why `revertTraceToAttempt` drops the pair rather than
 * leaving a switch that would jump this outline to a different building.
 *
 * `quality` is shared rather than cloned: a trace's quality object is replaced
 * wholesale by every setter that touches it and never mutated in place, so the
 * outgoing one has no other owner. Its `warnings` can carry ring anchors, which
 * is the one part of an attempt that is not trivially small — the cap is what
 * bounds it.
 */
export const makeAttempt = (trace) => ({
  at: Date.now(),
  source: trace?.quality?.source ?? 'manual',
  confidence: trace?.quality?.confidence ?? null,
  area: calculateArea(trace?.vertices, 1, trace?.holes),
  vertices: clonePoints(trace?.vertices),
  holes: cloneHoles(trace?.holes),
  quality: trace?.quality ?? null,
  // Lifted out of `quality` so a row can read "this was the escalate pass"
  // without reaching through; the same object, not a second copy.
  remediation: trace?.quality?.remediation ?? null,
});

const samePoints = (a, b) => (a?.length ?? 0) === (b?.length ?? 0)
  && (a ?? []).every((p, i) => p.x === b[i].x && p.y === b[i].y);

// Only geometry worth returning to is recorded — an outline with no ring is
// not a state anyone wants back, and recording it would spend the cap.
export const recordAttempt = (trace) => {
  if ((trace?.vertices?.length ?? 0) < 3) return trace;
  const attempts = [...(trace.attempts ?? []), makeAttempt(trace)];
  return { ...trace, attempts: attempts.slice(-MAX_TRACE_ATTEMPTS) };
};

// Rebuilt, never mutated: `quality.warnings` is the array `rankedWarnings`
// indexes into, and every reader of a trace compares by reference.
const withWarningAcknowledged = (trace, index, acknowledged) => ({
  ...trace,
  quality: {
    ...trace.quality,
    warnings: trace.quality.warnings.map((w, i) => (
      i === index ? { ...w, acknowledged } : w
    )),
  },
});

// The same finding on a sibling outline. `pipeline.js` fans every whole-drawing
// warning onto every floor, and the panel prints the group once — so a mark
// left on one copy is a mark the other copies contradict. Keyed on code plus
// payload, which is the key `boundary.js` itself dedupes on.
const warningKey = (w) => `${w?.code}|${JSON.stringify(w?.detail ?? null)}`;

const withGroupAcknowledged = (traces, target, index, acknowledged) => {
  const source = target.quality.warnings[index];
  if (!RESULT_SCOPED_CODES.has(source.code)) {
    return traces.map((t) => (t === target ? withWarningAcknowledged(t, index, acknowledged) : t));
  }
  const key = warningKey(source);
  return traces.map((t) => {
    const warnings = t?.quality?.warnings;
    if (!warnings?.some((w) => warningKey(w) === key)) return t;
    return {
      ...t,
      quality: {
        ...t.quality,
        warnings: warnings.map((w) => (warningKey(w) === key ? { ...w, acknowledged } : w)),
      },
    };
  });
};

export function createTraceSlice(set, get) {
  return {
    /**
     * Add a new empty perimeter trace and select it.
     */
    addPerimeterTrace: () => {
      undoManager.save();
      const state = get();

      const newId = newTraceId();
      const newName = generateTraceName(state.perimeterTraces);

      const newTrace = makeTrace({ id: newId, name: newName });

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
        traceInteractionMode: 'idle',
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

      // Identity is kept, and visibility and type are part of identity:
      // re-tracing must not un-hide a trace the user hid, nor reset a garage
      // the user typed back to GLA. But it is only carried onto a shape still
      // in the same place: a user who traced their garage as a second outline
      // and typed it Garage, then re-traced a two-storey sheet, used to get a
      // whole storey typed `garage` with `typeSource: 'user'` — which
      // `classifyTraces` then refuses to correct, so the level stayed out of
      // GLA permanently.
      const traces = normalized.map((floor, i) => {
        const candidate = current.length === normalized.length ? current[i] : null;
        const prior = candidate && sameBuilding(candidate, floor) ? candidate : null;
        if (!prior) {
          return makeTrace({
            id: newTraceId(),
            name: `${i + 1}${ordinalSuffix(i + 1)} Floor`,
            ...floor,
            holes: markStaleHoles(mergeHoles(current[i]?.holes, floor.holes), floor.vertices),
            closed: true,
          });
        }
        return {
          // The outline this re-trace is about to overwrite, kept so a worse
          // second reading is recoverable without re-scanning the image.
          ...recordAttempt(prior),
          ...floor,
          // Spreading `floor` would replace the holes wholesale, and a void the
          // user punched is not the detector's to discard. Re-checked against
          // the outline that just moved: a user void kept across the re-trace
          // can land outside it, and is marked not dropped.
          holes: markStaleHoles(mergeHoles(prior.holes, floor.holes), floor.vertices),
          closed: true,
        };
      });

      const coloured = assignTypeColors(traces);
      const activeStillExists = coloured.some((t) => t.id === state.activeTraceId);
      set({
        perimeterTraces: coloured,
        activeTraceId: activeStillExists ? state.activeTraceId : coloured[0].id,
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
     *
     * Deliberately records no attempt: both faces are already on the trace, so
     * flipping back is the recovery, and recording one would spend the whole
     * cap on a toggle.
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
          holes: markStaleHoles(mergeHoles(t.holes, cloneHoles(face.holes)), vertices),
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
     * Put an outline back to what it was at `index` of its own attempt list.
     *
     * The state being left is itself recorded first — a feature that exists to
     * end destructive recovery must not make its own move the destructive one.
     * That does mean the indices shift once the cap is reached, so callers read
     * `attempts` fresh rather than holding an index across a revert.
     *
     * `wallFaces` is dropped rather than kept: the pair describes the result
     * that produced it, and this outline is no longer that result. A switch
     * that reports "nothing to switch" is honest; one that jumps the outline to
     * a different building is the wrong-answer-that-looks-green failure.
     *
     * User voids survive on the same rule a re-trace and the face switch use —
     * kept, then re-checked against the outline that just moved under them.
     */
    revertTraceToAttempt: (traceId, index) => {
      const state = get();
      const traces = state.perimeterTraces || [];
      const trace = traces.find((t) => t.id === traceId);
      const attempt = trace?.attempts?.[index];
      if (!attempt || (attempt.vertices?.length ?? 0) < 3) return false;
      // Already there. Without this, a second click on the same row records a
      // duplicate of the geometry it is standing on, and five of those push the
      // detector's own result off the end of the cap — the one state this
      // feature exists to keep reachable.
      if (samePoints(trace.vertices, attempt.vertices)) return false;
      undoManager.save();

      const vertices = clonePoints(attempt.vertices);
      set({
        perimeterTraces: traces.map((t) => (t.id === traceId ? {
          ...recordAttempt(t),
          vertices,
          holes: markStaleHoles(mergeHoles(t.holes, cloneHoles(attempt.holes)), vertices),
          quality: attempt.quality ?? null,
          wallFaces: null,
          closed: true,
        } : t)),
        traceInteractionMode: 'idle',
        perimeterVertices: null,
        isDirty: true,
      });
      return true;
    },

    /**
     * Mark one detection warning as checked against the plan and accepted.
     *
     * `warningIndex` is the position in *this trace's* `quality.warnings`,
     * which is exactly what `rankedWarnings` carries through as `.index` —
     * the ranked list is a presentation of that array, so an index into the
     * ranking would acknowledge a different warning than the one clicked as
     * soon as anything re-ranked.
     *
     * A whole-drawing warning is marked on every outline it was fanned onto,
     * because it is one finding and the panel prints it once. Marking only the
     * copy behind the row left the siblings contradicting it, and the row came
     * straight back.
     *
     * Document content: it takes one off the issue count and prints on the
     * exhibit as reviewed, so it saves its own undo point.
     */
    acknowledgeWarning: (traceId, warningIndex, note = null) => {
      const traces = get().perimeterTraces || [];
      const trace = traces.find((t) => t.id === traceId);
      if (!trace?.quality?.warnings?.[warningIndex]) return false;
      undoManager.save();

      const acknowledged = { at: Date.now(), ...(note ? { note } : {}) };
      set({
        perimeterTraces: withGroupAcknowledged(traces, trace, warningIndex, acknowledged),
        isDirty: true,
      });
      return true;
    },

    /**
     * Put a warning back in the count, across the same group `acknowledgeWarning`
     * marked. No-ops on one that was never acknowledged, so it cannot spend an
     * undo point saying nothing.
     */
    unacknowledgeWarning: (traceId, warningIndex) => {
      const traces = get().perimeterTraces || [];
      const trace = traces.find((t) => t.id === traceId);
      if (!trace?.quality?.warnings?.[warningIndex]?.acknowledged) return false;
      undoManager.save();

      set({
        perimeterTraces: withGroupAcknowledged(traces, trace, warningIndex, null),
        isDirty: true,
      });
      return true;
    },

    /**
     * Reset floor manager/trace slice to initial state.
     */
    resetPerimeterTraces: () => {
      const defaultTraceId = newTraceId();
      set({
        perimeterTraces: [makeTrace({ id: defaultTraceId })],
        activeTraceId: defaultTraceId,
        traceInteractionMode: 'idle',
        perimeterVertices: null,
      });
    },
  };
}
