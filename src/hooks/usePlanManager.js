import { useCallback } from 'react';
import useAppStore from '../store/appStore';
import { MAX_OPEN_DOCUMENTS } from '../store/documentManager';
import { readDocDraft, readHistoryRecord, removePlan } from '../utils/workspaceDrafts';
import { forgetFileHandle } from '../utils/fileHandles';
import { confirmToast } from '../utils/confirmToast';
import { notify, flash } from '../utils/notify';

/**
 * Opening, closing and switching plans — the parts that need to await something
 * or ask the user, which the store slice deliberately does not.
 *
 * `documentManager` handles the synchronous half: park, adopt, order,
 * selection. This owns the half that cannot be synchronous — reading a plan
 * back off disk before switching to it, and asking before throwing work away.
 */
export function usePlanManager() {
  /**
   * Bring a plan's records in from disk so it can be adopted.
   *
   * A restored workspace opens every plan it knows about but hydrates only the
   * active one, so the first switch to any other plan lands here. A plan that
   * is already in memory — parked during this session — needs nothing.
   */
  const readPlanIntoMemory = useCallback(async (docId) => {
    const draft = await readDocDraft(docId);
    if (draft.status === 'missing' || draft.status === 'malformed') {
      // The tab promised a plan that is not there. Saying so is the point:
      // opening it as an empty plan would look like the work simply vanished.
      notify('That plan could not be reopened — its saved copy is missing.', {
        type: 'error', id: 'plan-restore',
      });
      useAppStore.getState().closeDocument(docId);
      return false;
    }

    const history = await readHistoryRecord(docId);
    useAppStore.getState().parkRestoredDocument(docId, {
      state: draft.state,
      history: history
        ? { ...history, imagePool: new Map(history.imagePool) }
        : null,
    });

    if (draft.status === 'no-image') {
      // Traces and calibration survived and are worth showing; the picture
      // behind them did not. Better than dropping the plan silently.
      notify('That plan reopened without its image — the outlines are intact.', {
        type: 'warning', id: 'plan-restore',
      });
    }
    return true;
  }, []);

  const hydrate = useCallback(async (docId) => {
    const meta = useAppStore.getState().documents[docId];
    if (!meta || meta.hydrated) return true;

    // Reading a plan back means pulling a multi-megabyte image out of
    // IndexedDB — measured at roughly a second on a real plan. Switching to a
    // restored tab and getting nothing at all for that long reads as a hang,
    // so it says what it is doing. Only this path is slow: a plan parked during
    // this session is already in memory and never reaches here.
    useAppStore.getState().setIsProcessing(true, 'Opening plan…');
    try {
      return await readPlanIntoMemory(docId);
    } finally {
      useAppStore.getState().setIsProcessing(false);
    }
  }, [readPlanIntoMemory]);

  const switchPlan = useCallback(async (docId) => {
    const state = useAppStore.getState();
    if (!docId || docId === state.activeDocumentId) return false;
    if (!(await hydrate(docId))) return false;
    return useAppStore.getState().switchDocument(docId);
  }, [hydrate]);

  /** Step through the open plans. Wraps, the way a tab strip is expected to. */
  const stepPlan = useCallback((delta) => {
    const state = useAppStore.getState();
    const order = state.documentOrder;
    if (order.length < 2) return false;
    const index = order.indexOf(state.activeDocumentId);
    const next = order[(index + delta + order.length) % order.length];
    return switchPlan(next);
  }, [switchPlan]);

  const openPlan = useCallback(() => {
    const docId = useAppStore.getState().openDocument();
    if (!docId) {
      // Said, never silent. The wording matches the outline cap's voice.
      notify(`${MAX_OPEN_DOCUMENTS} plans is the maximum — close one first.`, {
        type: 'warning', id: 'plan-cap',
      });
      return null;
    }
    return docId;
  }, []);

  /**
   * Close one plan, asking first if it holds work that is not saved anywhere
   * but this browser.
   *
   * `isDirty` is deliberately not the test. It is set by nearly every mutation
   * and cleared in exactly one place — a successful `.floorplan` export, which
   * the menu tells the user is optional — so it is true for essentially every
   * plan that has ever been touched. What matters is whether closing loses
   * anything: a plan with an image has work, and the draft is what holds it.
   */
  const closePlan = useCallback(async (docId, { confirmFirst = true } = {}) => {
    const state = useAppStore.getState();
    const meta = state.documents[docId];
    if (!meta) return false;

    const isActive = docId === state.activeDocumentId;
    const hasWork = isActive ? Boolean(state.image) : Boolean(meta.hasWork);

    if (confirmFirst && hasWork) {
      const label = meta.title || 'this plan';
      const confirmed = await confirmToast(
        `Close ${label}? Its measurements will be discarded.`,
        { confirmLabel: 'Close plan' },
      );
      if (!confirmed) return false;
    }

    // Whoever inherits the root has to arrive with its content. After a
    // restore every background plan is `hydrated: false` — its state is still
    // on disk — and `adoptDocument` has nothing parked to adopt, so closing the
    // active plan used to land the store on an image-less root that the autosave
    // subscription then read as an empty plan and deleted.
    if (isActive && state.documentOrder.length > 1) {
      const order = state.documentOrder;
      const index = order.indexOf(docId);
      const successor = order[Math.max(0, index - 1)] === docId
        ? order[index + 1]
        : order[Math.max(0, index - 1)];
      if (successor) await hydrate(successor);
    }

    await removePlan(docId);
    // The Save As grant dies with the plan. Left behind, the handle cached
    // under this id sends the next plan's first Save into the closed plan's
    // file — no picker, no warning, the previous property's exhibit gone.
    forgetFileHandle(docId);
    useAppStore.getState().closeDocument(docId);
    return true;
  }, [hydrate]);

  /**
   * Close every plan.
   *
   * Strictly sequential, and that is not a style choice. `requestConfirm`
   * answers an incumbent request `false` before replacing it, and there is one
   * dialog mounted — so issuing N confirmations together would auto-answer
   * N-1 of them while showing one, silently keeping or dropping plans
   * depending on which way the answer fell. Cancelling stops the rest.
   */
  const closeAllPlans = useCallback(async () => {
    const order = [...useAppStore.getState().documentOrder];
    for (const docId of order) {
      const closed = await closePlan(docId);
      if (!closed) return false;
    }
    flash('All plans closed');
    return true;
  }, [closePlan]);

  return { openPlan, closePlan, closeAllPlans, switchPlan, stepPlan, hydrate };
}
