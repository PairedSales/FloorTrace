import { useCallback, useRef } from 'react';
import { detectRoomsFromLabels } from '../utils/detection';
import { selectProjectScale } from '../utils/detection/scale.js';
import { isUserAsserted } from '../utils/detection/validate.js';
import { notify, flash } from '../utils/notify';
import { perfMark, MARKS } from '../utils/perfMarks';
import useAppStore from '../store/appStore';
import { beginWork, settleWork, ownerVerdict } from '../store/documentRequests';
import * as undoManager from '../store/undoManager';

/**
 * useAutoScale
 *
 * Sets the project scale from every labelled room on the page, with no user
 * input. Previously the user clicked one dimension pill and the whole project
 * was calibrated from that room; measured across the fixtures, the worst room
 * they could have clicked implies a scale 58-90% wrong, and area goes as scale
 * squared. Nothing in the app steered them away from it.
 *
 * The batch is affordable because the worker shares one analysis and one clamp
 * trace across the labels: the first room costs 0.5-1.5s, every one after it
 * costs 1-3ms.
 *
 * @returns {{
 *   measureAndCalibrate: (labels: Array) => Promise<object|null>,
 *   reviewAgainstFootprint: (footprintAreaPx: number) => void,
 * }}
 */
export function useAutoScale() {
  // Kept so the verdict can be revisited once the perimeter exists without
  // measuring anything again — selectProjectScale is pure.
  //
  // Keyed by plan, not a single slot. This is a cross-plan wrong-scale path
  // that lives entirely outside the store, so no grep for a store field finds
  // it: `reviewAgainstFootprint` re-runs the scale decision from whatever rooms
  // are in this ref, and its only other guard is that the scale in force is
  // still the automatic one — which any auto-scaled plan satisfies. One slot
  // shared between plans would recalibrate plan B from plan A's measured rooms
  // and report it as a clean automatic consensus.
  const lastRunByDocRef = useRef(new Map());

  // Returns whether the decision was actually written. The guard lives here
  // rather than at the two call sites so measureAndCalibrate and
  // reviewAgainstFootprint cannot diverge: this wrote unconditionally, so a
  // re-scan silently discarded a scale the user had asserted by hand.
  const applyDecision = useCallback((decision) => {
    if (!(decision?.pixelsPerFoot > 0)) return false;
    if (isUserAsserted(useAppStore.getState().calibration)) return false;
    useAppStore.getState().applyRoomCalibration(
      { x: decision.feetPerPixel, y: decision.feetPerPixel },
      null,
      'room-calibration',
      {
        level: decision.level,
        reason: decision.reason,
        // A log distance, the same unit decideProjectScale reports, so
        // scaleQualitySummary can render either verdict the same way.
        disagreement: decision.spread,
        adopted: true,
        roomCount: decision.roomCount,
        source: 'auto',
        rejected: decision.rejected.map((r) => ({
          name: r.name, reason: r.reason, pixelsPerFoot: r.pixelsPerFoot ?? null,
        })),
      },
    );
    return true;
  }, []);

  /**
   * Measure every label and calibrate from the rooms that agree.
   * Returns the decision, or null when nothing usable came back — in which case
   * no scale is set and the user has the flow they already had.
   */
  const measureAndCalibrate = useCallback(async (labels) => {
    const state = useAppStore.getState();
    const image = state.image;
    if (!image || !labels?.length) return null;

    const nonGlaRegions = state.exteriorLabels.map((l) => l.bbox);
    const work = beginWork('measure', { image });
    let measured = [];
    try {
      measured = await detectRoomsFromLabels(image, labels.map((label) => ({
        id: label.id,
        point: label.point,
        labelBbox: label.labelBbox,
        labelDims: label.labelDims,
      })));
    } catch (error) {
      console.error('Automatic scale measurement failed:', error);
      return null;
    } finally {
      settleWork(work);
      perfMark(MARKS.measureEnd);
    }
    // The plan changed under us while the batch ran.
    //
    // A calibration is deliberately NOT held for a parked plan the way a trace
    // is. Area goes as scale squared, so a scale applied late — from rooms the
    // user has since moved on from, onto a plan they are not looking at — is a
    // wrong number wearing the same green as a right one. The plan is flagged
    // instead, and re-measuring is one click.
    const verdict = ownerVerdict(work);
    if (verdict === 'routed') {
      useAppStore.getState().setDocumentMeta(work.docId, { needsRescale: true });
      return null;
    }
    if (verdict !== 'applied') return null;

    const rooms = measured.filter(Boolean);
    const decision = selectProjectScale(rooms, { nonGlaRegions });
    lastRunByDocRef.current.set(work.docId, { rooms, nonGlaRegions });
    if (!(decision.pixelsPerFoot > 0)) return null;

    undoManager.save();
    // Only the rooms that set the scale are recorded. The rest are the tracer's
    // known-inside evidence too, and a rectangle that leaked through a doorway
    // is evidence for the wrong building.
    useAppStore.getState().addRooms(decision.contributors.map((c) => ({
      labelId: c.name,
      name: null,
      rect: c.rect,
      confidence: c.confidence,
      sides: c.sides,
      feetPerPixel: {
        x: 1 / c.pixelsPerFoot.x,
        y: 1 / c.pixelsPerFoot.y,
      },
    })));
    if (!applyDecision(decision)) {
      // A hand-set scale stands, but the measurement it disagreed with is
      // still worth saying out loud: silently keeping either number is the
      // failure this guard exists to prevent.
      const held = useAppStore.getState().calibration.feetPerPixel;
      const heldScale = Math.sqrt(Math.abs((held?.x ?? 0) * (held?.y ?? 0)));
      const gap = heldScale > 0 ? Math.abs(Math.log(decision.feetPerPixel / heldScale)) : 0;
      // A real disagreement is the app overruling a measurement in favour of
      // the user's number — they have to know. Agreement is just reassurance,
      // so it acknowledges instead of interrupting.
      if (gap > 0.03) {
        notify(
          `Kept the scale you set by hand. The ${decision.roomCount} room`
          + `${decision.roomCount === 1 ? '' : 's'} measured on this page imply one about `
          + `${Math.round((Math.exp(gap) - 1) * 100)}% different.`,
          { type: 'warning', id: 'auto-scale' },
        );
      } else {
        flash('Kept your scale — the rooms on this page agree with it');
      }
      return decision;
    }

    // A 'check' verdict is not announced here: the Scale card shows it as a
    // chip beside the number, and keeps showing it for as long as the scale is
    // in force. A toast said it once and then left the doubt invisible.
    return decision;
  }, [applyDecision]);

  /**
   * Re-run the verdict once the perimeter is traced. The scale itself cannot
   * change — the same rooms decide it — but the traced footprint is the one
   * piece of evidence that survives a majority of bad rooms: a 2x scale error
   * moves the building's square footage 4x, and the rooms' own labels then no
   * longer fit inside it.
   */
  const reviewAgainstFootprint = useCallback((footprintAreaPx) => {
    const state = useAppStore.getState();
    // This plan's own measurements, never another's.
    const run = lastRunByDocRef.current.get(state.activeDocumentId);
    if (!run || !(footprintAreaPx > 0)) return;
    if (state.calibration.quality?.source !== 'auto') return;
    applyDecision(selectProjectScale(run.rooms, {
      nonGlaRegions: run.nonGlaRegions,
      footprintAreaPx,
    }));
  }, [applyDecision]);

  return { measureAndCalibrate, reviewAgainstFootprint };
}
