/**
 * Document identity — which plans exist, what order they are in, and which one
 * the store root is currently carrying.
 *
 * A *document* here is one image and everything measured from it: its own
 * calibration, traces, OCR results, undo history and camera. It is the level a
 * tab will address. Note the terminology carefully, because this repo has a
 * collision waiting: `floorManager.js` calls a polygon *within* one image a
 * "floor", and the `.floorplan` file format has a `floors[]` array that is
 * document-shaped and always holds exactly one entry. The two meanings are
 * inverted. Nothing new may use "floor" for this level.
 *
 * What lives in `documents` is **metadata only** — the small, cheap facts a tab
 * strip needs in order to draw a plan it is not currently showing. Working
 * state never comes here; it lives on the store root for the active plan.
 */
// Minted in `ids.js` alongside `newTraceId`, and re-exported here: see that
// file for why a leaf module owns both.
import { newDocumentId } from './ids';
import * as undoManager from './undoManager';
import { detachDocument } from './documentRequests';

export { newDocumentId };

/**
 * Plans that are open but not on the store root.
 *
 * Module state rather than store state, and deliberately so: a parked plan is
 * inert. Nothing renders it, no selector reads it, and putting it in the store
 * would invite exactly that — a component subscribing to another plan's
 * geometry, which is the read path this architecture exists to not have.
 *
 * @type {Map<string, {state: object, history: object}>}
 */
const parked = new Map();

/** Test seam, and what a full reset needs. */
export const clearParked = () => parked.clear();

/** How many plans are set aside. For tests and diagnosis. */
export const parkedCount = () => parked.size;

/** The metadata a plan carries whether or not it is the one on screen. */
export const newDocumentMeta = (patch = {}) => ({
  // The file this plan came from, if any, so a tab can name itself before the
  // user has typed a subject line. Captured at ingest and kept here rather than
  // in working state: every projection of working state is derived by exclusion
  // from one declaration, so a field added there is enrolled in undo, autosave
  // and the `.floorplan` whether or not that makes sense. This belongs in none
  // of the three.
  sourceFileName: null,
  ...patch,
});

/**
 * How a plan names itself, in fallback order: the subject line the user typed,
 * then the file it came from with its extension dropped, then a positional
 * placeholder. Shared so the window title and any later tab strip cannot
 * disagree about what a plan is called.
 */
export const documentLabel = ({ projectName, sourceFileName, index = 0 }) => {
  const named = (projectName ?? '').trim();
  if (named) return named;
  const file = (sourceFileName ?? '').trim();
  if (file) return file.replace(/\.[^./\\]+$/, '') || file;
  return `Untitled ${index + 1}`;
};

export function createDocumentSlice(set, get) {
  const firstId = newDocumentId();

  return {
    activeDocumentId: firstId,
    documentOrder: [firstId],
    documents: { [firstId]: newDocumentMeta() },
    // True only between parking one plan and adopting the next. Subscribers
    // that watch working state for edits use it to tell a swap — every field
    // changing at once — from a user actually changing something.
    _swappingDocument: false,

    /** Patch the metadata of one plan. Unknown ids are ignored, not created. */
    setDocumentMeta: (docId, patch) => set((state) => {
      const existing = state.documents[docId];
      if (!existing) return {};
      return { documents: { ...state.documents, [docId]: { ...existing, ...patch } } };
    }),

    /** Patch the active plan's metadata. */
    setActiveDocumentMeta: (patch) => {
      const { activeDocumentId, setDocumentMeta } = get();
      if (activeDocumentId) setDocumentMeta(activeDocumentId, patch);
    },

    /** The active plan's metadata, never undefined. */
    activeDocumentMeta: () => {
      const state = get();
      return state.documents[state.activeDocumentId] ?? newDocumentMeta();
    },

    /**
     * What the active plan is called. Resolved through `documentLabel` so the
     * window title and a tab cannot disagree.
     */
    activeDocumentLabel: () => {
      const state = get();
      const meta = state.documents[state.activeDocumentId] ?? newDocumentMeta();
      const index = Math.max(0, state.documentOrder.indexOf(state.activeDocumentId));
      return documentLabel({
        projectName: state.projectName,
        sourceFileName: meta.sourceFileName,
        index,
      });
    },

    /**
     * Set the active plan aside, whole, and return its id.
     *
     * Park is *settle then lift*: the plan's in-flight work is abandoned first,
     * because a trace that lands while its plan is parked has nowhere to go
     * yet; then the working state and the undo history are lifted off the root
     * together. They must move as a pair — a history whose snapshots describe a
     * different plan's geometry is worse than no history.
     */
    parkActiveDocument: () => {
      const state = get();
      const docId = state.activeDocumentId;
      if (!docId) return null;

      // A `save()`/`cancelLastSave()` pair cannot straddle a switch: the save
      // belongs to this plan and the cancel would land on whichever plan is
      // live by then.
      undoManager.cancelPendingSave();
      detachDocument(docId);

      parked.set(docId, {
        state: state.getParkedState(),
        history: undoManager.parkHistory(),
      });
      return docId;
    },

    /**
     * Bring a parked plan onto the store root. A plan with no parked record —
     * one that has just been created — adopts default working state and an
     * empty history rather than inheriting whatever the previous plan left.
     */
    adoptDocument: (docId) => {
      const record = parked.get(docId);
      parked.delete(docId);
      get().adoptParkedState(record?.state ?? {});
      undoManager.adoptHistory(record?.history ?? null);
      set({ activeDocumentId: docId });
    },

    /**
     * Swap which plan the store root is carrying.
     *
     * The order is load-bearing. `_swappingDocument` brackets the two halves so
     * a subscriber cannot mistake a whole-state replacement for an edit — the
     * autosave subscription in particular would otherwise see every field
     * change at once and write the incoming plan's state under the outgoing
     * plan's key.
     *
     * Switching to the plan already live is a no-op, not a park-and-adopt
     * round trip: the round trip is lossless, but it is not free, and a UI that
     * re-selects the current tab should cost nothing.
     */
    switchDocument: (docId) => {
      const state = get();
      if (!docId || docId === state.activeDocumentId) return false;
      if (!state.documents[docId]) return false;

      set({ _swappingDocument: true });
      try {
        state.parkActiveDocument();
        get().adoptDocument(docId);
      } finally {
        set({ _swappingDocument: false });
      }
      return true;
    },

    /**
     * Add a plan and make it active. The plan being left is parked, so opening
     * a second plan never costs the first one anything.
     */
    openDocument: () => {
      const docId = newDocumentId();
      set({ _swappingDocument: true });
      try {
        get().parkActiveDocument();
        set((s) => ({
          documents: { ...s.documents, [docId]: newDocumentMeta() },
          documentOrder: [...s.documentOrder, docId],
        }));
        get().adoptDocument(docId);
      } finally {
        set({ _swappingDocument: false });
      }
      return docId;
    },

    /**
     * Close a plan and forget everything it held.
     *
     * Selection moves the way closing an outline moves it — to the neighbour on
     * the left — so the two levels behave the same way. Closing the last plan
     * leaves one empty plan rather than none: there is no state in this app
     * that means "no document", and inventing one here would mean every reader
     * of the store root learning to handle it.
     */
    closeDocument: (docId) => {
      const state = get();
      const order = state.documentOrder;
      const index = order.indexOf(docId);
      if (index === -1) return false;

      detachDocument(docId);
      parked.delete(docId);

      const remaining = order.filter((id) => id !== docId);
      const documents = { ...state.documents };
      delete documents[docId];

      if (remaining.length === 0) {
        // Re-open an empty plan in its place, keeping the invariant that the
        // root always carries exactly one.
        const fresh = newDocumentId();
        set({ documents: { [fresh]: newDocumentMeta() }, documentOrder: [fresh] });
        get().adoptDocument(fresh);
        return true;
      }

      set({ documents, documentOrder: remaining });
      if (state.activeDocumentId === docId) {
        get().adoptDocument(remaining[Math.max(0, index - 1)]);
      }
      return true;
    },

    /**
     * Forget everything the active plan's metadata said. Paired with the
     * store's `restart()`, which clears the working state beside it — the
     * identity survives, because it is still the same tab.
     */
    resetActiveDocumentMeta: () => {
      const { activeDocumentId } = get();
      if (!activeDocumentId) return;
      set((state) => ({
        documents: { ...state.documents, [activeDocumentId]: newDocumentMeta() },
      }));
    },
  };
}
