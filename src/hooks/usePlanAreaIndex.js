import { useEffect } from 'react';
import { shallow } from 'zustand/shallow';
import useAppStore, { computeAreaByType } from '../store/appStore';

/**
 * Have the live plan record what it contributes to the property.
 *
 * The roll-up has to add up plans that are not on the store root, and it cannot
 * measure them: a parked record is inert by contract (`documentManager`), and a
 * restored plan's state is still on disk until someone switches to it. What it
 * can do is remember. Each plan writes its own figures into
 * `documents[id].area` while it is live, and the workspace index carries them,
 * so a plan contributes to the total from the moment its tab exists.
 *
 * Workspace-level: it follows whichever plan is live, so it must not sit inside
 * a keyed subtree.
 */
export function usePlanAreaIndex() {
  useEffect(() => {
    const record = () => {
      const state = useAppStore.getState();
      const docId = state.activeDocumentId;
      if (!docId || !state.documents[docId]) return;

      const area = computeAreaByType(state);
      // Null rather than a bag of zeroes, so "this plan contributes nothing"
      // is one value and every consumer tests it the same way.
      const next = area.total > 0
        ? { byType: area.byType, counts: area.counts, gla: area.gla, total: area.total }
        : null;

      const current = state.documents[docId].area ?? null;
      if (sameArea(current, next)) return;
      state.setDocumentMeta(docId, { area: next });
    };

    record();
    // Traces and calibration are the only inputs; `activeDocumentId` is here so
    // an adopted plan reports itself immediately rather than on its next edit.
    const unsub = useAppStore.subscribe(
      (s) => [s.perimeterTraces, s.calibration, s.activeDocumentId],
      record,
      { equalityFn: shallow },
    );
    return () => unsub();
  }, []);
}

/** Cheap enough to run on every trace edit, and stops a pointless meta write. */
function sameArea(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.total !== b.total || a.gla !== b.gla) return false;
  const keys = new Set([...Object.keys(a.byType ?? {}), ...Object.keys(b.byType ?? {})]);
  for (const k of keys) {
    if ((a.byType?.[k] ?? 0) !== (b.byType?.[k] ?? 0)) return false;
    if ((a.counts?.[k] ?? 0) !== (b.counts?.[k] ?? 0)) return false;
  }
  return true;
}
