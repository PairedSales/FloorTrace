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
import { disposeDetectionImage } from '../utils/detection';
import { forgetImage } from '../components/canvas/imageCache';
import { forgetWallSnapEngine } from '../components/canvas/wallSnapEngineCache';

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

/**
 * How many plans may be open at once.
 *
 * Storage is not what sets this. At six the persisted footprint tops out near
 * 60 MB, comfortable against every browser's quota — the ceiling would allow
 * more. What six buys is a tab strip that still truncates gracefully above its
 * ~96 px floor on a laptop, and a worker search budget with room to spare.
 *
 * One constant, read by the open path, the digit shortcuts and the message
 * shown at the cap, so raising it is a one-line change.
 */
export const MAX_OPEN_DOCUMENTS = 6;

/** Test seam, and what a full reset needs. */
export const clearParked = () => parked.clear();

/** How many plans are set aside. For tests and diagnosis. */
export const parkedCount = () => parked.size;

/**
 * A parked plan's working state, read-only.
 *
 * The one legitimate way to see a plan that is not on the root, and narrow on
 * purpose: it is for writing a plan out to a file, not for rendering one. A
 * component subscribing to another plan's geometry is the read path this
 * architecture exists to not have.
 */
export const parkedStateFor = (docId) => parked.get(docId)?.state ?? null;

/** A parked plan's undo history, so it can be written to disk after a park. */
export const parkedHistoryFor = (docId) => parked.get(docId)?.history ?? null;

/**
 * Hold a write for a plan that is not on the store root, to be run when it is.
 *
 * The write is the same closure that would have run live — it goes through the
 * store's setters, which address whichever plan is active, so it can only be
 * run once this plan is active again. Queued rather than applied, and dropped
 * with the plan if it closes first.
 */
export function queueForParked(docId, apply) {
  const record = parked.get(docId);
  if (!record) return false;
  (record.inbox ??= []).push(apply);
  return true;
}

/** How many held writes a plan has waiting. For tests and diagnosis. */
export const parkedInboxSize = (docId) => parked.get(docId)?.inbox?.length ?? 0;

/** The metadata a plan carries whether or not it is the one on screen. */
export const newDocumentMeta = (patch = {}) => ({
  // The file this plan came from, if any, so a tab can name itself before the
  // user has typed a subject line. Captured at ingest and kept here rather than
  // in working state: every projection of working state is derived by exclusion
  // from one declaration, so a field added there is enrolled in undo, autosave
  // and the `.floorplan` whether or not that makes sense. This belongs in none
  // of the three.
  sourceFileName: null,
  // What the tab says. Kept for plans that are not on the root, whose
  // projectName lives in a parked record or on disk rather than in the store.
  title: null,
  // Whether this plan holds an image, so a restored tab can be drawn honestly
  // before its state has been read back.
  hasWork: false,
  // When this plan was last written. Per plan, not per write: the index used
  // to stamp every plan on every write, which made the field say "the
  // workspace was saved" rather than what a per-plan updatedAt means.
  updatedAt: null,
  // Set when a scale this plan's own work would have applied was refused
  // because the plan was not live at the time. Area goes as scale squared, so
  // a late calibration is a wrong number that looks right; the plan is flagged
  // instead and the user re-runs it.
  needsRescale: false,
  // What this plan contributes to the property, in square feet, as
  // `{ byType, counts, gla, total }` or null.
  //
  // A property is measured across plans and only one plan is ever live: parked
  // records are inert by contract, and a restored plan's state sits on disk
  // until someone switches to it. Neither can be measured from a selector. So
  // each plan reports its own figures while it *is* live, they ride in the
  // workspace index, and the roll-up adds up what every plan last reported.
  // Derived, never authoritative — the live plan is always recomputed.
  area: null,
  // False for a restored plan whose state is still on disk. Its records are
  // read on first switch rather than at startup — reading every open plan's
  // multi-megabyte image to show one of them is the wrong trade.
  hydrated: true,
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

      // Deliberately NOT detaching this plan's in-flight work. Parking used to
      // abort it, which is why switching tabs mid-trace silently threw the
      // trace away: the result resolved to 'dropped' and the spinner cleared,
      // and you came back to a plan where nothing had happened. The work now
      // runs to completion and `deliver` holds the result until this plan is
      // adopted again. Closing a plan still detaches — there, the drawing the
      // work was about really is gone.

      const parkedState = state.getParkedState();
      parked.set(docId, {
        state: parkedState,
        history: undoManager.parkHistory(),
      });
      // The tab has to keep saying the right thing after the plan leaves the
      // root, where `projectName` no longer describes it.
      set((s) => ({
        documents: {
          ...s.documents,
          [docId]: {
            ...(s.documents[docId] ?? newDocumentMeta()),
            title: parkedState.projectName || null,
            hasWork: Boolean(parkedState.image),
            hydrated: true,
            updatedAt: Date.now(),
          },
        },
      }));
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

      // Anything that finished while this plan was away, applied now that the
      // store's setters mean this plan. Run after `activeDocumentId` is set,
      // which is what makes them mean it, and in arrival order.
      for (const apply of record?.inbox ?? []) {
        try {
          apply();
        } catch (error) {
          console.error('A result that arrived while a plan was parked could not be applied:', error);
        }
      }
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
     * Insert a plan's state as if it had been parked. How a plan restored from
     * disk becomes switchable without going through the root first.
     */
    parkRestoredDocument: (docId, record) => {
      parked.set(docId, record);
      get().setDocumentMeta(docId, { hydrated: true });
    },

    /**
     * Add a plan and make it active. The plan being left is parked, so opening
     * a second plan never costs the first one anything.
     *
     * Returns null at the cap rather than silently doing nothing — silent
     * failure at a limit is the failure mode this codebase is most prone to,
     * and the caller is expected to say so.
     */
    openDocument: () => {
      if (get().documentOrder.length >= MAX_OPEN_DOCUMENTS) return null;
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
     * Move a plan to a new position in the strip.
     *
     * Order is workspace state, not per-plan state — it is written to the
     * index, so a reordered strip survives a reload.
     */
    moveDocument: (docId, toIndex) => {
      const order = get().documentOrder;
      const from = order.indexOf(docId);
      if (from === -1) return false;
      const to = Math.max(0, Math.min(order.length - 1, toIndex));
      if (from === to) return false;
      const next = [...order];
      next.splice(from, 1);
      next.splice(to, 0, docId);
      set({ documentOrder: next });
      return true;
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
      // Free what this plan held before forgetting where it was: the decoded
      // page in the worker, its detection memo, its decoded bitmap on the main
      // thread and its wall-snap engine are all keyed by the image, and after
      // the record is dropped nothing knows the image to release.
      const closingImage = docId === state.activeDocumentId
        ? state.image
        : parked.get(docId)?.state?.image;
      if (closingImage) {
        disposeDetectionImage(closingImage);
        forgetImage(closingImage);
        forgetWallSnapEngine(closingImage);
      }
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
     * Replace the whole set of open plans, as a restored workspace does.
     *
     * The caller hydrates the active plan itself: this establishes identity and
     * order so a tab strip can be drawn, including for plans whose state is
     * still on disk. `hydrated: false` is what marks those.
     */
    adoptWorkspace: (plans, activeId) => {
      if (!plans?.length) return;
      clearParked();
      const documents = {};
      for (const { docId, meta } of plans) {
        documents[docId] = newDocumentMeta(meta);
      }
      const order = plans.map((p) => p.docId);
      set({
        documents,
        documentOrder: order,
        activeDocumentId: order.includes(activeId) ? activeId : order[0],
      });
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
