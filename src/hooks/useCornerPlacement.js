import { useCallback, useEffect, useRef } from 'react';
import useAppStore from '../store/appStore';
import * as undoManager from '../store/undoManager';
import { assignTypeColors } from '../utils/traceTypes';
import { flash } from '../utils/notify';

/**
 * Drawing an outline corner by corner — and leaving the plan as it was if the
 * user changes their mind.
 *
 * **Redrawing.** Starting to place corners clears the outline being replaced,
 * so the plan is clean to click on. That is right while the new outline is
 * being drawn and wrong the moment it is abandoned: Cancel left the plan with
 * no outline and no area, and the only way back was to know that Undo would do
 * it, several times over. To someone trying the tool to see what it does, that
 * reads as the app having thrown their measurement away.
 *
 * So the outline is remembered when placement starts, and put back if placement
 * ends — by Cancel, by Escape, by picking another tool or another outline —
 * without a finished outline in its place.
 *
 * **Adding.** "Add another outline" makes an empty outline and starts placing
 * its corners. Abandoned, it used to stay in the list as a row with no area,
 * for the user to work out and delete. It is taken back out instead — unless
 * the user has gone to the brush to paint it, which is the other way to draw
 * the same outline and not a change of mind.
 *
 * Either way the undo points saved along the way go too: they are steps of
 * something that, as far as the user is concerned, never happened, and walking
 * back through them would take the outline away again one corner at a time.
 *
 * A finished outline (three corners or more) stands, and what it replaced is
 * one Undo away as before.
 *
 * What is remembered belongs to one plan. If the plan is switched while corners
 * are being placed it is simply forgotten: restoring it into whichever plan is
 * on screen would put one drawing's outline on another.
 */
export function useCornerPlacement() {
  const placing = useAppStore((s) => s.perimeterVertices !== null);
  // The outline being redrawn, or the one just added. Never both: each ask
  // settles the one before it.
  const rememberedRef = useRef(null);
  const addedRef = useRef(null);

  // What a placement leaves behind when it ends without a finished outline.
  const settle = useCallback(() => {
    const remembered = rememberedRef.current;
    const added = addedRef.current;
    rememberedRef.current = null;
    addedRef.current = null;

    const state = useAppStore.getState();
    const traces = state.perimeterTraces || [];

    if (remembered && state.activeDocumentId === remembered.docId) {
      const now = traces.find((t) => t.id === remembered.trace.id);
      // Finished: the new outline stands. Deleted: there is nothing to put back.
      if (!now || (now.vertices?.length ?? 0) >= 3) return;
      useAppStore.setState({
        perimeterTraces: traces.map((t) => (t.id === remembered.trace.id ? remembered.trace : t)),
      });
      undoManager.dropSince(remembered.undoDepth);
      flash('Kept the outline you had');
      return;
    }

    if (added && state.activeDocumentId === added.docId) {
      const now = traces.find((t) => t.id === added.traceId);
      // Drawn: it stands. Being painted: the brush has it now, and whether it
      // gets drawn is the brush's to say.
      if (!now || (now.vertices?.length ?? 0) >= 3 || state.drawModeActive) return;
      const rest = traces.filter((t) => t !== now);
      useAppStore.setState({
        // Re-shaded, as a deletion is, so the colours close up behind it.
        perimeterTraces: assignTypeColors(rest),
        activeTraceId: rest.some((t) => t.id === added.previousActiveId)
          ? added.previousActiveId
          : rest[rest.length - 1]?.id ?? null,
      });
      undoManager.dropSince(added.undoDepth);
    }
  }, []);

  const startPlacing = useCallback(() => {
    // Asked for again while already placing: what is remembered is the outline
    // from before the first ask, not the empty one in its place now.
    if (useAppStore.getState().perimeterVertices === null) {
      // A placement that ended in this same tick has not been settled by the
      // effect yet; it is settled before this one's outline is remembered.
      settle();
      const state = useAppStore.getState();
      const active = state.perimeterTraces?.find((t) => t.id === state.activeTraceId);
      rememberedRef.current = active?.vertices?.length >= 3
        ? { docId: state.activeDocumentId, trace: active, undoDepth: undoManager.depth() }
        : null;
    }

    const state = useAppStore.getState();
    undoManager.save();
    state.setDrawModeActive(false);
    // The outline goes; the user's own cut-outs stay. They are assertions about
    // the building, not the detector's geometry, and `holes: []` is how that is
    // said: replacing a trace's holes replaces only what the detector found
    // (`mergeHoles`). Handing the user's holes back in here, as this once did,
    // added each of them a second time — and a cut-out counted twice comes off
    // the area twice. The detector's wall faces describe the outline being
    // thrown away, so they go with it.
    state.setPerimeterOverlay({ vertices: [], holes: [], wallFaces: null });
    state.setPerimeterVertices([]); // activate corner placement
  }, [settle]);

  const addOutline = useCallback(() => {
    // The panel's "Add another outline" stays live while corners are being
    // placed. Whatever was being drawn ends first, the way Cancel would end it.
    settle();
    const state = useAppStore.getState();
    const added = {
      docId: state.activeDocumentId,
      previousActiveId: state.activeTraceId,
      undoDepth: undoManager.depth(),
      traceId: null,
    };
    state.addPerimeterTrace();
    added.traceId = useAppStore.getState().activeTraceId;
    addedRef.current = added;
  }, [settle]);

  useEffect(() => {
    if (!placing) settle();
  }, [placing, settle]);

  return { startPlacing, addOutline };
}
