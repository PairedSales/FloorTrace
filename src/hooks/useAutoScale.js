import { useCallback, useRef } from 'react';
import { detectRoomsFromLabels } from '../utils/detection';
import { selectProjectScale } from '../utils/detection/scale.js';
import { isUserAsserted } from '../utils/detection/validate.js';
import { perfMark, MARKS } from '../utils/perfMarks';
import useAppStore from '../store/appStore';
import { beginWork, settleWork, ownerVerdict } from '../store/documentRequests';
import * as undoManager from '../store/undoManager';

/**
 * useAutoScale
 *
 * Sets the project scale from one room, chosen with no user input: every
 * labelled room on the page is measured, the one that agrees best with the
 * others is chosen, and the scale is that room's alone. The caller draws the
 * green box on it (`decision.room`).
 *
 * Measuring them all is what makes the choice safe: across the fixtures the
 * worst room on a page implies a scale 58-90% wrong, and area goes as scale
 * squared. The batch is affordable because the worker shares one analysis and
 * one clamp trace across the labels: the first room costs 0.5-1.5s, every one
 * after it costs 1-3ms.
 *
 * @returns {{
 *   measureAndCalibrate: (labels: Array) => Promise<object|null>,
 *   reviewAgainstFootprint: (footprintAreaPx: number) => void,
 * }}
 */
export function useAutoScale() {
  // Kept so the verdict can be revisited once the perimeter exists without
  // measuring anything again — selectProjectScale is pure, and the footprint
  // has no say in which room it chooses, so the scale cannot move.
  //
  // Keyed by plan, not a single slot: one slot shared between plans would
  // judge plan B by plan A's measured rooms.
  const lastRunByDocRef = useRef(new Map());

  // Returns whether the decision was written. A scale the user set by hand
  // stands: a re-read must not discard it.
  const applyDecision = useCallback((decision) => {
    if (!(decision?.pixelsPerFoot > 0)) return false;
    if (isUserAsserted(useAppStore.getState().calibration)) return false;
    useAppStore.getState().applyRoomCalibration(
      decision.feetPerPixel,
      'room-calibration',
      {
        level: decision.level,
        reason: decision.reason,
        // A log distance, the same unit decideProjectScale reports, so
        // scaleQualitySummary can render either verdict the same way.
        disagreement: decision.spread,
        adopted: true,
        // The rooms that agree, the chosen one among them: what it was
        // checked against, never what the scale was made from.
        roomCount: decision.roomCount,
        source: 'auto',
        areaRatio: decision.areaRatio ?? null,
        rejected: decision.rejected.map((r) => ({
          name: r.name, reason: r.reason, pixelsPerFoot: r.pixelsPerFoot ?? null,
        })),
      },
    );
    return true;
  }, []);

  /**
   * Measure every label and calibrate from the room that agrees best with the
   * others. Returns the decision, or null when nothing usable came back — in
   * which case no scale is set and the user has the flow they already had.
   *
   * When a scale the user set by hand stood instead, the decision carries
   * `keptByHand: {agrees}` — whether the room just chosen bears it out — and
   * the box must be left where the user put it. It is the caller's to say, as
   * the last line of the run.
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
    // Every room that agrees is recorded, not only the one the scale came
    // from: they are the tracer's known-inside evidence. The rest are left
    // out — a rectangle that leaked through a doorway is evidence for the
    // wrong building.
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
      // still worth saying out loud.
      const held = useAppStore.getState().calibration.feetPerPixel;
      const heldScale = Math.sqrt(Math.abs((held?.x ?? 0) * (held?.y ?? 0)));
      const gap = heldScale > 0 ? Math.abs(Math.log(decision.pixelsPerFoot * heldScale)) : 0;
      return { ...decision, keptByHand: { agrees: gap <= 0.03 } };
    }

    // A 'check' verdict is not announced here: the panel's scale step says
    // it, and keeps saying it for as long as the scale is in force.
    return decision;
  }, [applyDecision]);

  /**
   * Judge the scale again once the perimeter is traced. The scale itself
   * cannot change — the same rooms choose the same room — but the traced
   * footprint is the one piece of evidence that survives a majority of bad
   * rooms: a 2x scale error moves the building's square footage 4x, and the
   * rooms' own labels then no longer fit inside it.
   */
  const reviewAgainstFootprint = useCallback((footprintAreaPx) => {
    const state = useAppStore.getState();
    const run = lastRunByDocRef.current.get(state.activeDocumentId);
    if (!run?.rooms?.length || !(footprintAreaPx > 0)) return;
    if (state.calibration.quality?.source !== 'auto') return;
    applyDecision(selectProjectScale(run.rooms, {
      nonGlaRegions: run.nonGlaRegions,
      footprintAreaPx,
    }));
  }, [applyDecision]);

  return { measureAndCalibrate, reviewAgainstFootprint };
}
